/**
 * File Watcher Service
 * Handles file system monitoring with change detection and debouncing
 */

import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import path from 'path';

export interface FileWatcherConfig {
  watchPaths: string[];
  ignorePaths: string[];
  fileExtensions: string[];
  debounceTime: number;
  persistent: boolean;
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  filePath: string;
  stats?: any;
  timestamp: Date;
}

export class FileWatcher extends EventEmitter {
  private config: FileWatcherConfig;
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  constructor(config: Partial<FileWatcherConfig> = {}) {
    super();
    
    this.config = {
      watchPaths: [process.cwd()],
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
      persistent: true,
      ...config
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('File watcher is already running');
    }

    try {
      const watchOptions = {
        ignored: this.config.ignorePaths,
        persistent: this.config.persistent,
        ignoreInitial: false,
        followSymlinks: true,
        cwd: process.cwd(),
        disableGlobbing: false,
        usePolling: false,
        interval: 100,
        binaryInterval: 300,
        alwaysStat: false,
        depth: undefined,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 100
        }
      };

      this.watcher = chokidar.watch(this.config.watchPaths, watchOptions);
      
      this.setupEventHandlers();
      
      await new Promise<void>((resolve, reject) => {
        this.watcher!.on('ready', () => {
          this.isRunning = true;
          this.emit('ready');
          resolve();
        });
        
        this.watcher!.on('error', (error: any) => {
          reject(error);
        });
      });

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.clearAllDebounceTimers();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.isRunning = false;
    this.emit('stopped');
  }

  private setupEventHandlers(): void {
    if (!this.watcher) return;

    this.watcher.on('add', (filePath: string, stats?: any) => {
      this.handleFileEvent('add', filePath, stats);
    });

    this.watcher.on('change', (filePath: string, stats?: any) => {
      this.handleFileEvent('change', filePath, stats);
    });

    this.watcher.on('unlink', (filePath: string) => {
      this.handleFileEvent('unlink', filePath);
    });

    this.watcher.on('addDir', (dirPath: string, stats?: any) => {
      this.handleFileEvent('addDir', dirPath, stats);
    });

    this.watcher.on('unlinkDir', (dirPath: string) => {
      this.handleFileEvent('unlinkDir', dirPath);
    });

    this.watcher.on('error', (error: any) => {
      this.emit('error', error);
    });
  }

  private handleFileEvent(
    type: FileChangeEvent['type'], 
    filePath: string, 
    stats?: any
  ): void {
    // Filter by file extension for files (not directories)
    if (type !== 'addDir' && type !== 'unlinkDir') {
      if (!this.isWatchedFileType(filePath)) {
        return;
      }
    }

    const absolutePath = path.resolve(filePath);
    
    // Clear existing debounce timer for this file
    const existingTimer = this.debounceTimers.get(absolutePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set up debounced event emission
    const timer = setTimeout(() => {
      this.debounceTimers.delete(absolutePath);
      
      const event: FileChangeEvent = {
        type,
        filePath: absolutePath,
        stats,
        timestamp: new Date()
      };

      this.emit('fileChange', event);
      this.emit(type, event);
      
    }, this.config.debounceTime);

    this.debounceTimers.set(absolutePath, timer);
  }

  private isWatchedFileType(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.config.fileExtensions.includes(ext);
  }

  private clearAllDebounceTimers(): void {
    this.debounceTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.debounceTimers.clear();
  }

  getWatchedPaths(): string[] {
    return [...this.config.watchPaths];
  }

  getIgnoredPaths(): string[] {
    return [...this.config.ignorePaths];
  }

  getWatchedExtensions(): string[] {
    return [...this.config.fileExtensions];
  }

  isWatching(): boolean {
    return this.isRunning;
  }

  updateConfig(newConfig: Partial<FileWatcherConfig>): void {
    if (this.isRunning) {
      throw new Error('Cannot update config while watcher is running. Stop the watcher first.');
    }
    
    this.config = { ...this.config, ...newConfig };
  }

  addWatchPath(pathToWatch: string): void {
    this.config.watchPaths.push(pathToWatch);
    
    if (this.watcher && this.isRunning) {
      this.watcher.add(pathToWatch);
    }
    
    this.emit('pathAdded', pathToWatch);
  }

  removeWatchPath(pathToRemove: string): void {
    this.config.watchPaths = this.config.watchPaths.filter(p => p !== pathToRemove);
    
    if (this.watcher && this.isRunning) {
      this.watcher.unwatch(pathToRemove);
    }
    
    this.emit('pathRemoved', pathToRemove);
  }
}