/**
 * Job Queue Tests
 */

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { JobQueue, JobType, JobPriority, JobStatus } from './job-queue.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const testDir = path.join(os.tmpdir(), 'cortex-job-queue-test');
const persistenceFile = path.join(testDir, 'jobs.json');

beforeEach(async () => {
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('JobQueue initializes with default config', () => {
  const queue = new JobQueue();
  expect(queue.getQueueStatus().totalInQueue).toBe(0);
});

test('JobQueue adds jobs with priority ordering', () => {
  const queue = new JobQueue();
  
  // Add jobs with different priorities
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'low.md' }, JobPriority.LOW);
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'high.md' }, JobPriority.HIGH);
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'medium.md' }, JobPriority.MEDIUM);
  
  const status = queue.getQueueStatus();
  expect(status.totalInQueue).toBe(3);
  expect(status.pending).toBe(3);
});

test('JobQueue processes jobs in priority order', async () => {
  const queue = new JobQueue({ maxConcurrentJobs: 1 });
  const processedJobs: string[] = [];
  
  // Register a mock processor
  queue.registerProcessor(JobType.EMBEDDING_GENERATION, async (job) => {
    processedJobs.push(job.payload.file);
    await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
    return { success: true };
  });
  
  // Add jobs with different priorities
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'low.md' }, JobPriority.LOW);
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'high.md' }, JobPriority.HIGH);
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'medium.md' }, JobPriority.MEDIUM);
  
  await queue.start();
  
  // Wait for jobs to process
  await new Promise(resolve => setTimeout(resolve, 400));
  
  await queue.stop();
  
  // Should process in priority order: HIGH, MEDIUM, LOW
  expect(processedJobs.length).toBe(3);
  expect(processedJobs[0]).toBe('high.md');
  expect(processedJobs[1]).toBe('medium.md');
  expect(processedJobs[2]).toBe('low.md');
});

test('JobQueue handles job failures and retries', async () => {
  const queue = new JobQueue({ maxRetries: 2, retryDelay: 100 });
  let attempts = 0;
  
  queue.registerProcessor(JobType.EMBEDDING_GENERATION, async (_job) => {
    attempts++;
    if (attempts < 3) {
      throw new Error('Simulated failure');
    }
    return { success: true };
  });
  
  const jobId = queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'test.md' });
  
  await queue.start();
  
  // Wait for retries to complete
  await new Promise(resolve => setTimeout(resolve, 800));
  
  const job = queue.getJob(jobId);
  expect(job?.status).toBe(JobStatus.COMPLETED);
  expect(job?.attempts).toBe(3);
  
  await queue.stop();
});

test('JobQueue fails job after max retries', async () => {
  const queue = new JobQueue({ maxRetries: 1, retryDelay: 100 });
  
  queue.registerProcessor(JobType.EMBEDDING_GENERATION, async () => {
    throw new Error('Always fails');
  });
  
  const jobId = queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'test.md' });
  
  await queue.start();
  
  // Wait for retries to exhaust
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const job = queue.getJob(jobId);
  expect(job?.status).toBe(JobStatus.FAILED);
  expect(job?.attempts).toBe(2); // Initial + 1 retry
  
  await queue.stop();
});

test('JobQueue handles batch operations', () => {
  const queue = new JobQueue();
  
  const jobIds = queue.addBatchJobs([
    { type: JobType.EMBEDDING_GENERATION, payload: { file: '1.md' } },
    { type: JobType.INDEX_UPDATE, payload: { index: 'main' } },
    { type: JobType.FILE_PROCESSING, payload: { file: '2.md' }, priority: JobPriority.HIGH }
  ]);
  
  expect(jobIds.length).toBe(3);
  expect(queue.getQueueStatus().totalInQueue).toBe(3);
});

test('JobQueue filters jobs by type and status', async () => {
  const queue = new JobQueue();
  
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: '1.md' });
  queue.addJob(JobType.INDEX_UPDATE, { index: 'main' });
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: '2.md' });
  
  const embeddingJobs = queue.getJobsByType(JobType.EMBEDDING_GENERATION);
  const pendingJobs = queue.getJobsByStatus(JobStatus.PENDING);
  
  expect(embeddingJobs.length).toBe(2);
  expect(pendingJobs.length).toBe(3);
});

