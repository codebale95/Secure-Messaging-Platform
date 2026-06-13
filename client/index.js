#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import minimist from 'minimist';
import App from './src/app.js';

// Parse command-line arguments
const argv = minimist(process.argv.slice(2), {
  string: ['username'],
  alias: {
    u: 'username'
  }
});

// Generate default username if not provided
const username = argv.username || `User-${Math.floor(1000 + Math.random() * 9000)}`;

// Suppress experimental fetch warning messages
const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
  if (name === 'warning' && typeof data === 'object' && data.name === 'ExperimentalWarning') {
    return false;
  }
  return originalEmit.call(process, name, data, ...args);
};

// Render Ink app natively using React.createElement
render(React.createElement(App, { username }));
