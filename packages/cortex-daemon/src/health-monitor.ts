/**
 * Health Monitoring System
 * Monitors daemon health, resources, and handles crash recovery
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export interface HealthMetrics {
  timestamp: Date;
  uptime: number;
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  processId: number;
  queueSize: number;
  processedJobs: number;
  failedJobs: number;
  lastError?: string;
}

export interface HealthThresholds {
  maxMemoryMB: number;
  maxCpuPercent: number;
  maxQueueSize: number;
  maxFailureRate: number;
  healthCheckInterval: number;
  unhealthyThreshold: number;
}

export interface HealthStatus {
  healthy: boolean;
  score: number; // 0-100, 100 being perfectly healthy
  issues: string[];
  metrics: HealthMetrics;
  lastHealthCheck: Date;
  consecutiveFailures: number;
}

export class HealthMonitor extends EventEmitter {
  private thresholds: HealthThresholds;
  private isMonitoring = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private metrics: HealthMetrics[] = [];
  private maxMetricsHistory = 100;
  private consecutiveFailures = 0;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private startTime: Date;
  private metricsFilePath?: string;

  constructor(
    thresholds: Partial<HealthThresholds> = {},
    metricsFilePath?: string
  ) {
    super();

    this.thresholds = {
      maxMemoryMB: 500,
      maxCpuPercent: 80,
      maxQueueSize: 1000,
      maxFailureRate: 0.1, // 10% failure rate
      healthCheckInterval: 30000, // 30 seconds
      unhealthyThreshold: 3, // 3 consecutive failures
      ...thresholds
    };

    this.startTime = new Date();
    this.metricsFilePath = metricsFilePath;
    this.lastCpuUsage = process.cpuUsage();
  }

  start(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.performHealthCheck();
    
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.thresholds.healthCheckInterval);

    this.emit('started');
  }

  stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.emit('stopped');
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const metrics = await this.collectMetrics();
      const status = this.evaluateHealth(metrics);
      
      this.metrics.push(metrics);
      if (this.metrics.length > this.maxMetricsHistory) {
        this.metrics.shift();
      }

      if (status.healthy) {
        this.consecutiveFailures = 0;
        this.emit('healthCheck', status);
      } else {
        this.consecutiveFailures++;
        this.emit('unhealthy', status);

        if (this.consecutiveFailures >= this.thresholds.unhealthyThreshold) {
          this.emit('criticalHealth', status);
        }
      }

      // Save metrics to file if configured
      if (this.metricsFilePath) {
        await this.saveMetrics();
      }

    } catch (error) {
      this.consecutiveFailures++;
      this.emit('healthCheckError', error);

      if (this.consecutiveFailures >= this.thresholds.unhealthyThreshold) {
        this.emit('criticalHealth', {
          healthy: false,
          score: 0,
          issues: [`Health check failed: ${error}`],
          metrics: await this.collectMetrics().catch(() => ({
            timestamp: new Date(),
            uptime: 0,
            memoryUsage: process.memoryUsage(),
            cpuUsage: { user: 0, system: 0 },
            processId: process.pid,
            queueSize: 0,
            processedJobs: 0,
            failedJobs: 0
          })),
          lastHealthCheck: new Date(),
          consecutiveFailures: this.consecutiveFailures
        });
      }
    }
  }

  private async collectMetrics(): Promise<HealthMetrics> {
    const memoryUsage = process.memoryUsage();
    const currentCpuUsage = process.cpuUsage();
    
    let cpuPercent = { user: 0, system: 0 };
    if (this.lastCpuUsage) {
      const cpuDiff = process.cpuUsage(this.lastCpuUsage);
      // Convert microseconds to percentage (approximate)
      cpuPercent = {
        user: (cpuDiff.user / 1000000) * 100 / (this.thresholds.healthCheckInterval / 1000),
        system: (cpuDiff.system / 1000000) * 100 / (this.thresholds.healthCheckInterval / 1000)
      };
    }
    this.lastCpuUsage = currentCpuUsage;

    return {
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
      memoryUsage: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024), // Convert to MB
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      },
      cpuUsage: {
        user: Math.min(cpuPercent.user, 100), // Cap at 100%
        system: Math.min(cpuPercent.system, 100)
      },
      processId: process.pid,
      queueSize: 0, // Will be set by daemon
      processedJobs: 0, // Will be set by daemon
      failedJobs: 0 // Will be set by daemon
    };
  }

  private evaluateHealth(metrics: HealthMetrics): HealthStatus {
    const issues: string[] = [];
    let score = 100;

    // Memory check
    if (metrics.memoryUsage.rss > this.thresholds.maxMemoryMB) {
      issues.push(`High memory usage: ${metrics.memoryUsage.rss}MB > ${this.thresholds.maxMemoryMB}MB`);
      score -= 20;
    }

    // CPU check
    const totalCpu = metrics.cpuUsage.user + metrics.cpuUsage.system;
    if (totalCpu > this.thresholds.maxCpuPercent) {
      issues.push(`High CPU usage: ${totalCpu.toFixed(2)}% > ${this.thresholds.maxCpuPercent}%`);
      score -= 15;
    }

    // Queue size check
    if (metrics.queueSize > this.thresholds.maxQueueSize) {
      issues.push(`Large queue size: ${metrics.queueSize} > ${this.thresholds.maxQueueSize}`);
      score -= 10;
    }

    // Failure rate check
    const totalJobs = metrics.processedJobs + metrics.failedJobs;
    if (totalJobs > 0) {
      const failureRate = metrics.failedJobs / totalJobs;
      if (failureRate > this.thresholds.maxFailureRate) {
        issues.push(`High failure rate: ${(failureRate * 100).toFixed(2)}% > ${(this.thresholds.maxFailureRate * 100).toFixed(2)}%`);
        score -= 25;
      }
    }

    // Error presence check
    if (metrics.lastError) {
      issues.push(`Recent error: ${metrics.lastError}`);
      score -= 10;
    }

    // Consecutive failures penalty
    if (this.consecutiveFailures > 0) {
      score -= this.consecutiveFailures * 5;
    }

    score = Math.max(0, score); // Don't go below 0

    return {
      healthy: issues.length === 0 && score >= 70,
      score,
      issues,
      metrics,
      lastHealthCheck: new Date(),
      consecutiveFailures: this.consecutiveFailures
    };
  }

  updateMetrics(updates: Partial<HealthMetrics>): void {
    if (this.metrics.length > 0) {
      const latest = this.metrics[this.metrics.length - 1];
      if (latest) {
        Object.assign(latest, updates);
      }
    }
  }

  getLatestMetrics(): HealthMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] || null : null;
  }

  getMetricsHistory(limit = 50): HealthMetrics[] {
    return this.metrics.slice(-limit);
  }

  getCurrentStatus(): HealthStatus {
    const latest = this.getLatestMetrics();
    if (!latest) {
      return {
        healthy: false,
        score: 0,
        issues: ['No metrics available'],
        metrics: {
          timestamp: new Date(),
          uptime: 0,
          memoryUsage: process.memoryUsage(),
          cpuUsage: { user: 0, system: 0 },
          processId: process.pid,
          queueSize: 0,
          processedJobs: 0,
          failedJobs: 0
        },
        lastHealthCheck: new Date(),
        consecutiveFailures: this.consecutiveFailures
      };
    }

    return this.evaluateHealth(latest);
  }

  private async saveMetrics(): Promise<void> {
    if (!this.metricsFilePath) return;

    try {
      const dir = path.dirname(this.metricsFilePath);
      await fs.mkdir(dir, { recursive: true });

      // Save only recent metrics to avoid huge files
      const recentMetrics = this.metrics.slice(-50);
      await fs.writeFile(
        this.metricsFilePath,
        JSON.stringify(recentMetrics, null, 2)
      );
    } catch (error) {
      this.emit('error', `Failed to save metrics: ${error}`);
    }
  }

  async loadMetrics(): Promise<void> {
    if (!this.metricsFilePath) return;

    try {
      const data = await fs.readFile(this.metricsFilePath, 'utf-8');
      const savedMetrics = JSON.parse(data);
      
      this.metrics = savedMetrics.map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp)
      }));

      this.emit('metricsLoaded', this.metrics.length);
    } catch (error) {
      // Ignore file not found errors
      if ((error as any).code !== 'ENOENT') {
        this.emit('error', `Failed to load metrics: ${error}`);
      }
    }
  }

  generateHealthReport(): string {
    const status = this.getCurrentStatus();
    const metrics = status.metrics;
    
    return `
=== Cortex Daemon Health Report ===
Generated: ${new Date().toISOString()}

Overall Health: ${status.healthy ? '✅ HEALTHY' : '❌ UNHEALTHY'} (Score: ${status.score}/100)
Consecutive Failures: ${status.consecutiveFailures}

System Metrics:
- Process ID: ${metrics.processId}
- Uptime: ${Math.round(metrics.uptime / 1000 / 60)} minutes
- Memory Usage: ${metrics.memoryUsage.rss}MB RSS, ${metrics.memoryUsage.heapUsed}MB Heap
- CPU Usage: ${(metrics.cpuUsage.user + metrics.cpuUsage.system).toFixed(2)}%

Job Queue:
- Queue Size: ${metrics.queueSize}
- Processed Jobs: ${metrics.processedJobs}
- Failed Jobs: ${metrics.failedJobs}
- Failure Rate: ${metrics.processedJobs + metrics.failedJobs > 0 ? 
  ((metrics.failedJobs / (metrics.processedJobs + metrics.failedJobs)) * 100).toFixed(2) : '0'}%

Issues:
${status.issues.length > 0 ? status.issues.map(issue => `- ${issue}`).join('\n') : '- None'}

Thresholds:
- Max Memory: ${this.thresholds.maxMemoryMB}MB
- Max CPU: ${this.thresholds.maxCpuPercent}%
- Max Queue: ${this.thresholds.maxQueueSize}
- Max Failure Rate: ${(this.thresholds.maxFailureRate * 100).toFixed(2)}%

=== End Report ===
    `.trim();
  }
}