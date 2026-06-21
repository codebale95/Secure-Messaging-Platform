#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import App from './src/app.js';

// Suppress experimental fetch warning messages
const originalEmit = process.emit;
process.emit = function (name, data, ...args) {
  if (name === 'warning' && typeof data === 'object' && data.name === 'ExperimentalWarning') {
    return false;
  }
  return originalEmit.call(process, name, data, ...args);
};

// Render Ink app natively using React.createElement
render(React.createElement(App));
