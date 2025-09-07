import { test, expect, beforeEach, afterEach } from 'bun:test';
import { CortexDaemon, DaemonManager } from './index.js';
import fs from 'fs/promises';

const TEST_PID_FILE = '.test-cortex-daemon.pid';
const TEST_LOG_FILE = '.test-cortex-daemon.log';

beforeEach(async () => {
  // Clean up any existing test files
  await fs.unlink(TEST_PID_FILE).catch(() => {});
  await fs.unlink(TEST_LOG_FILE).catch(() => {});
});

afterEach(async () => {
  // Clean up test files
  await fs.unlink(TEST_PID_FILE).catch(() => {});
  await fs.unlink(TEST_LOG_FILE).catch(() => {});
});

test('CortexDaemon - basic lifecycle', async () => {
  const daemon = new CortexDaemon({
    pidFile: TEST_PID_FILE,
    logFile: TEST_LOG_FILE,
    healthCheckInterval: 1000
  });

  // Initially not running
  expect(daemon.getStatus().running).toBe(false);

  // Start daemon
  await daemon.start();
  expect(daemon.getStatus().running).toBe(true);
  expect(daemon.getStatus().pid).toBe(process.pid);

  // PID file should exist
  const pidContent = await fs.readFile(TEST_PID_FILE, 'utf-8');
  expect(parseInt(pidContent.trim())).toBe(process.pid);

  // Stop daemon
  await daemon.stop();
  expect(daemon.getStatus().running).toBe(false);

  // PID file should be removed
  try {
    await fs.access(TEST_PID_FILE);
    throw new Error('PID file should not exist');
  } catch (error: any) {
    expect(error.code).toBe('ENOENT');
  }
});

test('CortexDaemon - signal handling setup', () => {
  // Should not throw when setting up signal handlers
  expect(() => {
    new CortexDaemon({
      pidFile: TEST_PID_FILE,
      logFile: TEST_LOG_FILE
    });
  }).not.toThrow();
});

test('CortexDaemon - event emitting', async () => {
  const daemon = new CortexDaemon({
    pidFile: TEST_PID_FILE,
    logFile: TEST_LOG_FILE,
    healthCheckInterval: 100
  });

  let startEmitted = false;
  let stopEmitted = false;
  let logEmitted = false;

  daemon.on('start', () => {
    startEmitted = true;
  });

  daemon.on('stop', () => {
    stopEmitted = true;
  });

  daemon.on('log', () => {
    logEmitted = true;
  });

  await daemon.start();
  expect(startEmitted).toBe(true);
  expect(logEmitted).toBe(true);

  await daemon.stop();
  expect(stopEmitted).toBe(true);
});

test('CortexDaemon - job counting', async () => {
  const daemon = new CortexDaemon({
    pidFile: TEST_PID_FILE,
    logFile: TEST_LOG_FILE
  });

  await daemon.start();

  expect(daemon.getStatus().processedJobs).toBe(0);
  expect(daemon.getStatus().failedJobs).toBe(0);

  daemon.incrementProcessedJobs();
  daemon.incrementProcessedJobs();
  daemon.incrementFailedJobs();

  expect(daemon.getStatus().processedJobs).toBe(2);
  expect(daemon.getStatus().failedJobs).toBe(1);

  await daemon.stop();
});

test('DaemonManager - singleton pattern', () => {
  const manager1 = DaemonManager.getInstance();
  const manager2 = DaemonManager.getInstance();
  
  expect(manager1).toBe(manager2);
});

test('DaemonManager - status when no daemon running', async () => {
  const manager = DaemonManager.getInstance();
  const status = await manager.getDaemonStatus();
  
  expect(status).toBeNull();
});

test('CortexDaemon - restart functionality', async () => {
  const daemon = new CortexDaemon({
    pidFile: TEST_PID_FILE,
    logFile: TEST_LOG_FILE
  });

  await daemon.start();
  expect(daemon.getStatus().running).toBe(true);

  await daemon.restart();
  expect(daemon.getStatus().running).toBe(true);

  await daemon.stop();
});

test('CortexDaemon - configuration override', () => {
  const customConfig = {
    pidFile: '/custom/path/daemon.pid',
    logFile: '/custom/path/daemon.log',
    watchPaths: ['/custom/watch/path'],
    maxRetries: 10,
    retryDelay: 2000,
    healthCheckInterval: 15000
  };

  const daemon = new CortexDaemon(customConfig);
  
  // Config should be merged with defaults
  const status = daemon.getStatus();
  expect(status.running).toBe(false);
  expect(status.processedJobs).toBe(0);
});