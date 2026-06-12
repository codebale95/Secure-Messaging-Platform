import blessed from 'neo-blessed';
import { getWebhookUrl, setWebhookUrl, clearWebhookUrl } from './config.js';

// ─── Color utilities ────────────────────────────────────────────────────────

const USER_COLORS = ['cyan', 'magenta', 'yellow', 'blue', 'green', 'red'];

function getUserColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

function formatMessage(sender, timestamp, text) {
  const color = getUserColor(sender);
  const formatted = text.replace(/`([^`]+)`/g, '{gray-fg}$1{/gray-fg}');
  return `{${color}-fg}{bold}${sender}{/bold}{/${color}-fg}  {gray-fg}${timestamp}{/gray-fg}\n  ${formatted}`;
}

function formatSystem(text, type = 'info') {
  const colorMap  = { info: 'gray', success: 'green', warning: 'yellow', error: 'red' };
  const prefixMap = { info: '[INFO]', success: '[OK]', warning: '[WARN]', error: '[ERR]' };
  const color  = colorMap[type]  || 'gray';
  const prefix = prefixMap[type] || '[INFO]';
  return `{${color}-fg}${prefix} ${text}{/${color}-fg}`;
}

// ─── App factory ────────────────────────────────────────────────────────────

export function createApp({ username, socket }) {
  // ── State ────────────────────────────────────────────────────────────────
  const channels = ['#general', '#engineering'];
  let   activeIdx = 0;
  const unread    = { '#general': 0, '#engineering': 0 };
  const msgStore  = { '#general': [], '#engineering': [] };

  // Manual input buffer — replaces blessed.textbox + readInput() entirely.
  // A single screen.on('keypress') handler owns all input; no _listener
  // accumulation, no _done() race, no doubled characters possible.
  let inputBuf    = '';
  let historyIdx  = -1;          // -1 = live input; 0 = most recent sent
  const history   = [];          // per-session sent messages, newest at front

  // ── Screen ───────────────────────────────────────────────────────────────
  const screen = blessed.screen({
    smartCSR:     true,
    fullUnicode:  true,
    forceUnicode: true,
    title: 'CHITCHAT | SECURE TERMINAL VAULT'
  });

  // ── Sidebar ───────────────────────────────────────────────────────────────
  const sidebar = blessed.box({
    parent: screen,
    left: 0, top: 0,
    width: 22,
    height: '100%-1',
    border: { type: 'line' },
    style:  { border: { fg: 'blue' } },
    keys: false,
    tags: true
  });

  // ── Chat log ──────────────────────────────────────────────────────────────
  const chatLog = blessed.log({
    parent: screen,
    left: 22, top: 0,
    width: '100%-22',
    height: '100%-4',
    border: { type: 'line' },
    style:  { border: { fg: 'blue' } },
    scrollable:   true,
    alwaysScroll: true,
    mouse:  true,
    tags:   true,
    keys:   false,
    scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { inverse: true } }
  });

  // ── Input display (plain box — no textbox, no readInput, no _listener) ───
  // We draw the prompt + inputBuf manually on every keypress.
  const inputBox = blessed.box({
    parent: screen,
    left: 22,
    bottom: 1,
    width: '100%-22',
    height: 3,
    border: { type: 'line' },
    style:  { border: { fg: 'cyan' } },
    tags: true
  });

  // ── Status bar ────────────────────────────────────────────────────────────
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0, left: 0,
    width: '100%', height: 1,
    tags: true
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function getActiveChannel() { return channels[activeIdx]; }

  function renderInput() {
    // Render prompt + current buffer. Cursor shown as a block character.
    inputBox.setContent(
      ` {cyan-fg}{bold}${username} >{/bold}{/cyan-fg} ${blessed.escape(inputBuf)}{white-fg}█{/white-fg}`
    );
    screen.render();
  }

  function updateStatusBar(connected) {
    const gw = connected
      ? '{green-fg}ONLINE{/green-fg}'
      : '{red-fg}OFFLINE{/red-fg}';
    statusBar.setContent(
      `{bold}CHITCHAT | SECURE TERMINAL VAULT{/bold}` +
      `{|}{gray-fg}Session: ${username} | Gateway: {/gray-fg}${gw}`
    );
    screen.render();
  }

  function updateSidebar() {
    const active = getActiveChannel();
    const rooms  = channels.filter(c => c.startsWith('#'));
    const dms    = channels.filter(c => c.startsWith('@'));

    let out = '\n{bold}{gray-fg}ROOMS{/gray-fg}{/bold}\n\n';
    for (const room of rooms) {
      const isActive = room === active;
      const badge    = (unread[room] || 0) > 0 ? ` {red-fg}[${unread[room]}]{/red-fg}` : '';
      out += isActive
        ? ` {cyan-fg}{bold}${room}{/bold}{/cyan-fg}${badge}\n`
        : ` {gray-fg}${room}{/gray-fg}${badge}\n`;
    }

    out += '\n{bold}{gray-fg}DIRECT{/gray-fg}{/bold}\n\n';
    if (dms.length === 0) {
      out += ' {gray-fg}(none){/gray-fg}\n';
    } else {
      for (const dm of dms) {
        const isActive = dm === active;
        const badge    = (unread[dm] || 0) > 0 ? ` {red-fg}[${unread[dm]}]{/red-fg}` : '';
        out += isActive
          ? ` {magenta-fg}{bold}${dm}{/bold}{/magenta-fg}${badge}\n`
          : ` {gray-fg}${dm}{/gray-fg}${badge}\n`;
      }
    }

    sidebar.setContent(out);
  }

  function updateChatLabel() {
    chatLog.setLabel(` ● ${getActiveChannel()} `);
  }

  function ensureChannel(channel) {
    if (!channels.includes(channel)) {
      channels.push(channel);
      unread[channel]   = 0;
      msgStore[channel] = [];
      updateSidebar();
      screen.render();
    }
  }

  function appendToChannel(channel, line) {
    if (!msgStore[channel]) msgStore[channel] = [];
    msgStore[channel].push(line);

    if (channel === getActiveChannel()) {
      chatLog.log(line); // blessed.log calls screen.render() internally
    } else {
      unread[channel] = (unread[channel] || 0) + 1;
      updateSidebar();
      screen.render();
    }
  }

  function logSystem(text, type = 'info') {
    appendToChannel(getActiveChannel(), formatSystem(text, type));
  }

  function switchToChannel(index) {
    activeIdx = index;
    const ch  = getActiveChannel();
    unread[ch] = 0;

    chatLog.setContent('');
    for (const line of (msgStore[ch] || [])) chatLog.add(line);
    chatLog.setScrollPerc(100);

    updateSidebar();
    updateChatLabel();
    screen.render();
  }

  function handleSubmit() {
    const value = inputBuf.trim();
    inputBuf   = '';
    historyIdx = -1;
    if (value) history.unshift(value); // push to front so Up = most recent
    renderInput();
    if (!value) return;

    const active = getActiveChannel();

    if (value.startsWith('/')) {
      const parts   = value.split(' ');
      const command = parts[0].toLowerCase();

      if (command === '/join') {
        const group = parts[1];
        if (!group) { logSystem('Group name required. Format: /join <group>', 'error'); return; }
        socket.emit('join-group', group);
        ensureChannel(`#${group}`);
        switchToChannel(channels.indexOf(`#${group}`));
        logSystem(`Joined group #${group}`, 'success');
        return;
      }

      if (command === '/dm') {
        const target = parts[1];
        if (!target) { logSystem('Username required. Format: /dm <username>', 'error'); return; }
        const ch = `@${target}`;
        ensureChannel(ch);
        switchToChannel(channels.indexOf(ch));
        logSystem(`DM channel with ${target} opened. Type to send.`, 'info');
        return;
      }

      if (command === '/leave') {
        const group = parts[1];
        if (!group) { logSystem('Group name required. Format: /leave <group>', 'error'); return; }
        socket.emit('leave-group', group);
        const name = `#${group}`;
        const idx  = channels.indexOf(name);
        if (idx !== -1) {
          channels.splice(idx, 1);
          delete msgStore[name];
          delete unread[name];
          if (activeIdx >= channels.length) activeIdx = Math.max(0, channels.length - 1);
          switchToChannel(activeIdx);
        }
        return;
      }

      if (command === '/webhook') {
        const sub = parts[1];
        if (!sub) { logSystem(`Webhook: ${getWebhookUrl() || 'None'}`, 'info'); return; }
        if (sub === 'clear') {
          clearWebhookUrl();
          logSystem('Webhook cleared.', 'success');
        } else if (sub.startsWith('http://') || sub.startsWith('https://')) {
          setWebhookUrl(sub);
          logSystem(`Webhook set: ${sub}`, 'success');
        } else {
          logSystem('Invalid URL. Must start with http:// or https://', 'error');
        }
        return;
      }

      if (command === '/clear') {
        msgStore[getActiveChannel()] = [];
        chatLog.setContent('');
        screen.render();
        return;
      }

      if (command === '/exit') {
        socket.disconnect();
        screen.destroy();
        process.exit(0);
      }

      logSystem(`Unknown command: ${command}`, 'warning');
      return;
    }

    if (!active) { logSystem('No chat selected. Use /join <group>', 'warning'); return; }
    if (active.startsWith('#')) {
      socket.emit('group-message', { group: active.slice(1), content: value });
    } else if (active.startsWith('@')) {
      socket.emit('direct-message', { recipient: active.slice(1), content: value });
    }
  }

  // ─── Single keypress handler — owns ALL input ─────────────────────────────
  // This is the entire input system. One handler on the screen, one code path.
  // No textbox, no readInput(), no _listener, no _done(), no races possible.
  screen.on('keypress', (ch, key) => {
    if (!key) return;

    // ── Global shortcuts (always active) ──
    if (key.full === 'C-c') {
      socket.disconnect();
      screen.destroy();
      process.exit(0);
    }

    if (key.full === 'C-right') {
      switchToChannel((activeIdx + 1) % channels.length);
      return;
    }
    if (key.full === 'C-left') {
      switchToChannel((activeIdx - 1 + channels.length) % channels.length);
      return;
    }

    if (key.full === 'pageup') {
      chatLog.scroll(-(chatLog.height - 2 || 5));
      screen.render();
      return;
    }
    if (key.full === 'pagedown') {
      chatLog.scroll(chatLog.height - 2 || 5);
      screen.render();
      return;
    }

    // ── Text input ──
    if (key.name === 'enter' || key.name === 'return') {
      handleSubmit();
      return;
    }

    if (key.name === 'backspace') {
      inputBuf   = inputBuf.slice(0, -1);
      historyIdx = -1;
      renderInput();
      return;
    }

    // Ctrl+Up — step back through history
    if (key.full === 'C-up' || (key.name === 'up' && key.ctrl)) {
      if (history.length === 0) return;
      historyIdx = Math.min(historyIdx + 1, history.length - 1);
      inputBuf   = history[historyIdx];
      renderInput();
      return;
    }

    // Ctrl+Down — step forward (toward live input)
    if (key.full === 'C-down' || (key.name === 'down' && key.ctrl)) {
      historyIdx = historyIdx - 1;
      inputBuf   = historyIdx < 0 ? '' : history[historyIdx];
      historyIdx = Math.max(historyIdx, -1);
      renderInput();
      return;
    }

    // Ignore all other control/meta/special keys
    if (key.ctrl || key.meta || !ch || ch.length !== 1) return;

    inputBuf += ch;
    renderInput();
  });

  // ─── Socket event handlers (preserved exactly) ───────────────────────────

  socket.on('connect', () => {
    updateStatusBar(true);
    logSystem('Session established. Registration complete.', 'success');
    socket.emit('register', username);
  });

  socket.on('disconnect', () => {
    updateStatusBar(false);
    logSystem('Link terminated. Attempting reconnect...', 'warning');
  });

  socket.on('sys-alert', ({ type, message }) => logSystem(message, type));
  socket.on('sys-event', ({ type, message }) => logSystem(message, type));

  socket.on('message-received', (msg) => {
    const ch = `@${msg.sender}`;
    ensureChannel(ch);
    appendToChannel(ch, formatMessage(msg.sender, new Date(msg.timestamp).toLocaleTimeString(), msg.content));
  });

  socket.on('message-sent', (msg) => {
    const ch = `@${msg.recipient}`;
    ensureChannel(ch);
    appendToChannel(ch, formatMessage(username, new Date(msg.timestamp).toLocaleTimeString(), msg.content));
  });

  socket.on('group-message-received', (msg) => {
    const ch = `#${msg.group}`;
    ensureChannel(ch);
    appendToChannel(ch, formatMessage(msg.sender, new Date(msg.timestamp).toLocaleTimeString(), msg.content));
  });

  socket.on('group-message-sent', (msg) => {
    const ch = `#${msg.group}`;
    ensureChannel(ch);
    appendToChannel(ch, formatMessage(username, new Date(msg.timestamp).toLocaleTimeString(), msg.content));
  });

  // ─── Resize ───────────────────────────────────────────────────────────────
  screen.on('resize', () => screen.render());

  // ─── Initial draw ─────────────────────────────────────────────────────────
  updateSidebar();
  updateChatLabel();
  updateStatusBar(false);
  renderInput();
  screen.render();
}
