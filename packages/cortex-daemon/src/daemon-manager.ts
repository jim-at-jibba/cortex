/**
 * Daemon Manager - Handles daemon lifecycle operations
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { CortexDaemon } from './index.js';
import type { DaemonStatus } from './index.js';

export class DaemonManager {
  private static instance: DaemonManager;
  private daemon: CortexDaemon | null = null;

  private constructor() {}

  static getInstance(): DaemonManager {
    if (!DaemonManager.instance) {
      DaemonManager.instance = new DaemonManager();
    }
    return DaemonManager.instance;
  }

  async startDaemon(detached = false): Promise<DaemonStatus> {
    if (detached) {
      return this.startDetachedDaemon();
    }

    if (this.daemon?.getStatus().running) {
      throw new Error('Daemon is already running');
    }

    this.daemon = new CortexDaemon();
    await this.daemon.start();
    return this.daemon.getStatus();
  }

  async stopDaemon(force = false): Promise<void> {
    if (!this.daemon) {
      return this.stopDetachedDaemon(force);
    }

    await this.daemon.stop(force);
    this.daemon = null;
  }

  async restartDaemon(): Promise<DaemonStatus> {
    await this.stopDaemon();
    await new Promise(resolve => setTimeout(resolve, 1000));
    return this.startDaemon();
  }

  async getDaemonStatus(): Promise<DaemonStatus | null> {
    if (this.daemon) {
      return this.daemon.getStatus();
    }

    return this.getDetachedDaemonStatus();
  }

  private async startDetachedDaemon(): Promise<DaemonStatus> {
    const daemonScript = path.resolve(__dirname, 'daemon-process.js');
    
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });

    child.unref();

    // Wait a moment for the daemon to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const status = await this.getDetachedDaemonStatus();
    if (!status?.running) {
      throw new Error('Failed to start detached daemon');
    }

    return status;
  }

  private async stopDetachedDaemon(force = false): Promise<void> {
    const pidFile = path.join(process.cwd(), '.cortex-daemon.pid');
    
    try {
      const pidData = await fs.readFile(pidFile, 'utf-8');
      const pid = parseInt(pidData.trim(), 10);
      
      if (!isNaN(pid)) {
        try {
          process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
          
          // Wait for process to exit
          let attempts = 0;
          const maxAttempts = 10;
          
          while (attempts < maxAttempts) {
            try {
              process.kill(pid, 0);
              await new Promise(resolve => setTimeout(resolve, 500));
              attempts++;
            } catch (error: any) {
              if (error.code === 'ESRCH') {
                break; // Process has exited
              }
              throw error;
            }
          }

          if (attempts >= maxAttempts) {
            throw new Error(`Daemon process ${pid} did not exit after ${maxAttempts} attempts`);
          }
        } catch (error: any) {
          if (error.code !== 'ESRCH') {
            throw error;
          }
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async getDetachedDaemonStatus(): Promise<DaemonStatus | null> {
    const pidFile = path.join(process.cwd(), '.cortex-daemon.pid');
    
    try {
      const pidData = await fs.readFile(pidFile, 'utf-8');
      const pid = parseInt(pidData.trim(), 10);
      
      if (!isNaN(pid)) {
        try {
          process.kill(pid, 0);
          
          return {
            running: true,
            pid,
            uptime: 0, // Would need to read from daemon state
            lastHealthCheck: null,
            queueSize: 0,
            processedJobs: 0,
            failedJobs: 0
          };
        } catch (error: any) {
          if (error.code === 'ESRCH') {
            // Process doesn't exist, remove stale PID file
            await fs.unlink(pidFile).catch(() => {});
            return null;
          }
          throw error;
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return null;
  }

  async getLogs(lines = 50): Promise<string[]> {
    const logFile = path.join(process.cwd(), '.cortex-daemon.log');
    
    try {
      const content = await fs.readFile(logFile, 'utf-8');
      const logLines = content.trim().split('\n');
      return logLines.slice(-lines);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async clearLogs(): Promise<void> {
    const logFile = path.join(process.cwd(), '.cortex-daemon.log');
    
    try {
      await fs.writeFile(logFile, '');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}