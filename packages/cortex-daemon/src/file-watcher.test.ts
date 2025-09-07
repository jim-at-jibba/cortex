/**
 * File Watcher Tests
 */

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { FileWatcher } from './file-watcher.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const testDir = path.join(os.tmpdir(), 'cortex-file-watcher-test');

beforeEach(async () => {
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('FileWatcher initializes with default config', () => {
  const watcher = new FileWatcher();
  
  expect(watcher.isWatching()).toBe(false);
  expect(watcher.getWatchedExtensions()).toEqual(['.md', '.markdown']);
});

test('FileWatcher initializes with custom config', () => {
  const watcher = new FileWatcher({
    fileExtensions: ['.txt', '.md'],
    debounceTime: 500
  });
  
  expect(watcher.getWatchedExtensions()).toEqual(['.txt', '.md']);
});

test('FileWatcher starts and stops successfully', async () => {
  const watcher = new FileWatcher({
    watchPaths: [testDir],
    debounceTime: 50
  });

  expect(watcher.isWatching()).toBe(false);
  
  await watcher.start();
  expect(watcher.isWatching()).toBe(true);
  
  await watcher.stop();
  expect(watcher.isWatching()).toBe(false);
});

test('FileWatcher detects file creation', async () => {
  const watcher = new FileWatcher({
    watchPaths: [testDir],
    debounceTime: 50,
    persistent: true
  });

  const events: any[] = [];
  watcher.on('fileChange', (event) => {
    events.push(event);
  });

  watcher.on('add', (event) => {
    events.push(event);
  });

  await watcher.start();
  
  // Wait for watcher to be ready
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Create a markdown file
  const testFile = path.join(testDir, 'test.md');
  await fs.writeFile(testFile, '# Test');
  
  // Wait for debounced event with extra time
  await new Promise(resolve => setTimeout(resolve, 300));
  
  await watcher.stop();
  

  expect(events.length).toBeGreaterThan(0);
  const addEvent = events.find(e => e.type === 'add');
  expect(addEvent).toBeDefined();
  expect(addEvent.filePath).toContain('test.md');
});

test('FileWatcher filters non-markdown files', async () => {
  const watcher = new FileWatcher({
    watchPaths: [testDir],
    debounceTime: 50
  });

  const events: any[] = [];
  watcher.on('fileChange', (event) => {
    events.push(event);
  });

  await watcher.start();
  
  // Wait for ready and initial dir event
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Clear initial events (like addDir)
  events.length = 0;
  
  // Create a non-markdown file
  const testFile = path.join(testDir, 'test.txt');
  await fs.writeFile(testFile, 'test content');
  
  // Wait for potential event
  await new Promise(resolve => setTimeout(resolve, 300));
  
  await watcher.stop();
  

  // Should not have any events for .txt files
  expect(events.length).toBe(0);
});

test('FileWatcher detects file changes', async () => {
  // Create file first
  const testFile = path.join(testDir, 'test.md');
  await fs.writeFile(testFile, '# Initial');

  const watcher = new FileWatcher({
    watchPaths: [testDir],
    debounceTime: 50
  });

  const events: any[] = [];
  watcher.on('fileChange', (event) => {
    events.push(event);
  });

  await watcher.start();
  
  // Wait for ready and initial events to settle
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Clear events from initial file detection
  events.length = 0;
  
  // Modify the file
  await fs.writeFile(testFile, '# Modified');
  
  // Wait for debounced event with extra time
  await new Promise(resolve => setTimeout(resolve, 300));
  
  await watcher.stop();
  

  expect(events.length).toBeGreaterThan(0);
  const changeEvent = events.find(e => e.type === 'change');
  expect(changeEvent).toBeDefined();
  expect(changeEvent.filePath).toContain('test.md');
});

test('FileWatcher detects file deletion', async () => {
  // Create file first
  const testFile = path.join(testDir, 'test.md');
  await fs.writeFile(testFile, '# Test');

  const watcher = new FileWatcher({
    watchPaths: [testDir],
    debounceTime: 50
  });

  const events: any[] = [];
  watcher.on('fileChange', (event) => {
    events.push(event);
  });

  await watcher.start();
  
  // Wait for ready and initial events to settle
  await new Promise(resolve => setTimeout(resolve, 300));
  
  // Clear events from initial file detection
  events.length = 0;
  
  // Delete the file
  await fs.unlink(testFile);
  
  // Wait for debounced event with extra time
  await new Promise(resolve => setTimeout(resolve, 300));
  
  await watcher.stop();
  

  expect(events.length).toBeGreaterThan(0);
  const unlinkEvent = events.find(e => e.type === 'unlink');
  expect(unlinkEvent).toBeDefined();
  expect(unlinkEvent.filePath).toContain('test.md');
});

test('FileWatcher can add and remove watch paths', () => {
  const watcher = new FileWatcher({
    watchPaths: [testDir],
    debounceTime: 50
  });

  expect(watcher.getWatchedPaths()).toEqual([testDir]);
  
  watcher.addWatchPath('/some/other/path');
  expect(watcher.getWatchedPaths()).toContain('/some/other/path');
  
  watcher.removeWatchPath('/some/other/path');
  expect(watcher.getWatchedPaths()).not.toContain('/some/other/path');
  expect(watcher.getWatchedPaths()).toContain(testDir);
});