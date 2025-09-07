/**
 * Health Monitor Tests
 */

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { HealthMonitor } from './health-monitor.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const testDir = path.join(os.tmpdir(), 'cortex-health-monitor-test');
const metricsFile = path.join(testDir, 'health-metrics.json');

beforeEach(async () => {
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('HealthMonitor initializes with default thresholds', () => {
  const monitor = new HealthMonitor();
  
  const status = monitor.getCurrentStatus();
  expect(status.healthy).toBe(false); // No metrics available initially
  expect(status.issues).toContain('No metrics available');
});

test('HealthMonitor collects and evaluates basic health metrics', async () => {
  const monitor = new HealthMonitor({
    healthCheckInterval: 100
  });

  const events: string[] = [];
  monitor.on('healthCheck', () => events.push('healthy'));
  monitor.on('unhealthy', () => events.push('unhealthy'));

  monitor.start();
  
  // Wait for at least one health check
  await new Promise(resolve => setTimeout(resolve, 150));
  
  monitor.stop();

  const metrics = monitor.getLatestMetrics();
  expect(metrics).not.toBeNull();
  
  if (metrics) {
    expect(metrics.processId).toBe(process.pid);
    expect(metrics.memoryUsage.rss).toBeGreaterThan(0);
    expect(typeof metrics.cpuUsage.user).toBe('number');
    expect(typeof metrics.cpuUsage.system).toBe('number');
  }

  expect(events.length).toBeGreaterThan(0);
});

test('HealthMonitor detects high memory usage', async () => {
  const monitor = new HealthMonitor({
    maxMemoryMB: 1, // Very low threshold to trigger warning
    healthCheckInterval: 50
  });

  let unhealthyStatus: any = null;
  monitor.on('unhealthy', (status) => {
    unhealthyStatus = status;
  });

  monitor.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  monitor.stop();

  expect(unhealthyStatus).not.toBeNull();
  if (unhealthyStatus) {
    expect(unhealthyStatus.healthy).toBe(false);
    expect(unhealthyStatus.issues.some((issue: string) => issue.includes('High memory usage'))).toBe(true);
  }
});

test('HealthMonitor detects high failure rates', () => {
  const monitor = new HealthMonitor({
    maxFailureRate: 0.1 // 10% max failure rate
  });

  // Create custom metrics with high failure rate
  const mockMetrics = {
    timestamp: new Date(),
    uptime: 60000,
    memoryUsage: { rss: 50, heapUsed: 30, heapTotal: 60, external: 5 },
    cpuUsage: { user: 10, system: 5 },
    processId: process.pid,
    queueSize: 5,
    processedJobs: 10,
    failedJobs: 5, // 50% failure rate
    lastError: undefined
  };

  // Use private method to evaluate health directly
  const status = (monitor as any).evaluateHealth(mockMetrics);

  expect(status.healthy).toBe(false);
  expect(status.issues.some((issue: string) => issue.includes('High failure rate'))).toBe(true);
  expect(status.score).toBeLessThan(100);
});

test('HealthMonitor tracks consecutive failures', async () => {
  const monitor = new HealthMonitor({
    maxMemoryMB: 1, // Trigger failures
    healthCheckInterval: 50,
    unhealthyThreshold: 2
  });

  let criticalHealth = false;
  monitor.on('criticalHealth', () => {
    criticalHealth = true;
  });

  monitor.start();
  
  // Wait for multiple health checks to trigger critical health
  await new Promise(resolve => setTimeout(resolve, 200));
  
  monitor.stop();

  expect(criticalHealth).toBe(true);
});

test('HealthMonitor maintains metrics history', async () => {
  const monitor = new HealthMonitor({
    healthCheckInterval: 25
  });

  monitor.start();
  
  // Wait for multiple health checks
  await new Promise(resolve => setTimeout(resolve, 100));
  
  monitor.stop();

  const history = monitor.getMetricsHistory();
  expect(history.length).toBeGreaterThan(1);
  
  // Check that timestamps are different
  const timestamps = history.map(m => m.timestamp.getTime());
  const uniqueTimestamps = new Set(timestamps);
  expect(uniqueTimestamps.size).toBe(timestamps.length);
});

test('HealthMonitor saves and loads metrics', async () => {
  const monitor1 = new HealthMonitor({
    healthCheckInterval: 50
  }, metricsFile);

  monitor1.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  monitor1.stop();

  const monitor2 = new HealthMonitor({}, metricsFile);
  await monitor2.loadMetrics();
  
  const history = monitor2.getMetricsHistory();
  expect(history.length).toBeGreaterThan(0);
});

test('HealthMonitor generates health reports', async () => {
  const monitor = new HealthMonitor({
    healthCheckInterval: 50
  });

  monitor.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  monitor.stop();

  const report = monitor.generateHealthReport();
  
  expect(report).toContain('Cortex Daemon Health Report');
  expect(report).toContain('Process ID');
  expect(report).toContain('Memory Usage');
  expect(report).toContain('CPU Usage');
  expect(report).toContain('Job Queue');
});

test('HealthMonitor handles errors gracefully', async () => {
  const monitor = new HealthMonitor({
    healthCheckInterval: 50
  });

  let errorEvent = null;
  monitor.on('healthCheckError', (error) => {
    errorEvent = error;
  });

  // Simulate an error in health checking by mocking process.memoryUsage
  const originalMemoryUsage = process.memoryUsage;
  (process as any).memoryUsage = () => {
    throw new Error('Simulated error');
  };

  monitor.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  monitor.stop();

  // Restore original function
  process.memoryUsage = originalMemoryUsage;

  expect(errorEvent).not.toBeNull();
});

test('HealthMonitor emits start and stop events', () => {
  const monitor = new HealthMonitor();
  const events: string[] = [];

  monitor.on('started', () => events.push('started'));
  monitor.on('stopped', () => events.push('stopped'));

  monitor.start();
  monitor.stop();

  expect(events).toEqual(['started', 'stopped']);
});

test('HealthMonitor calculates health scores correctly', async () => {
  const monitor = new HealthMonitor({
    maxMemoryMB: 1000, // High threshold
    maxCpuPercent: 90,
    maxQueueSize: 500,
    maxFailureRate: 0.2,
    healthCheckInterval: 50
  });

  // Update with good metrics
  monitor.updateMetrics({
    processedJobs: 100,
    failedJobs: 5, // 5% failure rate - good
    queueSize: 10  // Low queue size - good
  });

  let healthyStatus: any = null;
  monitor.on('healthCheck', (status) => {
    healthyStatus = status;
  });

  monitor.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  monitor.stop();

  expect(healthyStatus).not.toBeNull();
  if (healthyStatus) {
    expect(healthyStatus.healthy).toBe(true);
    expect(healthyStatus.score).toBeGreaterThan(70);
    expect(healthyStatus.issues.length).toBe(0);
  }
});