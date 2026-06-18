const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const supabase = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Active users
const activeUsers = new Map();

// Public Keys for ECDH
const publicKeys = new Map();

// Offline webhook storage (still in memory)
const offlineWebhooks = new Map();


// =============================
// WEBHOOK ENDPOINT
// =============================
app.post('/api/webhooks/incoming/:username', (req, res) => {
  const { username } = req.params;

  const payload = {
    timestamp: new Date().toISOString(),
    headers: req.headers,
    query: req.query,
    body: req.body
  };

  const recipientSocket = activeUsers.get(username);

  if (recipientSocket && recipientSocket.connected) {

    recipientSocket.emit('webhook-payload', payload);

    return res.status(200).json({
      status: 'delivered',
      message: `Webhook delivered to '${username}'`
    });

  } else {

    if (!offlineWebhooks.has(username)) {
      offlineWebhooks.set(username, []);
    }

    offlineWebhooks.get(username).push(payload);

    if (offlineWebhooks.get(username).length > 50) {
      offlineWebhooks.get(username).shift();
    }

    return res.status(202).json({
      status: 'buffered',
      message: `User '${username}' offline. Webhook buffered.`
    });
  }
});


// =============================
// SOCKET.IO
// =============================
io.on('connection', (socket) => {

  let registeredUsername = null;

  // =============================
  // REGISTER USER
  // =============================
  socket.on('register', async (payload) => {
    
    const username = typeof payload === 'string' ? payload : payload.username;
    const publicKey = payload.publicKey;

    if (!username || typeof username !== 'string') {
      socket.emit('sys-alert', {
        type: 'error',
        message: 'Invalid username'
      });
      return;
    }

    if (publicKey) {
      publicKeys.set(username, publicKey);
    }

    const existingSocket = activeUsers.get(username);

    if (
      existingSocket &&
      existingSocket.id !== socket.id
    ) {
      socket.emit('sys-alert', {
        type: 'error',
        message: `Username '${username}' already in use`
      });
      return;
    }

    registeredUsername = username;

    activeUsers.set(username, socket);

    socket.emit('sys-alert', {
      type: 'success',
      message: `Session established for user '${username}'. Registration complete.`
    });

    socket.broadcast.emit('sys-event', {
      type: 'info',
      message: `${username} online.`
    });

    // =============================
    // DELIVER OFFLINE DATABASE MESSAGES
    // =============================
    try {

      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('recipient', username)
        .eq('delivered', false)
        .order('created_at', { ascending: true });

      if (error) throw error;

      for (const msg of messages || []) {

        socket.emit('message-received', {
          sender: msg.sender,
          content: msg.content,
          timestamp: msg.created_at
        });

        await supabase
          .from('messages')
          .update({ delivered: true })
          .eq('id', msg.id);
      }

      if (messages && messages.length > 0) {

        socket.emit('sys-alert', {
          type: 'info',
          message: `${messages.length} offline message(s) delivered.`
        });

      }

    } catch (err) {

      console.error('Failed to load offline messages:', err);

    }

    // =============================
    // DELIVER OFFLINE WEBHOOKS
    // =============================
    const pending = offlineWebhooks.get(username);

    if (pending && pending.length > 0) {

      socket.emit('sys-alert', {
        type: 'info',
        message: `Retrieved ${pending.length} buffered webhook event(s).`
      });

      pending.forEach((payload) => {
        socket.emit('webhook-payload', payload);
      });

      offlineWebhooks.delete(username);
    }

  });

  // =============================
  // PUBLIC KEY EXCHANGE
  // =============================
  socket.on('get-public-key', (targetUser, callback) => {
    callback(publicKeys.get(targetUser) || null);
  });

  // =============================
  // DIRECT MESSAGE
  // =============================
  socket.on('direct-message', async ({ recipient, content }) => {

    if (!registeredUsername) {

      socket.emit('sys-alert', {
        type: 'error',
        message: 'You must register first.'
      });

      return;
    }

    if (!recipient || !content) {
      return;
    }

    const recipientSocket = activeUsers.get(recipient);

    const messagePayload = {
      sender: registeredUsername,
      content,
      timestamp: new Date().toISOString()
    };

    socket.emit('message-sent', {
      recipient,
      content,
      timestamp: messagePayload.timestamp
    });

    // =============================
    // CHECK IF ONLINE
    // =============================
    const isOnline = recipientSocket && recipientSocket.connected;

    if (isOnline) {
      recipientSocket.emit('message-received', messagePayload);
    }

    // =============================
    // SAVE EVERY MESSAGE TO DB
    // =============================
    try {

      const { error } = await supabase
        .from('messages')
        .insert({
          sender: registeredUsername,
          recipient: recipient,
          content: content,
          delivered: isOnline
        });
      if (error) throw error;

      if (!isOnline) {
        socket.emit('sys-alert', {
          type: 'warning',
          message: `Recipient '${recipient}' is offline. Message stored in database.`
        });
      }

    } catch (err) {

      console.error('Database insert error:', err);

      socket.emit('sys-alert', {
        type: 'error',
        message: 'Failed to store message.'
      });

    }

  });


  // =============================
  // DISCONNECT
  // =============================
  socket.on('disconnect', () => {

    if (registeredUsername) {

      activeUsers.delete(
        registeredUsername
      );
      // Keep public key in memory so offline users can still receive E2EE messages!

      socket.broadcast.emit('sys-event', {
        type: 'info',
        message: `${registeredUsername} offline.`
      });

    }

  });

});


// =============================
// START SERVER
// =============================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log('\n==================================================');
  console.log('ChitChat Secure Gateway (Server)');
  console.log(`Blind Router active on port ${PORT}`);
  console.log(
    `Incoming webhooks: http://localhost:${PORT}/api/webhooks/incoming/:username`
  );
  console.log('==================================================\n');

});