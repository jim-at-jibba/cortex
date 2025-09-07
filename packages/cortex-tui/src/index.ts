/**
 * Cortex TUI - Terminal User Interface
 * Interactive terminal interface using Ink
 */

import React from 'react';
import { render } from 'ink';
import { App } from './components/App';

export function startTUI(): void {
  console.log('Starting Cortex TUI...');
  
  // Clear screen and hide cursor for better TUI experience
  process.stdout.write('\x1b[2J\x1b[0f');
  process.stdout.write('\x1b[?25l');
  
  // Restore cursor on exit
  process.on('exit', () => {
    process.stdout.write('\x1b[?25h');
  });
  
  // Render the main app
  render(React.createElement(App));
}

// Export components for external use
export * from './components/App';
export * from './components/FileExplorer';
export * from './components/PreviewPane';
export * from './components/ChatPane';
export * from './components/StatusBar';
export * from './hooks/useKeyboard';
export * from './hooks/useSearch';
export * from './utils/markdown';