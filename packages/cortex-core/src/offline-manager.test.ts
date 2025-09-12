import { test, expect } from 'bun:test';
import { OfflineManager, OfflineMode, NetworkStatus, JobPriority, JobType } from './offline-manager.js';
import fs from 'fs/promises';
import path from 'path';

// Mock job queue
class MockJobQueue {
  addJobCalls: Array<{ type: JobType; payload: any; priority: JobPriority; filePath?: string }> = [];

  addJob(type: JobType, payload: any, priority: JobPriority, filePath?: string): string {
    this.addJobCalls.push({ type, payload, priority, filePath });
    return `job_${this.addJobCalls.length}`;
  }
}

// Mock config
const mockCortexConfig = {
  notesPath: '/tmp/test-notes',
  templatesPath: '/tmp/test-templates',
  databasePath: '/tmp/test.db',
  aiProvider: 'openai' as const,
  embeddingModel: 'text-embedding-ada-002',
  chatModel: 'gpt-4',
  apiKeys: { openai: 'test-key' },
  autoCommit: true,
  daemon: { enabled: true, port: 3001 }
};

test('should initialize with correct default values', async () => {
  const tempDir = path.join('/tmp', `cortex-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const queuePath = path.join(tempDir, 'test-queue.json');
  
  const mockJobQueue = new MockJobQueue();
  const offlineManager = new OfflineManager({
    queuePersistencePath: queuePath,
    maxQueueSize: 100,
    processingBatchSize: 5,
    networkCheck: {
      checkInterval: 1000,
      timeout: 1000,
      retryAttempts: 1,
      endpoints: ['https://httpbin.org/get'],
      offlineThreshold: 2
    }
  });

  const status = offlineManager.getStatus();
  
  expect(status.mode).toBe(OfflineMode.AUTO);
  expect(status.networkStatus).toBe(NetworkStatus.UNKNOWN);
  expect(status.queueSize).toBe(0);
  expect(status.isProcessing).toBe(false);
  expect(status.totalProcessed).toBe(0);
  expect(status.totalFailed).toBe(0);
  
  await offlineManager.shutdown();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('should queue embedding request successfully', async () => {
  const tempDir = path.join('/tmp', `cortex-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const queuePath = path.join(tempDir, 'test-queue.json');
  
  const mockJobQueue = new MockJobQueue();
  const offlineManager = new OfflineManager({
    queuePersistencePath: queuePath,
    maxQueueSize: 100,
    processingBatchSize: 5,
    networkCheck: {
      checkInterval: 1000,
      timeout: 1000,
      retryAttempts: 1,
      endpoints: ['https://httpbin.org/get'],
      offlineThreshold: 2
    }
  });

  await offlineManager.initialize(mockCortexConfig, mockJobQueue);
  
  const requestId = await offlineManager.queueEmbeddingRequest('test text', {
    filePath: '/test/file.md',
    priority: JobPriority.HIGH
  });
  
  expect(requestId).toBeDefined();
  expect(typeof requestId).toBe('string');
  
  const status = offlineManager.getStatus();
  expect(status.queueSize).toBe(1);
  
  const queuedRequests = offlineManager.getQueuedRequests();
  expect(queuedRequests).toHaveLength(1);
  expect(queuedRequests[0]?.text).toBe('test text');
  expect(queuedRequests[0]?.priority).toBe(JobPriority.HIGH);
  
  await offlineManager.shutdown();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('should throw error when queue is full', async () => {
  const tempDir = path.join('/tmp', `cortex-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const queuePath = path.join(tempDir, 'test-queue.json');
  
  const mockJobQueue = new MockJobQueue();
  const offlineManager = new OfflineManager({
    queuePersistencePath: queuePath,
    maxQueueSize: 2, // Small queue for testing
    processingBatchSize: 5,
    networkCheck: {
      checkInterval: 1000,
      timeout: 1000,
      retryAttempts: 1,
      endpoints: ['https://httpbin.org/get'],
      offlineThreshold: 2
    }
  });

  await offlineManager.initialize(mockCortexConfig, mockJobQueue);
  
  // Fill the queue to max size
  await offlineManager.queueEmbeddingRequest('test text 1');
  await offlineManager.queueEmbeddingRequest('test text 2');
  
  // Try to add one more
  await expect(
    offlineManager.queueEmbeddingRequest('overflow text')
  ).rejects.toThrow('Offline queue is full');
  
  await offlineManager.shutdown();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('should set offline mode correctly', async () => {
  const tempDir = path.join('/tmp', `cortex-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const queuePath = path.join(tempDir, 'test-queue.json');
  
  const mockJobQueue = new MockJobQueue();
  const offlineManager = new OfflineManager({
    queuePersistencePath: queuePath,
    maxQueueSize: 100,
    processingBatchSize: 5,
    networkCheck: {
      checkInterval: 1000,
      timeout: 1000,
      retryAttempts: 1,
      endpoints: ['https://httpbin.org/get'],
      offlineThreshold: 2
    }
  });

  await offlineManager.initialize(mockCortexConfig, mockJobQueue);
  
  // Test force offline mode
  offlineManager.setOfflineMode(OfflineMode.FORCE_OFFLINE);
  let status = offlineManager.getStatus();
  expect(status.mode).toBe(OfflineMode.FORCE_OFFLINE);
  expect(status.networkStatus).toBe(NetworkStatus.OFFLINE);
  
  // Test force online mode
  offlineManager.setOfflineMode(OfflineMode.FORCE_ONLINE);
  status = offlineManager.getStatus();
  expect(status.mode).toBe(OfflineMode.FORCE_ONLINE);
  expect(status.networkStatus).toBe(NetworkStatus.ONLINE);
  
  await offlineManager.shutdown();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('should clear queue successfully', async () => {
  const tempDir = path.join('/tmp', `cortex-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const queuePath = path.join(tempDir, 'test-queue.json');
  
  const mockJobQueue = new MockJobQueue();
  const offlineManager = new OfflineManager({
    queuePersistencePath: queuePath,
    maxQueueSize: 100,
    processingBatchSize: 5,
    networkCheck: {
      checkInterval: 1000,
      timeout: 1000,
      retryAttempts: 1,
      endpoints: ['https://httpbin.org/get'],
      offlineThreshold: 2
    }
  });

  await offlineManager.initialize(mockCortexConfig, mockJobQueue);
  
  // Add some requests
  await offlineManager.queueEmbeddingRequest('test 1');
  await offlineManager.queueEmbeddingRequest('test 2');
  await offlineManager.queueEmbeddingRequest('test 3');
  
  expect(offlineManager.getStatus().queueSize).toBe(3);
  
  const clearedCount = offlineManager.clearQueue();
  expect(clearedCount).toBe(3);
  expect(offlineManager.getStatus().queueSize).toBe(0);
  
  await offlineManager.shutdown();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('should process queue when online', async () => {
  const tempDir = path.join('/tmp', `cortex-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const queuePath = path.join(tempDir, 'test-queue.json');
  
  const mockJobQueue = new MockJobQueue();
  const offlineManager = new OfflineManager({
    queuePersistencePath: queuePath,
    maxQueueSize: 100,
    processingBatchSize: 5,
    networkCheck: {
      checkInterval: 1000,
      timeout: 1000,
      retryAttempts: 1,
      endpoints: ['https://httpbin.org/get'],
      offlineThreshold: 2
    }
  });

  await offlineManager.initialize(mockCortexConfig, mockJobQueue);
  
  // Set to online mode
  offlineManager.setOfflineMode(OfflineMode.FORCE_ONLINE);
  
  // Add some requests
  await offlineManager.queueEmbeddingRequest('test 1');
  await offlineManager.queueEmbeddingRequest('test 2');
  
  expect(offlineManager.getStatus().queueSize).toBe(2);
  
  // Process queue
  const processedCount = await offlineManager.processQueue();
  
  expect(processedCount).toBe(2);
  expect(offlineManager.getStatus().queueSize).toBe(0);
  expect(mockJobQueue.addJobCalls).toHaveLength(2);
  
  // Check that jobs were added correctly
  expect(mockJobQueue.addJobCalls[0]?.type).toBe(JobType.EMBEDDING_GENERATION);
  expect(mockJobQueue.addJobCalls[0]?.payload.text).toBe('test 1');
  expect(mockJobQueue.addJobCalls[1]?.payload.text).toBe('test 2');
  
  await offlineManager.shutdown();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('should not process queue when offline', async () => {
  const tempDir = path.join('/tmp', `cortex-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const queuePath = path.join(tempDir, 'test-queue.json');
  
  const mockJobQueue = new MockJobQueue();
  const offlineManager = new OfflineManager({
    queuePersistencePath: queuePath,
    maxQueueSize: 100,
    processingBatchSize: 5,
    networkCheck: {
      checkInterval: 1000,
      timeout: 1000,
      retryAttempts: 1,
      endpoints: ['https://httpbin.org/get'],
      offlineThreshold: 2
    }
  });

  await offlineManager.initialize(mockCortexConfig, mockJobQueue);
  
  // Set to offline mode
  offlineManager.setOfflineMode(OfflineMode.FORCE_OFFLINE);
  
  // Add some requests
  await offlineManager.queueEmbeddingRequest('test 1');
  await offlineManager.queueEmbeddingRequest('test 2');
  
  expect(offlineManager.getStatus().queueSize).toBe(2);
  
  // Try to process queue
  const processedCount = await offlineManager.processQueue();
  
  expect(processedCount).toBe(0); // Should not process when offline
  expect(offlineManager.getStatus().queueSize).toBe(2); // Queue should remain unchanged
  expect(mockJobQueue.addJobCalls).toHaveLength(0); // No jobs should be added
  
  await offlineManager.shutdown();
  await fs.rm(tempDir, { recursive: true, force: true });
});