const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pool = require('./db');

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
  socket.on('register', async (username) => {

    if (!username || typeof username !== 'string') {
      socket.emit('sys-alert', {
        type: 'error',
        message: 'Invalid username'
      });
      return;
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

      const result = await pool.query(
        `
        SELECT *
        FROM messages
        WHERE recipient = $1
        AND delivered = FALSE
        ORDER BY created_at ASC
        `,
        [username]
      );

      for (const msg of result.rows) {

        socket.emit('message-received', {
          sender: msg.sender,
          content: msg.content,
          timestamp: msg.created_at
        });

        await pool.query(
          `
          UPDATE messages
          SET delivered = TRUE
          WHERE id = $1
          `,
          [msg.id]
        );
      }

      if (result.rows.length > 0) {

        socket.emit('sys-alert', {
          type: 'info',
          message: `${result.rows.length} offline message(s) delivered.`
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
    // USER ONLINE
    // =============================
    if (
      recipientSocket &&
      recipientSocket.connected
    ) {

      recipientSocket.emit(
        'message-received',
        messagePayload
      );

      return;
    }

    // =============================
    // USER OFFLINE -> SAVE TO DB
    // =============================
    try {

      await pool.query(
        `
        INSERT INTO messages
        (sender, recipient, content, delivered)
        VALUES ($1, $2, $3, FALSE)
        `,
        [
          registeredUsername,
          recipient,
          content
        ]
      );

      socket.emit('sys-alert', {
        type: 'warning',
        message: `Recipient '${recipient}' is offline. Message stored in database.`
      });

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