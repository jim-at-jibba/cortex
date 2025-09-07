#!/usr/bin/env bun

/**
 * Simple TUI test runner
 * Run with: bun test-tui.ts
 */

import { startTUI } from './index';

console.log('🚀 Starting Cortex TUI Test...');
console.log('');
console.log('Expected behavior:');
console.log('- Three-pane layout with borders');
console.log('- File explorer on left');
console.log('- Preview pane in center');
console.log('- Chat/search pane on right');
console.log('- Status bar at bottom');
console.log('- Keyboard navigation: h/l for panes, Ctrl+F for search, q to quit');
console.log('');
console.log('Press any key to start...');

// Simple test version
startTUI();