test('JobQueue removes and clears jobs', async () => {
  const queue = new JobQueue();
  
  const jobId1 = queue.addJob(JobType.EMBEDDING_GENERATION, { file: '1.md' });
  const jobId2 = queue.addJob(JobType.INDEX_UPDATE, { index: 'main' });
  
  expect(queue.getQueueStatus().totalInQueue).toBe(2);
  
  const removed = queue.removeJob(jobId1);
  expect(removed).toBe(true);
  expect(queue.getQueueStatus().totalInQueue).toBe(1);
  
  // Simulate completed job
  const job2 = queue.getJob(jobId2);
  if (job2) {
    job2.status = JobStatus.COMPLETED;
  }
  
  const cleared = queue.clearCompletedJobs();
  expect(cleared).toBe(1);
  expect(queue.getQueueStatus().totalInQueue).toBe(0);
});

test('JobQueue persists and loads jobs', async () => {
  // Create a manual persistence file with pending jobs
  const jobs = [
    {
      "id": "job_test_1",
      "type": "embedding_generation",
      "priority": 1,
      "status": "pending",
      "payload": { "file": "1.md" },
      "createdAt": new Date().toISOString(),
      "updatedAt": new Date().toISOString(),
      "attempts": 0,
      "maxRetries": 3
    },
    {
      "id": "job_test_2",
      "type": "index_update", 
      "priority": 1,
      "status": "pending",
      "payload": { "index": "main" },
      "createdAt": new Date().toISOString(),
      "updatedAt": new Date().toISOString(),
      "attempts": 0,
      "maxRetries": 3
    }
  ];
  
  await fs.writeFile(persistenceFile, JSON.stringify(jobs, null, 2));
  
  // Create queue and load persisted jobs
  const queue = new JobQueue({ persistencePath: persistenceFile });
  
  // Register processors so jobs don't fail immediately
  queue.registerProcessor(JobType.EMBEDDING_GENERATION, async () => ({ success: true }));
  queue.registerProcessor(JobType.INDEX_UPDATE, async () => ({ success: true }));
  
  await queue.start();
  
  // Wait a moment for processing to settle but not complete
  await new Promise(resolve => setTimeout(resolve, 50));
  
  expect(queue.getQueueStatus().totalInQueue).toBe(2);
  
  // Wait for jobs to complete
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const completedJobs = queue.getJobsByStatus(JobStatus.COMPLETED);
  expect(completedJobs.length).toBe(2);
  
  await queue.stop();
});

test('JobQueue handles concurrent job processing', async () => {
  const queue = new JobQueue({ maxConcurrentJobs: 3 });
  const processedJobIds = new Set();
  
  queue.registerProcessor(JobType.EMBEDDING_GENERATION, async (job) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    processedJobIds.add(job.id);
    return { success: true };
  });
  
  // Add multiple jobs
  for (let i = 0; i < 5; i++) {
    queue.addJob(JobType.EMBEDDING_GENERATION, { file: `${i}.md` });
  }
  
  const startTime = Date.now();
  await queue.start();
  
  // Wait for all jobs to complete
  await new Promise(resolve => setTimeout(resolve, 400));
  
  const totalTime = Date.now() - startTime;
  
  await queue.stop();
  
  // With 3 concurrent jobs, 5 jobs should complete faster than sequential processing
  expect(totalTime).toBeLessThan(500); // Should be around 200ms with concurrency
  expect(processedJobIds.size).toBe(5); // Each job should be processed exactly once
});

test('JobQueue emits events during job lifecycle', async () => {
  const queue = new JobQueue();
  const events: string[] = [];
  
  queue.on('jobAdded', (_job) => events.push('added'));
  queue.on('jobStarted', (_job) => events.push('started'));
  queue.on('jobCompleted', (_job) => events.push('completed'));
  queue.on('started', () => events.push('queue_started'));
  queue.on('stopped', () => events.push('queue_stopped'));
  
  queue.registerProcessor(JobType.EMBEDDING_GENERATION, async () => {
    return { success: true };
  });
  
  queue.addJob(JobType.EMBEDDING_GENERATION, { file: 'test.md' });
  
  await queue.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  await queue.stop();
  
  expect(events).toContain('added');
  expect(events).toContain('queue_started');
  expect(events).toContain('started');
  expect(events).toContain('completed');
  expect(events).toContain('queue_stopped');
});