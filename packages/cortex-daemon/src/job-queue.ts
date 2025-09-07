/**
 * Job Queue System with Priority Handling
 * Manages embedding and processing jobs with priority-based scheduling
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export enum JobPriority {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  CRITICAL = 3
}

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing', 
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRY = 'retry'
}

export enum JobType {
  EMBEDDING_GENERATION = 'embedding_generation',
  INDEX_UPDATE = 'index_update',
  FILE_PROCESSING = 'file_processing',
  BATCH_OPERATION = 'batch_operation'
}

export interface Job {
  id: string;
  type: JobType;
  priority: JobPriority;
  status: JobStatus;
  payload: any;
  filePath?: string;
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  maxRetries: number;
  error?: string;
  result?: any;
}

export interface JobQueueConfig {
  maxConcurrentJobs: number;
  maxRetries: number;
  retryDelay: number;
  batchSize: number;
  persistencePath?: string;
  processTimeout: number;
}

export interface JobProcessor {
  (job: Job): Promise<any>;
}

export class JobQueue extends EventEmitter {
  private config: JobQueueConfig;
  private queue: Job[] = [];
  private processing: Map<string, Job> = new Map();
  private processors: Map<JobType, JobProcessor> = new Map();
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<JobQueueConfig> = {}) {
    super();

    this.config = {
      maxConcurrentJobs: 3,
      maxRetries: 3,
      retryDelay: 5000,
      batchSize: 10,
      processTimeout: 60000,
      ...config
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Job queue is already running');
    }

    await this.loadPersistedJobs();
    this.isRunning = true;
    this.startProcessing();
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Wait for current jobs to complete
    while (this.processing.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await this.persistJobs();
    this.emit('stopped');
  }

  addJob(
    type: JobType,
    payload: any,
    priority: JobPriority = JobPriority.MEDIUM,
    filePath?: string
  ): string {
    const job: Job = {
      id: this.generateJobId(),
      type,
      priority,
      status: JobStatus.PENDING,
      payload,
      filePath,
      createdAt: new Date(),
      updatedAt: new Date(),
      attempts: 0,
      maxRetries: this.config.maxRetries
    };

    // Insert job maintaining priority order (higher priority first)
    const insertIndex = this.queue.findIndex(existingJob => 
      existingJob.priority < job.priority
    );
    
    if (insertIndex === -1) {
      this.queue.push(job);
    } else {
      this.queue.splice(insertIndex, 0, job);
    }

    this.emit('jobAdded', job);
    return job.id;
  }

  addBatchJobs(jobs: Array<{
    type: JobType;
    payload: any;
    priority?: JobPriority;
    filePath?: string;
  }>): string[] {
    const jobIds: string[] = [];
    
    for (const jobSpec of jobs) {
      const id = this.addJob(
        jobSpec.type,
        jobSpec.payload,
        jobSpec.priority || JobPriority.MEDIUM,
        jobSpec.filePath
      );
      jobIds.push(id);
    }

    this.emit('batchAdded', jobIds);
    return jobIds;
  }

  registerProcessor(type: JobType, processor: JobProcessor): void {
    this.processors.set(type, processor);
    this.emit('processorRegistered', type);
  }

  getJob(id: string): Job | undefined {
    return this.queue.find(job => job.id === id) || 
           this.processing.get(id);
  }

  getQueueStatus(): {
    pending: number;
    processing: number;
    failed: number;
    totalInQueue: number;
  } {
    const pending = this.queue.filter(job => job.status === JobStatus.PENDING).length;
    const failed = this.queue.filter(job => job.status === JobStatus.FAILED).length;
    
    return {
      pending,
      processing: this.processing.size,
      failed,
      totalInQueue: this.queue.length
    };
  }

  getJobsByType(type: JobType): Job[] {
    const queueJobs = this.queue.filter(job => job.type === type);
    const processingJobs = Array.from(this.processing.values()).filter(job => job.type === type);
    return [...queueJobs, ...processingJobs];
  }

  getJobsByStatus(status: JobStatus): Job[] {
    const queueJobs = this.queue.filter(job => job.status === status);
    const processingJobs = Array.from(this.processing.values()).filter(job => job.status === status);
    return [...queueJobs, ...processingJobs];
  }

  removeJob(id: string): boolean {
    const queueIndex = this.queue.findIndex(job => job.id === id);
    if (queueIndex !== -1) {
      const job = this.queue[queueIndex];
      this.queue.splice(queueIndex, 1);
      this.emit('jobRemoved', job);
      return true;
    }
    return false;
  }

  clearCompletedJobs(): number {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter(job => 
      job.status !== JobStatus.COMPLETED && job.status !== JobStatus.FAILED
    );
    const removed = initialLength - this.queue.length;
    this.emit('completedJobsCleared', removed);
    return removed;
  }

  private startProcessing(): void {
    // Process immediately, then at intervals
    this.processNextJobs();
    this.processingInterval = setInterval(() => {
      this.processNextJobs();
    }, 100);
  }

  private async processNextJobs(): Promise<void> {
    if (!this.isRunning || this.processing.size >= this.config.maxConcurrentJobs) {
      return;
    }

    const availableSlots = this.config.maxConcurrentJobs - this.processing.size;
    const jobsToProcess = this.queue
      .filter(job => job.status === JobStatus.PENDING || job.status === JobStatus.RETRY)
      .slice(0, availableSlots);

    for (const job of jobsToProcess) {
      await this.processJob(job);
    }
  }

  private async processJob(job: Job): Promise<void> {
    const processor = this.processors.get(job.type);
    if (!processor) {
      job.status = JobStatus.FAILED;
      job.error = `No processor registered for job type: ${job.type}`;
      job.updatedAt = new Date();
      this.emit('jobFailed', job);
      return;
    }

    // Move job from queue to processing
    const queueIndex = this.queue.findIndex(j => j.id === job.id);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }
    
    job.status = JobStatus.PROCESSING;
    job.attempts++;
    job.updatedAt = new Date();
    this.processing.set(job.id, job);
    this.emit('jobStarted', job);

    try {
      // Set up timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job processing timeout')), this.config.processTimeout);
      });

      const result = await Promise.race([
        processor(job),
        timeoutPromise
      ]);

      job.status = JobStatus.COMPLETED;
      job.result = result;
      job.updatedAt = new Date();
      this.processing.delete(job.id);
      this.queue.push(job); // Keep completed jobs for history
      this.emit('jobCompleted', job);

    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      job.updatedAt = new Date();

      if (job.attempts <= job.maxRetries) {
        job.status = JobStatus.RETRY;
        this.processing.delete(job.id);
        
        // Add retry delay
        setTimeout(() => {
          this.queue.unshift(job); // Add to front with high priority
        }, this.config.retryDelay);

        this.emit('jobRetry', job);
      } else {
        job.status = JobStatus.FAILED;
        this.processing.delete(job.id);
        this.queue.push(job); // Keep failed jobs for inspection
        this.emit('jobFailed', job);
      }
    }
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private async loadPersistedJobs(): Promise<void> {
    if (!this.config.persistencePath) {
      return;
    }

    try {
      const data = await fs.readFile(this.config.persistencePath, 'utf-8');
      const jobs = JSON.parse(data);
      
      // Restore pending and retry jobs only
      this.queue = jobs
        .filter((job: Job) => 
          job.status === JobStatus.PENDING || job.status === JobStatus.RETRY
        )
        .map((job: Job) => ({
          ...job,
          createdAt: new Date(job.createdAt),
          updatedAt: new Date(job.updatedAt)
        }));

      // Sort by priority
      this.queue.sort((a, b) => b.priority - a.priority);
      
      this.emit('jobsLoaded', this.queue.length);
    } catch (error) {
      // Ignore errors for non-existent files
      if ((error as any).code !== 'ENOENT') {
        this.emit('error', error);
      }
    }
  }

  private async persistJobs(): Promise<void> {
    if (!this.config.persistencePath) {
      return;
    }

    try {
      const dir = path.dirname(this.config.persistencePath);
      await fs.mkdir(dir, { recursive: true });
      
      // Only persist pending, retry, and recent completed/failed jobs
      const jobsToPersist = this.queue.filter(job => 
        job.status === JobStatus.PENDING || 
        job.status === JobStatus.RETRY ||
        (job.updatedAt.getTime() > Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
      );
      
      await fs.writeFile(
        this.config.persistencePath,
        JSON.stringify(jobsToPersist, null, 2)
      );
      
      this.emit('jobsPersisted', jobsToPersist.length);
    } catch (error) {
      this.emit('error', error);
    }
  }
}