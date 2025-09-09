/**
 * Cortex Daemon - Background service
 * Handles file watching and background processing for embeddings
 */

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import { FileWatcher } from './file-watcher.js';
import { JobQueue, JobType, JobPriority } from './job-queue.js';
import { HealthMonitor } from './health-monitor.js';
import { ConfigManager, type CortexConfig } from 'cortex-core';
import type { FileChangeEvent } from './file-watcher.js';
import type { HealthStatus } from './health-monitor.js';

export interface DaemonConfig {
  pidFile: string;
  logFile: string;
  watchPaths: string[];
  ignorePaths: string[];
  fileExtensions: string[];
  debounceTime: number;
  maxRetries: number;
  retryDelay: number;
  healthCheckInterval: number;
  maxConcurrentJobs: number;
  jobQueuePersistencePath?: string;
  healthMetricsPath?: string;
  maxMemoryMB?: number;
  maxCpuPercent?: number;
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptime: number;
  lastHealthCheck: Date | null;
  queueSize: number;
  processedJobs: number;
  failedJobs: number;
  jobQueue?: {
    pending: number;
    processing: number;
    failed: number;
    totalInQueue: number;
  };
  health?: {
    healthy: boolean;
    score: number;
    issues: string[];
    consecutiveFailures: number;
    lastError?: string;
  };
}

export class CortexDaemon extends EventEmitter {
  private config: DaemonConfig;
  private cortexConfig: CortexConfig | null = null;
  private isRunning = false;
  private startTime: Date | null = null;
  private lastHealthCheck: Date | null = null;
  private processedJobs = 0;
  private failedJobs = 0;
  private shutdownPromise: Promise<void> | null = null;
  private healthCheckInterval: Timer | null = null;
  private fileWatcher: FileWatcher | null = null;
  private jobQueue: JobQueue | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private lastError: string | null = null;

  constructor(config: Partial<DaemonConfig> = {}) {
    super();
    
    // Get the cortex directory path (same as config.ts)
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const cortexDir = path.join(homeDir, '.cortex');
    
    this.config = {
      pidFile: path.join(cortexDir, '.cortex-daemon.pid'),
      logFile: path.join(cortexDir, '.cortex-daemon.log'),
      watchPaths: [process.cwd()], // Will be updated with actual notes path in start()
      ignorePaths: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.DS_Store',
        '**/thumbs.db'
      ],
      fileExtensions: ['.md', '.markdown'],
      debounceTime: 300,
      maxRetries: 3,
      retryDelay: 5000,
      healthCheckInterval: 30000,
      maxConcurrentJobs: 3,
      jobQueuePersistencePath: path.join(cortexDir, '.cortex-jobs.json'),
      healthMetricsPath: path.join(cortexDir, '.cortex-health.json'),
      maxMemoryMB: 500,
      maxCpuPercent: 80,
      ...config
    };

