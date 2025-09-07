#!/usr/bin/env bun
/**
 * Daemon Process Entry Point
 * This file is executed as a detached process
 */

import { CortexDaemon } from './index.js';

async function main() {
  const daemon = new CortexDaemon();
  
  daemon.on('start', () => {
    console.log('Detached daemon started successfully');
  });
  
  daemon.on('stop', () => {
    console.log('Detached daemon stopped');
    process.exit(0);
  });
  
  daemon.on('log', ({ level, message }) => {
    if (level === 'error') {
      console.error(message);
    } else {
      console.log(message);
    }
  });

  try {
    await daemon.start();
    
    // Keep process alive
    process.on('message', async (msg) => {
      if (msg === 'shutdown') {
        await daemon.stop();
      }
    });
    
  } catch (error) {
    console.error('Failed to start daemon:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Daemon process error:', error);
  process.exit(1);
});