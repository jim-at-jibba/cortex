/**
 * Offline Mode Detection and Queue Management
 * Handles network connectivity detection, offline queuing, and background processing
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import type { CortexConfig } from './config.js';

// Import types from daemon package - we'll need to define them locally to avoid circular dependencies
export enum JobPriority {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  CRITICAL = 3
}

export enum JobType {
  EMBEDDING_GENERATION = 'embedding_generation',
  INDEX_UPDATE = 'index_update',
  FILE_PROCESSING = 'file_processing',
  BATCH_OPERATION = 'batch_operation'
}

// Simple JobQueue interface to avoid circular import
export interface IJobQueue {
  addJob(type: JobType, payload: any, priority: JobPriority, filePath?: string): string;
}

export enum NetworkStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  UNKNOWN = 'unknown'
}

export enum OfflineMode {
  AUTO = 'auto',        // Automatically detect and switch
  FORCE_OFFLINE = 'force_offline',  // Force offline mode
  FORCE_ONLINE = 'force_online'    // Force online mode
}

export interface QueuedEmbeddingRequest {
  id: string;
  text: string;
  filePath?: string;
  noteId?: string;
  priority: JobPriority;
  createdAt: Date;
  retryCount: number;
  maxRetries: number;
  error?: string;
}

export interface NetworkCheckConfig {
  checkInterval: number;
  timeout: number;
  retryAttempts: number;
  endpoints: string[];
  offlineThreshold: number; // Number of failed checks before going offline
}

export interface OfflineManagerConfig {
  networkCheck: NetworkCheckConfig;
  queuePersistencePath: string;
  maxQueueSize: number;
  processingBatchSize: number;
  offlineMode: OfflineMode;
  autoProcessOnReconnect: boolean;
  notificationCallback?: (message: string, type: 'info' | 'warn' | 'error' | 'debug') => void;
}

export interface OfflineStatus {
  mode: OfflineMode;
  networkStatus: NetworkStatus;
  queueSize: number;
  isProcessing: boolean;
  lastNetworkCheck: Date | null;
  consecutiveFailures: number;
  totalProcessed: number;
  totalFailed: number;
}

export class OfflineManager extends EventEmitter {
  private config: OfflineManagerConfig;
  private cortexConfig: CortexConfig | null = null;
  private networkStatus: NetworkStatus = NetworkStatus.UNKNOWN;
  private offlineMode: OfflineMode;
  private isProcessing = false;
  private queue: QueuedEmbeddingRequest[] = [];
  private consecutiveFailures = 0;
  private totalProcessed = 0;
  private totalFailed = 0;
  private lastNetworkCheck: Date | null = null;
  private networkCheckInterval: NodeJS.Timeout | null = null;
  private processingInterval: NodeJS.Timeout | null = null;
  private jobQueue: IJobQueue | null = null;

  constructor(config: Partial<OfflineManagerConfig> = {}) {
    super();

    // Get the cortex directory path
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const cortexDir = path.join(homeDir, '.cortex');

    this.config = {
      networkCheck: {
        checkInterval: 30000, // 30 seconds
        timeout: 5000,       // 5 seconds
        retryAttempts: 3,
        endpoints: [
          'https://api.openai.com/v1/models',
          'https://api.anthropic.com/v1/messages',
          'http://localhost:11434/api/tags' // Ollama
        ],
        offlineThreshold: 3
      },
      queuePersistencePath: path.join(cortexDir, '.cortex-offline-queue.json'),
      maxQueueSize: 1000,
      processingBatchSize: 10,
      offlineMode: OfflineMode.AUTO,
      autoProcessOnReconnect: true,
      ...config
    };

    this.offlineMode = this.config.offlineMode;
  }

  async initialize(cortexConfig: CortexConfig, jobQueue: IJobQueue): Promise<void> {
    this.cortexConfig = cortexConfig;
    this.jobQueue = jobQueue;

    // Load persisted queue
    await this.loadPersistedQueue();

    // Start network monitoring if in auto mode
    if (this.offlineMode === OfflineMode.AUTO) {
      this.startNetworkMonitoring();
    }

    this.log('info', 'Offline manager initialized');
    this.emit('initialized');
  }

  async shutdown(): Promise<void> {
    this.stopNetworkMonitoring();
    this.stopProcessing();
    
    // Persist queue before shutdown
    await this.persistQueue();
    
    this.log('info', 'Offline manager shutdown complete');
    this.emit('shutdown');
  }

  /**
   * Queue an embedding request for processing
   */
  async queueEmbeddingRequest(
    text: string,
    options: {
      filePath?: string;
      noteId?: string;
      priority?: JobPriority;
      maxRetries?: number;
    } = {}
  ): Promise<string> {
    const request: QueuedEmbeddingRequest = {
      id: this.generateRequestId(),
      text,
      filePath: options.filePath,
      noteId: options.noteId,
      priority: options.priority || JobPriority.MEDIUM,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: options.maxRetries || 3
    };

    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Offline queue is full (max size: ${this.config.maxQueueSize})`);
    }

    this.queue.push(request);
    
    // Sort by priority (higher priority first)
    this.queue.sort((a, b) => b.priority - a.priority);

    // Persist queue
    await this.persistQueue();

    this.log('info', `Queued embedding request: ${request.id} (queue size: ${this.queue.length})`);
    this.emit('requestQueued', request);

    return request.id;
  }

  /**
   * Process queued embedding requests
   */
  async processQueue(batchSize?: number): Promise<number> {
    if (this.isProcessing || this.queue.length === 0) {
      return 0;
    }

    if (this.networkStatus === NetworkStatus.OFFLINE) {
      this.log('warn', 'Cannot process queue - network is offline');
      return 0;
    }

    this.isProcessing = true;
    const processBatchSize = batchSize || this.config.processingBatchSize;
    let processedCount = 0;

    try {
      const batch = this.queue.slice(0, processBatchSize);
      
      for (const request of batch) {
        try {
          await this.processSingleRequest(request);
          processedCount++;
          this.totalProcessed++;
          
          // Remove processed request from queue
          const index = this.queue.findIndex(r => r.id === request.id);
          if (index !== -1) {
            this.queue.splice(index, 1);
          }
          
          this.emit('requestProcessed', request);
          
        } catch (error) {
          request.retryCount++;
          request.error = error instanceof Error ? error.message : String(error);
          
          if (request.retryCount <= request.maxRetries) {
            this.log('warn', `Request ${request.id} failed, will retry (${request.retryCount}/${request.maxRetries})`);
            // Move to end of queue for retry
            const index = this.queue.findIndex(r => r.id === request.id);
            if (index !== -1) {
              this.queue.splice(index, 1);
              this.queue.push(request);
            }
          } else {
            this.log('error', `Request ${request.id} failed permanently: ${request.error}`);
            this.totalFailed++;
            
            // Remove failed request
            const index = this.queue.findIndex(r => r.id === request.id);
            if (index !== -1) {
              this.queue.splice(index, 1);
            }
            
            this.emit('requestFailed', request);
          }
        }
      }

      // Persist remaining queue
      await this.persistQueue();

      this.log('info', `Processed ${processedCount} embedding requests (${this.queue.length} remaining)`);
      
    } catch (error) {
      this.log('error', `Error processing queue: ${error}`);
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  /**
   * Set offline mode
   */
  setOfflineMode(mode: OfflineMode): void {
    const previousMode = this.offlineMode;
    this.offlineMode = mode;

    if (mode === OfflineMode.AUTO) {
      this.startNetworkMonitoring();
      this.log('info', 'Switched to automatic offline mode detection');
    } else {
      this.stopNetworkMonitoring();
      
      if (mode === OfflineMode.FORCE_OFFLINE) {
        this.networkStatus = NetworkStatus.OFFLINE;
        this.log('info', 'Forced offline mode enabled');
      } else {
        this.networkStatus = NetworkStatus.ONLINE;
        this.log('info', 'Forced online mode enabled');
        
        // Auto-process queue if reconnecting
        if (previousMode === OfflineMode.FORCE_OFFLINE && this.config.autoProcessOnReconnect) {
          this.processQueue().catch(error => {
            this.log('error', `Auto-process on reconnect failed: ${error}`);
          });
        }
      }
    }

    this.emit('modeChanged', { previousMode, currentMode: mode });
  }

  /**
   * Get current offline status
   */
  getStatus(): OfflineStatus {
    return {
      mode: this.offlineMode,
      networkStatus: this.networkStatus,
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      lastNetworkCheck: this.lastNetworkCheck,
      consecutiveFailures: this.consecutiveFailures,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed
    };
  }

  /**
   * Clear the queue
   */
  clearQueue(): number {
    const clearedCount = this.queue.length;
    this.queue = [];
    this.persistQueue().catch(error => {
      this.log('error', `Failed to persist queue after clear: ${error}`);
    });
    
    this.log('info', `Cleared ${clearedCount} queued requests`);
    this.emit('queueCleared', clearedCount);
    
    return clearedCount;
  }

  /**
   * Remove a specific request from the queue
   */
  removeRequest(requestId: string): boolean {
    const index = this.queue.findIndex(r => r.id === requestId);
    if (index !== -1) {
      const request = this.queue[index];
      this.queue.splice(index, 1);
      this.persistQueue().catch(error => {
        this.log('error', `Failed to persist queue after removing request: ${error}`);
      });
      
      this.log('info', `Removed request ${requestId} from queue`);
      this.emit('requestRemoved', request);
      
      return true;
    }
    return false;
  }

  /**
   * Get queued requests
   */
  getQueuedRequests(): QueuedEmbeddingRequest[] {
    return [...this.queue];
  }

  /**
   * Force a network status check
   */
  async checkNetworkStatus(): Promise<NetworkStatus> {
    const previousStatus = this.networkStatus;
    
    try {
      this.lastNetworkCheck = new Date();
      
      // Try different endpoints based on configured AI provider
      const endpoints = this.getRelevantEndpoints();
      let isOnline = false;

      for (const endpoint of endpoints) {
        if (await this.testEndpoint(endpoint)) {
          isOnline = true;
          break;
        }
      }

      if (isOnline) {
        this.networkStatus = NetworkStatus.ONLINE;
        this.consecutiveFailures = 0;
        
        // If we just came back online, auto-process queue
        if (previousStatus === NetworkStatus.OFFLINE && this.config.autoProcessOnReconnect) {
          this.processQueue().catch(error => {
            this.log('error', `Auto-process on reconnect failed: ${error}`);
          });
        }
      } else {
        this.consecutiveFailures++;
        
        if (this.consecutiveFailures >= this.config.networkCheck.offlineThreshold) {
          this.networkStatus = NetworkStatus.OFFLINE;
        } else {
          this.networkStatus = NetworkStatus.UNKNOWN;
        }
      }

      this.log('debug', `Network status: ${this.networkStatus} (failures: ${this.consecutiveFailures})`);
      this.emit('networkStatusChanged', { previousStatus, currentStatus: this.networkStatus });

    } catch (error) {
      this.log('warn', `Network check failed: ${error}`);
      this.consecutiveFailures++;
      
      if (this.consecutiveFailures >= this.config.networkCheck.offlineThreshold) {
        this.networkStatus = NetworkStatus.OFFLINE;
      } else {
        this.networkStatus = NetworkStatus.UNKNOWN;
      }
    }

    return this.networkStatus;
  }

  private async processSingleRequest(request: QueuedEmbeddingRequest): Promise<void> {
    if (!this.jobQueue) {
      throw new Error('Job queue not available');
    }

    // Add to job queue for actual embedding generation
    this.jobQueue.addJob(
      JobType.EMBEDDING_GENERATION,
      {
        text: request.text,
        filePath: request.filePath,
        noteId: request.noteId,
        requestId: request.id
      },
      request.priority,
      request.filePath
    );

    this.log('debug', `Processing embedding request: ${request.id}`);
  }

  private startNetworkMonitoring(): void {
    if (this.networkCheckInterval) {
      return;
    }

    // Check immediately
    this.checkNetworkStatus().catch(error => {
      this.log('error', `Initial network check failed: ${error}`);
    });

    // Set up periodic checks
    this.networkCheckInterval = setInterval(() => {
      this.checkNetworkStatus().catch(error => {
        this.log('error', `Network check failed: ${error}`);
      });
    }, this.config.networkCheck.checkInterval);

    this.log('info', 'Network monitoring started');
  }

  private stopNetworkMonitoring(): void {
    if (this.networkCheckInterval) {
      clearInterval(this.networkCheckInterval);
      this.networkCheckInterval = null;
      this.log('info', 'Network monitoring stopped');
    }
  }

  

  private stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      this.log('info', 'Background processing stopped');
    }
  }

  private async testEndpoint(endpoint: string): Promise<boolean> {
    try {
      // Use a simple timeout with Promise.race instead of AbortController
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Network check timeout')), this.config.networkCheck.timeout);
      });

      const fetchPromise = fetch(endpoint, {
        method: 'GET',
        headers: {
          'User-Agent': 'Cortex-Offline-Manager/1.0'
        }
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);
      return response.ok;
    } catch (error) {
      // Expected for offline scenarios
      return false;
    }
  }

  private getRelevantEndpoints(): string[] {
    if (!this.cortexConfig) {
      return this.config.networkCheck.endpoints;
    }

    const endpoints: string[] = [];

    switch (this.cortexConfig.aiProvider) {
      case 'openai':
        endpoints.push('https://api.openai.com/v1/models');
        break;
      case 'anthropic':
        endpoints.push('https://api.anthropic.com/v1/messages');
        break;
      case 'ollama':
        endpoints.push('http://localhost:11434/api/tags');
        break;
    }

    // Add fallback endpoints
    endpoints.push('https://www.google.com', 'https://www.cloudflare.com');

    return endpoints;
  }

  private async loadPersistedQueue(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.queuePersistencePath, 'utf-8');
      const requests = JSON.parse(data);
      
      this.queue = requests.map((req: any) => ({
        ...req,
        createdAt: new Date(req.createdAt)
      }));

      this.log('info', `Loaded ${this.queue.length} queued requests from storage`);
      
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        this.log('warn', `Failed to load persisted queue: ${error}`);
      }
    }
  }

  private async persistQueue(): Promise<void> {
    try {
      const dir = path.dirname(this.config.queuePersistencePath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(
        this.config.queuePersistencePath,
        JSON.stringify(this.queue, null, 2)
      );
      
    } catch (error) {
      this.log('error', `Failed to persist queue: ${error}`);
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (this.config.notificationCallback) {
      this.config.notificationCallback(message, level);
    }
    
    console.log(`[OfflineManager] [${level.toUpperCase()}] ${message}`);
    this.emit('log', { level, message, timestamp: new Date() });
  }
}