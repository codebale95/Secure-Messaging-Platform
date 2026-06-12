const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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

// Map to store active connections: username -> socket
const activeUsers = new Map();
// Simple in-memory queue for offline webhook messages: username -> Array of payloads
const offlineWebhooks = new Map();

// HTTP Incoming Webhook Endpoint
// Exposes POST /api/webhooks/incoming/:username
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
    // Deliver instantly via Socket.io
    recipientSocket.emit('webhook-payload', payload);
    return res.status(200).json({
      status: 'delivered',
      message: `Webhook payload delivered to active session of user '${username}'`
    });
  } else {
    // Buffer the webhook payload in memory for when the user logs in
    if (!offlineWebhooks.has(username)) {
      offlineWebhooks.set(username, []);
    }
    offlineWebhooks.get(username).push(payload);
    
    // Cap offline buffer size to prevent memory leaks
    if (offlineWebhooks.get(username).length > 50) {
      offlineWebhooks.get(username).shift();
    }

    return res.status(202).json({
      status: 'buffered',
      message: `User '${username}' is currently offline. Webhook payload has been buffered in memory.`
    });
  }
});

// Socket.io connection logic
io.on('connection', (socket) => {
  let registeredUsername = null;

  // Handle user registration
  socket.on('register', (username) => {
    if (!username || typeof username !== 'string') {
      socket.emit('sys-alert', { type: 'error', message: 'Invalid username' });
      return;
    }

    // Check if username is already taken by a different socket
    const existingSocket = activeUsers.get(username);
    if (existingSocket && existingSocket.id !== socket.id) {
      socket.emit('sys-alert', { type: 'error', message: `Username '${username}' is already in use by another session.` });
      return;
    }

    registeredUsername = username;
    activeUsers.set(username, socket);

    socket.emit('sys-alert', {
      type: 'success',
      message: `Session established for user '${username}'. Registration complete.`
    });

    // Notify others that a user has joined
    socket.broadcast.emit('sys-event', {
      type: 'info',
      message: `${username} online.`
    });

    // Check if there are any buffered webhooks for this user
    const pending = offlineWebhooks.get(username);
    if (pending && pending.length > 0) {
      socket.emit('sys-alert', {
        type: 'info',
        message: `Retrieved ${pending.length} buffered webhook event(s) from offline storage.`
      });
      // Deliver all pending webhooks
      pending.forEach((payload) => {
        socket.emit('webhook-payload', payload);
      });
      // Clear queue
      offlineWebhooks.delete(username);
    }
  });

  // Handle direct messaging between users
  socket.on('direct-message', ({ recipient, content }) => {
    if (!registeredUsername) {
      socket.emit('sys-alert', { type: 'error', message: 'You must register a username first.' });
      return;
    }

    if (!recipient || !content) {
      return;
    }

    const recipientSocket = activeUsers.get(recipient);
    const messagePayload = {
      sender: registeredUsername,
      content: content,
      timestamp: new Date().toISOString()
    };

    // Send back to sender for visual rendering confirmation
    socket.emit('message-sent', { recipient, content, timestamp: messagePayload.timestamp });

    if (recipientSocket && recipientSocket.connected) {
      recipientSocket.emit('message-received', messagePayload);
    } else {
      socket.emit('sys-alert', {
        type: 'warning',
        message: `Recipient '${recipient}' is offline. Delivery pending.`
      });
    }
  });

  // Handle join group
  socket.on('join-group', (groupName) => {
    if (!registeredUsername) {
      socket.emit('sys-alert', { type: 'error', message: 'You must register a username first.' });
      return;
    }
    if (!groupName) return;

    socket.join(groupName);
    socket.emit('sys-alert', { type: 'success', message: `Joined group #${groupName}` });
    socket.to(groupName).emit('sys-event', { type: 'info', message: `${registeredUsername} joined #${groupName}` });
  });

  // Handle leave group
  socket.on('leave-group', (groupName) => {
    if (!registeredUsername) return;
    if (!groupName) return;

    socket.leave(groupName);
    socket.emit('sys-alert', { type: 'info', message: `Left group #${groupName}` });
    socket.to(groupName).emit('sys-event', { type: 'info', message: `${registeredUsername} left #${groupName}` });
  });

  // Handle group messaging
  socket.on('group-message', ({ group, content }) => {
    if (!registeredUsername) {
      socket.emit('sys-alert', { type: 'error', message: 'You must register a username first.' });
      return;
    }

    if (!group || !content) return;

    const messagePayload = {
      sender: registeredUsername,
      group: group,
      content: content,
      timestamp: new Date().toISOString()
    };

    // Send back to sender for visual rendering confirmation
    socket.emit('group-message-sent', { group, content, timestamp: messagePayload.timestamp });

    // Broadcast to the room, except sender
    socket.to(group).emit('group-message-received', messagePayload);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (registeredUsername) {
      activeUsers.delete(registeredUsername);
      socket.broadcast.emit('sys-event', {
        type: 'info',
        message: `${registeredUsername} offline.`
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`ChitChat Secure Gateway (Server)`);
  console.log(`Blind Router active on port :${PORT}`);
  console.log(`Incoming webhooks: http://localhost:${PORT}/api/webhooks/incoming/:username`);
  console.log(`==================================================\n`);
});
