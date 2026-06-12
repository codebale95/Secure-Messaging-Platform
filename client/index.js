#!/usr/bin/env node

// Suppress socket.io / engine.io debug output — must be set before any imports.
process.env.DEBUG = '';

import minimist from 'minimist';
import { io } from 'socket.io-client';
import { createApp } from './src/app.js';

// Parse command-line arguments
const argv = minimist(process.argv.slice(2), {
  string: ['username'],
  alias: { u: 'username' }
});

const username = argv.username || `User-${Math.floor(1000 + Math.random() * 9000)}`;

// Suppress Node.js ExperimentalWarning messages
const _emit = process.emit;
process.emit = function (name, data, ...args) {
  if (name === 'warning' && typeof data === 'object' && data.name === 'ExperimentalWarning') {
    return false;
  }
  return _emit.call(process, name, data, ...args);
};

// Create the socket exactly once — passed as a plain argument, not a React prop.
// createApp() is called once and never again. No render() loop.
const socket = io('http://localhost:3000', { autoConnect: true });

createApp({ username, socket });