    this.setupSignalHandlers();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.log('warn', 'Daemon already running');
      return;
    }

    try {
      await this.checkExistingProcess();
      await this.writePidFile();
      
      // Load Cortex configuration to get the correct notes path
      this.log('info', 'Loading Cortex configuration...');
      this.cortexConfig = await ConfigManager.load();
      
      // Update watch paths to use ONLY the actual notes directory
      this.config.watchPaths = [this.cortexConfig.notesPath];
      this.log('info', `Watching notes directory exclusively: ${this.cortexConfig.notesPath}`);
      
      this.isRunning = true;
      this.startTime = new Date();
      this.lastHealthCheck = new Date();
      
      this.log('info', `Cortex daemon starting (PID: ${process.pid})`);
      this.log('info', `Watch paths: ${JSON.stringify(this.config.watchPaths)}`);
      
      await this.startFileWatcher();
      await this.startJobQueue();
      await this.startHealthMonitor();
      this.startHealthCheck();
      
      this.emit('start');
      this.log('info', 'Cortex daemon started successfully');
    } catch (error) {
      this.log('error', `Failed to start daemon: ${error}`);
      throw error;
    }
  }

  async stop(force = false): Promise<void> {
    if (!this.isRunning && !force) {
      this.log('warn', 'Daemon not running');
      return;
    }

    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.performShutdown(force);
    return this.shutdownPromise;
  }

  private async performShutdown(force: boolean): Promise<void> {
    this.log('info', `Cortex daemon stopping ${force ? '(forced)' : '(graceful)'}`);
    
    this.isRunning = false;
    
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      await this.stopFileWatcher();
      await this.stopJobQueue();
      this.stopHealthMonitor();

      try {
        if (!force) {
          this.log('info', 'Waiting for graceful shutdown...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await this.removePidFile();
        this.emit('stop');
        this.log('info', 'Cortex daemon stopped');
      } catch (error) {
        this.log('error', `Error during shutdown: ${error}`);
        throw error;
      }
  }

  async restart(): Promise<void> {
    this.log('info', 'Restarting daemon...');
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.start();
  }

  getStatus(): DaemonStatus {
    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    const queueStatus = this.getQueueStatus();
    const healthStatus = this.getHealthStatus();
    
    return {
      running: this.isRunning,
      pid: this.isRunning ? process.pid : null,
      uptime,
      lastHealthCheck: this.lastHealthCheck,
      queueSize: queueStatus.totalInQueue,
      processedJobs: this.processedJobs,
      failedJobs: this.failedJobs,
      jobQueue: queueStatus,
      health: healthStatus ? {
        healthy: healthStatus.healthy,
        score: healthStatus.score,
        issues: healthStatus.issues,
        consecutiveFailures: healthStatus.consecutiveFailures,
        lastError: this.lastError || undefined
      } : undefined
    };
  }

  private async checkExistingProcess(): Promise<void> {
    try {
      const pidData = await fs.readFile(this.config.pidFile, 'utf-8');
      const existingPid = parseInt(pidData.trim(), 10);
      
      if (!isNaN(existingPid)) {
        try {
          process.kill(existingPid, 0);
          throw new Error(`Daemon already running with PID ${existingPid}`);
        } catch (error: any) {
          if (error.code !== 'ESRCH') {
            throw error;
          }
          this.log('info', `Removing stale PID file for PID ${existingPid}`);
          await this.removePidFile();
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async writePidFile(): Promise<void> {
    await fs.writeFile(this.config.pidFile, process.pid.toString());
  }

  private async removePidFile(): Promise<void> {
    try {
      await fs.unlink(this.config.pidFile);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        this.log('warn', `Failed to remove PID file: ${error}`);
      }
    }
  }

  private setupSignalHandlers(): void {
    const handleShutdown = async (signal: string) => {
      this.log('info', `Received ${signal}, shutting down...`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        this.log('error', `Error during ${signal} shutdown: ${error}`);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      this.log('error', `Uncaught exception: ${error}`);
      this.log('error', error.stack || 'No stack trace available');
      this.stop(true).finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.log('error', `Unhandled rejection at: ${promise} reason: ${reason}`);
      this.stop(true).finally(() => process.exit(1));
    });
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private performHealthCheck(): void {
    this.lastHealthCheck = new Date();
    this.emit('healthCheck', this.getStatus());
    this.log('debug', `Health check: ${JSON.stringify(this.getStatus())}`);
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    console.log(logEntry);
    
    fs.appendFile(this.config.logFile, logEntry + '\n').catch(err => {
      console.error('Failed to write to log file:', err);
    });
    
    this.emit('log', { level, message, timestamp });
  }

  incrementProcessedJobs(): void {
    this.processedJobs++;
  }

  incrementFailedJobs(): void {
    this.failedJobs++;
  }

  private async startFileWatcher(): Promise<void> {
    try {
      this.fileWatcher = new FileWatcher({
        watchPaths: this.config.watchPaths,
        ignorePaths: this.config.ignorePaths,
        fileExtensions: this.config.fileExtensions,
        debounceTime: this.config.debounceTime,
        persistent: true
      });

      this.fileWatcher.on('fileChange', (event: FileChangeEvent) => {
        this.handleFileChange(event);
      });

      this.fileWatcher.on('error', (error: any) => {
        this.log('error', `File watcher error: ${error}`);
      });

      this.fileWatcher.on('ready', () => {
        this.log('info', 'File watcher initialized and ready');
      });

      await this.fileWatcher.start();
    } catch (error) {
      this.log('error', `Failed to start file watcher: ${error}`);
      throw error;
    }
  }

  private async stopFileWatcher(): Promise<void> {
    if (this.fileWatcher) {
      try {
        await this.fileWatcher.stop();
        this.fileWatcher = null;
        this.log('info', 'File watcher stopped');
      } catch (error) {
        this.log('error', `Error stopping file watcher: ${error}`);
      }
    }
  }

  private async startJobQueue(): Promise<void> {
    try {
      this.jobQueue = new JobQueue({
        maxConcurrentJobs: this.config.maxConcurrentJobs,
        maxRetries: this.config.maxRetries,
        retryDelay: this.config.retryDelay,
        persistencePath: this.config.jobQueuePersistencePath
      });

      // Register basic processors
      this.jobQueue.registerProcessor(JobType.EMBEDDING_GENERATION, async (job) => {
        this.log('info', `Processing embedding for: ${job.payload.filePath || job.payload.file}`);
        // TODO: Implement actual embedding generation
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing
        return { success: true, message: 'Embedding generated' };
      });

      this.jobQueue.registerProcessor(JobType.FILE_PROCESSING, async (job) => {
        const filePath = job.payload.filePath || job.payload.file;
        this.log('info', `Processing file: ${filePath}`);
        
        try {
          // Import required modules
          const { DatabaseManager } = await import('cortex-core');
          const matter = await import('gray-matter');
          const { basename, extname } = await import('path');
          
          // Initialize database with cortex config
          if (!this.cortexConfig) {
            throw new Error('Cortex configuration not loaded');
          }
          
          const dbManager = new DatabaseManager(this.cortexConfig);
          await dbManager.initialize();
          
          // Read and parse the markdown file
          const content = await Bun.file(filePath).text();
          const parsed = matter.default(content);
          
          // Check if note already exists
          const existingNote = await dbManager.getNoteByPath(filePath);
          
          if (existingNote) {
            // Update existing note
            const updates = {
              title: parsed.data.title || basename(filePath, '.md'),
              content: parsed.content,
              frontmatter_json: JSON.stringify(parsed.data),
              updated_at: new Date().toISOString(),
              tags_json: JSON.stringify(parsed.data.tags || [])
            };
            
            await dbManager.updateNote(existingNote.id, updates);
            this.log('info', `File updated in database: ${updates.title}`);
          } else {
            // Create new note record
            const noteRecord = {
              id: basename(filePath, extname(filePath)),
              title: parsed.data.title || basename(filePath, '.md'),
              content: parsed.content,
              path: filePath,
              frontmatter_json: JSON.stringify(parsed.data),
              created_at: new Date(parsed.data.created || Date.now()).toISOString(),
              updated_at: new Date().toISOString(),
              tags_json: JSON.stringify(parsed.data.tags || [])
            };
            
            await dbManager.createNote(noteRecord);
            this.log('info', `File created in database: ${noteRecord.title}`);
          }
          
          return { success: true, message: 'File processed successfully' };
          
        } catch (error) {
          this.log('error', `Failed to process file ${filePath}: ${error}`);
          return { success: false, message: `Processing failed: ${error}` };
        }
      });

      this.jobQueue.on('jobCompleted', (job) => {
        this.log('info', `Job completed: ${job.id} (${job.type})`);
        this.incrementProcessedJobs();
      });

      this.jobQueue.on('jobFailed', (job) => {
        this.log('error', `Job failed: ${job.id} (${job.type}) - ${job.error}`);
        this.incrementFailedJobs();
      });

      await this.jobQueue.start();
      this.log('info', 'Job queue started');

    } catch (error) {
      this.log('error', `Failed to start job queue: ${error}`);
      throw error;
    }
  }

  private async stopJobQueue(): Promise<void> {
    if (this.jobQueue) {
      try {
        await this.jobQueue.stop();
        this.jobQueue = null;
        this.log('info', 'Job queue stopped');
      } catch (error) {
        this.log('error', `Error stopping job queue: ${error}`);
      }
    }
  }

  private handleFileChange(event: FileChangeEvent): void {
    this.log('info', `File ${event.type}: ${event.filePath}`);
    
    // Emit event for external listeners
    this.emit('fileChange', event);
    
    // Queue file processing jobs based on file event type
    if (this.jobQueue) {
      if (event.type === 'add' || event.type === 'change') {
        // Add embedding generation job for new/modified files
        this.jobQueue.addJob(
          JobType.EMBEDDING_GENERATION,
          { filePath: event.filePath },
          JobPriority.MEDIUM,
          event.filePath
        );
      }
      
      // Add general file processing job
      this.jobQueue.addJob(
        JobType.FILE_PROCESSING,
        { filePath: event.filePath, eventType: event.type },
        JobPriority.LOW,
        event.filePath
      );
    }
    
    this.incrementProcessedJobs();
  }

  private async startHealthMonitor(): Promise<void> {
    try {
      this.healthMonitor = new HealthMonitor({
        healthCheckInterval: this.config.healthCheckInterval,
        maxMemoryMB: this.config.maxMemoryMB || 500,
        maxCpuPercent: this.config.maxCpuPercent || 80,
        maxQueueSize: 1000,
        maxFailureRate: 0.1,
        unhealthyThreshold: 3
      }, this.config.healthMetricsPath);

      this.healthMonitor.on('unhealthy', (status: HealthStatus) => {
        this.log('warn', `Health check failed: ${status.issues.join(', ')}`);
        this.lastError = status.issues[0] || null;
        this.emit('unhealthy', status);
      });

      this.healthMonitor.on('criticalHealth', (status: HealthStatus) => {
        this.log('error', `Critical health status: ${status.issues.join(', ')}`);
        this.lastError = status.issues[0] || null;
        this.emit('criticalHealth', status);
      });

      this.healthMonitor.on('healthCheck', (_status: HealthStatus) => {
        this.lastHealthCheck = new Date();
        // Update health metrics with daemon-specific data
        this.healthMonitor?.updateMetrics({
          queueSize: this.getQueueStatus().totalInQueue,
          processedJobs: this.processedJobs,
          failedJobs: this.failedJobs,
          lastError: this.lastError || undefined
        });
      });

      await this.healthMonitor.loadMetrics();
      this.healthMonitor.start();
      this.log('info', 'Health monitor started');

    } catch (error) {
      this.log('error', `Failed to start health monitor: ${error}`);
      throw error;
    }
  }

  private stopHealthMonitor(): void {
    if (this.healthMonitor) {
      this.healthMonitor.stop();
      this.healthMonitor = null;
      this.log('info', 'Health monitor stopped');
    }
  }

  getHealthStatus(): HealthStatus | null {
    return this.healthMonitor?.getCurrentStatus() || null;
  }

  generateHealthReport(): string {
    return this.healthMonitor?.generateHealthReport() || 'Health monitor not available';
  }

  getQueueStatus() {
    return this.jobQueue?.getQueueStatus() || {
      pending: 0,
      processing: 0,
      failed: 0,
      totalInQueue: 0
    };
  }
}

// Re-export DaemonManager for convenience
export { DaemonManager } from './daemon-manager.js';