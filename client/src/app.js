import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { io } from 'socket.io-client';
import chalk from 'chalk';
import { getWebhookUrl, setWebhookUrl, clearWebhookUrl } from './config.js';
import { getOrGenerateKeyPair, computeSharedSecret, encryptMessage, decryptMessage } from './encryption.js';

export default function App({ username }) {
  const { exit } = useApp();
  const [inputVal, setInputVal] = useState('');
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeWebhook, setActiveWebhook] = useState(getWebhookUrl() || 'Not Configured');
  const [socket, setSocket] = useState(null);
  const [lastRecipient, setLastRecipient] = useState(null);
  const [keys] = useState(() => getOrGenerateKeyPair(username));
  const sentMessagesRef = useRef(new Map());

  // Helper to add system and diagnostic log messages to screen (emoji-free, professional logs)
  const addSystemMessage = (text, type = 'info') => {
    const prefixes = { info: '[INFO]', success: '[OK]', warning: '[WARN]', error: '[ERR]' };
    const colors = { info: chalk.blue, success: chalk.green, warning: chalk.yellow, error: chalk.red };
    const colorFn = colors[type] || chalk.white;
    const prefix = prefixes[type] || '[INFO]';

    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        type: 'system',
        text: colorFn(`${prefix} ${text}`),
        timestamp: new Date().toLocaleTimeString()
      }
    ].slice(-16));
  };

  // Helper to trigger local outgoing webhook
  const triggerOutgoingWebhook = async (source, data) => {
    const url = getWebhookUrl();
    if (!url) return;

    addSystemMessage(`Webhook dispatch initiated to target ${url}...`, 'info');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChitChat-CLI-Webhook'
        },
        body: JSON.stringify({
          source,
          recipient: username,
          timestamp: new Date().toISOString(),
          data
        })
      });

      if (response.ok) {
        addSystemMessage(`Webhook dispatch succeeded (HTTP ${response.status})`, 'success');
      } else {
        addSystemMessage(`Webhook dispatch failed (HTTP ${response.status})`, 'error');
      }
    } catch (err) {
      addSystemMessage(`Webhook dispatch failed: ${err.message}`, 'error');
    }
  };

  // Initialize Socket.io Connection
  useEffect(() => {
    addSystemMessage('Establishing connection to router...', 'info');
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      addSystemMessage('Link established. Authenticating session...', 'success');
      newSocket.emit('register', { username, publicKey: keys.publicKey });
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      addSystemMessage('Link terminated. Attempting reconnect...', 'warning');
    });

    newSocket.on('sys-alert', ({ type, message }) => {
      addSystemMessage(message, type);
    });

    newSocket.on('sys-event', ({ type, message }) => {
      addSystemMessage(message, type);
    });

    newSocket.on('message-received', (msg) => {
      let displayText = msg.content;
      try {
        const parsed = JSON.parse(msg.content);
        if (parsed.ciphertext && parsed.senderPublicKey) {
           const sharedSecret = computeSharedSecret(keys.privateKey, parsed.senderPublicKey);
           displayText = decryptMessage(parsed.ciphertext, sharedSecret);
        }
      } catch(e) {}

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          type: 'chat',
          sender: msg.sender,
          text: displayText,
          timestamp: new Date(msg.timestamp).toLocaleTimeString()
        }
      ].slice(-16));
      setLastRecipient(msg.sender);

      // Trigger local outgoing webhook
      triggerOutgoingWebhook('direct-message', msg);
    });

    newSocket.on('message-sent', (msg) => {
      let displayText = msg.content;
      try {
         const parsed = JSON.parse(msg.content);
         if (parsed.ciphertext && sentMessagesRef.current.has(parsed.ciphertext)) {
            displayText = sentMessagesRef.current.get(parsed.ciphertext);
         }
      } catch(e) {}

      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          type: 'sent',
          recipient: msg.recipient,
          text: displayText,
          timestamp: new Date(msg.timestamp).toLocaleTimeString()
        }
      ].slice(-16));
    });

    newSocket.on('webhook-payload', (payload) => {
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          type: 'webhook',
          payload: payload,
          timestamp: new Date(payload.timestamp).toLocaleTimeString()
        }
      ].slice(-16));

      // Trigger local outgoing webhook for this webhook alert
      triggerOutgoingWebhook('incoming-webhook', payload);
    });

    return () => {
      newSocket.close();
    };
  }, [username]);

  // Handle Ctrl+C and exit inputs
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  // Handle input submission
  const handleSubmit = (value) => {
    const trimmed = value.trim();
    setInputVal('');
    if (!trimmed) return;

    // Handle Commands
    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(' ');
      const command = parts[0].toLowerCase();

      if (command === '/exit') {
        exit();
        return;
      }

      if (command === '/clear') {
        setMessages([]);
        addSystemMessage('Console cleared.', 'info');
        return;
      }

      if (command === '/webhook') {
        const subCommand = parts[1];
        if (!subCommand) {
          addSystemMessage(`Registered Webhook Target: ${getWebhookUrl() || 'None'}`, 'info');
          return;
        }

        if (subCommand.toLowerCase() === 'clear') {
          clearWebhookUrl();
          setActiveWebhook('Not Configured');
          addSystemMessage('Registered webhook destination removed.', 'success');
        } else {
          if (subCommand.startsWith('http://') || subCommand.startsWith('https://')) {
            setWebhookUrl(subCommand);
            setActiveWebhook(subCommand);
            addSystemMessage(`Webhook destination set: ${subCommand}`, 'success');
          } else {
            addSystemMessage('Invalid destination URL. Prefix with http:// or https://', 'error');
          }
        }
        return;
      }

      addSystemMessage(`Invalid parameter syntax: ${command}`, 'error');
      return;
    }

    // Handle Direct Messaging
    const sendDirectMessage = (recipient, text) => {
      if (!socket || !isConnected) {
        addSystemMessage('Message delivery failed: Offline.', 'error');
        return;
      }
      
      socket.emit('get-public-key', recipient, (recipientPubKey) => {
        if (!recipientPubKey) {
           addSystemMessage(`User @${recipient} is offline or not found. Cannot exchange E2EE keys.`, 'error');
           return;
        }
        
        try {
           const sharedSecret = computeSharedSecret(keys.privateKey, recipientPubKey);
           const ciphertext = encryptMessage(text, sharedSecret);
           const payloadStr = JSON.stringify({ ciphertext, senderPublicKey: keys.publicKey });
           
           // Store the plaintext locally so we can render it when the server echoes message-sent
           sentMessagesRef.current.set(ciphertext, text);
           
           socket.emit('direct-message', { recipient, content: payloadStr });
           setLastRecipient(recipient);
        } catch (err) {
           addSystemMessage(`Encryption failed: ${err.message}`, 'error');
        }
      });
    };

    if (trimmed.startsWith('@')) {
      const spaceIdx = trimmed.indexOf(' ');
      if (spaceIdx === -1) {
        addSystemMessage('Message body required. Format: @user <message>', 'error');
        return;
      }
      const recipient = trimmed.slice(1, spaceIdx);
      const content = trimmed.slice(spaceIdx + 1);

      sendDirectMessage(recipient, content);
    } else {
      if (lastRecipient) {
        addSystemMessage(`Routing to default recipient @${lastRecipient}...`, 'info');
        sendDirectMessage(lastRecipient, trimmed);
      } else {
        addSystemMessage('Recipient tag missing. Use @user <message>', 'warning');
      }
    }
  };

  // Renders a single message beautifully using React.createElement
  const renderMessage = (msg) => {
    if (msg.type === 'system') {
      return React.createElement(
        Box,
        { key: msg.id, marginY: 0 },
        React.createElement(Text, { dimColor: true }, `[${msg.timestamp}]`),
        React.createElement(Text, null, ` ${msg.text}`)
      );
    }

    if (msg.type === 'sent') {
      return React.createElement(
        Box,
        { key: msg.id, marginY: 0 },
        React.createElement(Text, { dimColor: true }, `[${msg.timestamp}] `),
        React.createElement(Text, { color: 'green', bold: true }, `[To @${msg.recipient}]`),
        React.createElement(Text, null, ` ${msg.text}`)
      );
    }

    if (msg.type === 'chat') {
      return React.createElement(
        Box,
        { key: msg.id, marginY: 0 },
        React.createElement(Text, { dimColor: true }, `[${msg.timestamp}] `),
        React.createElement(Text, { color: 'cyan', bold: true }, `[@${msg.sender}]`),
        React.createElement(Text, null, ` ${msg.text}`)
      );
    }

    if (msg.type === 'webhook') {
      const prettyJson = JSON.stringify(msg.payload.body, null, 2);
      return React.createElement(
        Box,
        { key: msg.id, flexDirection: 'column', borderStyle: 'dashed', borderColor: 'yellow', paddingX: 1, marginY: 1 },
        React.createElement(
          Box,
          { justifyContent: 'space-between' },
          React.createElement(Text, { color: 'yellow', bold: true }, 'INCOMING WEBHOOK ALERT'),
          React.createElement(Text, { dimColor: true }, msg.timestamp)
        ),
        React.createElement(
          Box,
          { marginY: 0 },
          React.createElement(Text, { color: 'magenta', bold: true }, 'Query: '),
          React.createElement(Text, null, JSON.stringify(msg.payload.query))
        ),
        React.createElement(
          Box,
          { flexDirection: 'column', marginY: 0 },
          React.createElement(Text, { color: 'magenta', bold: true }, 'Body:'),
          React.createElement(Text, { color: 'white' }, prettyJson)
        )
      );
    }

    return null;
  };

  // New larger, 100-character unbordered outer layout to perfectly prevent border overlapping glitches
  return React.createElement(
    Box,
    { flexDirection: 'column', width: 100, height: 30, padding: 0 },
    
    // Header Banner (Flat and spacious)
    React.createElement(
      Box,
      { justifyContent: 'space-between', paddingX: 1, marginY: 0 },
      React.createElement(Text, { color: 'cyan', bold: true }, 'CHITCHAT | SECURE TERMINAL VAULT'),
      React.createElement(
        Box,
        null,
        React.createElement(Text, null, 'Session: '),
        React.createElement(Text, { color: 'yellow', bold: true }, username),
        React.createElement(Text, null, ' | Gateway: '),
        React.createElement(Text, { color: isConnected ? 'green' : 'red', bold: true }, isConnected ? 'ONLINE' : 'OFFLINE')
      )
    ),

    // Clean horizontal rule divider
    React.createElement(
      Box,
      { marginY: 0 },
      React.createElement(Text, { color: 'blue' }, '─'.repeat(100))
    ),

    // Main Columns
    React.createElement(
      Box,
      { height: 23, marginY: 0 },
      
      // Left Sidebar (Isolated wall)
      React.createElement(
        Box,
        { width: 30, flexDirection: 'column', borderStyle: 'single', borderColor: 'blue', paddingX: 1 },
        React.createElement(Text, { color: 'magenta', bold: true }, 'WEBHOOK CONFIG'),
        React.createElement(Text, { dimColor: true }, 'Outgoing Webhook:'),
        React.createElement(Text, { color: 'yellow', wrap: 'truncate-end' }, activeWebhook.length > 24 ? activeWebhook.slice(0, 23) + '...' : activeWebhook),
        
        React.createElement(
          Box,
          { marginY: 1, flexDirection: 'column' },
          React.createElement(Text, { color: 'magenta', bold: true }, 'COMMAND REFERENCE'),
          React.createElement(Text, { color: 'gray' }, '/webhook <url>'),
          React.createElement(Text, { color: 'gray' }, '/webhook clear'),
          React.createElement(Text, { color: 'gray' }, '/clear'),
          React.createElement(Text, { color: 'gray' }, '/exit')
        ),

        React.createElement(
          Box,
          { flexDirection: 'column', marginTop: 'auto' },
          React.createElement(Text, { color: 'cyan', bold: true }, 'MESSAGE FORMAT'),
          React.createElement(Text, { color: 'gray' }, '@username <msg>'),
          React.createElement(Text, { color: 'gray' }, 'e.g. @Bob hello')
        )
      ),

      // Right Messages Area (Isolated wall, no overlapping borders)
      React.createElement(
        Box,
        { width: 70, flexDirection: 'column', borderStyle: 'single', borderColor: 'blue', paddingX: 1 },
        messages.length === 0
          ? React.createElement(
              Box,
              { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
              React.createElement(Text, { dimColor: true }, 'Empty channel buffer. Send message using @username <message>')
            )
          : React.createElement(
              Box,
              { flexDirection: 'column', flexGrow: 1 },
              messages.map(renderMessage)
            )
      )
    ),

    // Input Bar (Sits perfectly at the bottom)
    React.createElement(
      Box,
      { width: 100, borderStyle: 'single', borderColor: 'blue', paddingX: 1, marginY: 0 },
      React.createElement(Text, { color: 'cyan', bold: true }, `${username} > `),
      React.createElement(TextInput, {
        value: inputVal,
        onChange: setInputVal,
        onSubmit: handleSubmit,
        placeholder: lastRecipient ? `Send message to @${lastRecipient}...` : "Send message using @username..."
      })
    )
  );
}
