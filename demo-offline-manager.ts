#!/usr/bin/env bun

/**
 * Demo script for Offline Manager functionality
 * Shows how to use offline mode detection and queue management
 */

import { ConfigManager, AIProviderManager, DatabaseManager } from './packages/cortex-core/src/index.js';
import type { CortexConfig } from './packages/cortex-core/src/index.js';
import { OfflineManager, OfflineMode, JobPriority } from './packages/cortex-core/src/offline-manager.js';
import { JobQueue, JobType } from './packages/cortex-daemon/src/job-queue.js';

// Mock job queue for demo
class DemoJobQueue {
  private jobs: any[] = [];

  addJob(type: JobType, payload: any, priority: JobPriority, filePath?: string): string {
    const job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      type,
      payload,
      priority,
      filePath,
      createdAt: new Date()
    };
    
    this.jobs.push(job);
    console.log(`📋 Job added to queue: ${job.id} (${type})`);
    console.log(`   Payload: ${JSON.stringify(payload, null, 2)}`);
    
    return job.id;
  }

  getJobs(): any[] {
    return this.jobs;
  }
}

async function demoOfflineManager() {
  console.log('🚀 Starting Offline Manager Demo\n');

  try {
    // Load configuration
    console.log('📋 Loading Cortex configuration...');
    const config = await ConfigManager.load();
    console.log(`✅ Configuration loaded. Notes path: ${config.notesPath}\n`);

    // Initialize components
    console.log('🔧 Initializing components...');
    const dbManager = new DatabaseManager(config);
    await dbManager.initialize();
    
    const aiManager = new AIProviderManager(config);
    const jobQueue = new DemoJobQueue() as any;
    const offlineManager = new OfflineManager({
      notificationCallback: (message, type) => {
        console.log(`[${type.toUpperCase()}] ${message}`);
      }
    });

    // Initialize offline manager
    console.log('📡 Initializing offline manager...');
    await offlineManager.initialize(config, jobQueue);
    await aiManager.initializeOfflineManager(jobQueue);
    
    console.log('✅ All components initialized\n');

    // Demo 1: Check initial status
    console.log('📊 Demo 1: Initial Status');
    console.log('='.repeat(40));
    const status = offlineManager.getStatus();
    console.log('Offline Status:', JSON.stringify(status, null, 2));
    console.log('');

    // Demo 2: Queue embedding requests
    console.log('📝 Demo 2: Queue Embedding Requests');
    console.log('='.repeat(40));
    
    const sampleTexts = [
      'This is a sample note about machine learning',
      'Another note about artificial intelligence and neural networks',
      'A third note discussing data science and analytics'
    ];

    for (let i = 0; i < sampleTexts.length; i++) {
      const text = sampleTexts[i]!;
      console.log(`\nQueuing request ${i + 1}: "${text.substring(0, 50)}..."`);
      
      try {
        const requestId = await offlineManager.queueEmbeddingRequest(text, {
          priority: i === 0 ? JobPriority.HIGH : JobPriority.MEDIUM,
          filePath: `/notes/note-${i + 1}.md`
        });
        console.log(`✅ Request queued: ${requestId}`);
      } catch (error) {
        console.log(`❌ Failed to queue request: ${error}`);
      }
    }

    console.log(`\n📊 Queue status after adding requests:`);
    const queueStatus = offlineManager.getStatus();
    console.log(`   Queue size: ${queueStatus.queueSize}`);
    console.log(`   Network status: ${queueStatus.networkStatus}`);
    console.log('');

    // Demo 3: Force offline mode
    console.log('📵 Demo 3: Force Offline Mode');
    console.log('='.repeat(40));
    
    offlineManager.setOfflineMode(OfflineMode.FORCE_OFFLINE);
    const offlineStatus = offlineManager.getStatus();
    console.log('Status after forcing offline:');
    console.log(`   Mode: ${offlineStatus.mode}`);
    console.log(`   Network status: ${offlineStatus.networkStatus}`);
    console.log('');

    // Demo 4: Try to process queue while offline
    console.log('⚙️  Demo 4: Process Queue While Offline');
    console.log('='.repeat(40));
    
    console.log('Attempting to process queue...');
    const processedOffline = await offlineManager.processQueue();
    console.log(`Processed ${processedOffline} requests (should be 0 while offline)`);
    console.log('');

    // Demo 5: Switch to online mode and process
    console.log('🌐 Demo 5: Switch to Online Mode and Process');
    console.log('='.repeat(40));
    
    offlineManager.setOfflineMode(OfflineMode.FORCE_ONLINE);
    const onlineStatus = offlineManager.getStatus();
    console.log('Status after switching online:');
    console.log(`   Mode: ${onlineStatus.mode}`);
    console.log(`   Network status: ${onlineStatus.networkStatus}`);
    
    console.log('\nProcessing queue...');
    const processedOnline = await offlineManager.processQueue();
    console.log(`Processed ${processedOnline} requests`);
    
    console.log(`\n📊 Final queue status:`);
    const finalStatus = offlineManager.getStatus();
    console.log(`   Queue size: ${finalStatus.queueSize}`);
    console.log(`   Total processed: ${finalStatus.totalProcessed}`);
    console.log(`   Total failed: ${finalStatus.totalFailed}`);
    console.log('');

    // Demo 6: Show job queue contents
    console.log('📋 Demo 6: Job Queue Contents');
    console.log('='.repeat(40));
    
    const jobs = (jobQueue as DemoJobQueue).getJobs();
    console.log(`Jobs in queue: ${jobs.length}`);
    jobs.forEach((job, index) => {
      console.log(`\n${index + 1}. Job ID: ${job.id}`);
      console.log(`   Type: ${job.type}`);
      console.log(`   Priority: ${job.priority}`);
      console.log(`   Created: ${job.createdAt.toISOString()}`);
      if (job.payload?.text) {
        const text = job.payload.text;
        console.log(`   Text: ${text.substring(0, 50)}...`);
      }
    });

    // Demo 7: Network status check
    console.log('\n🌍 Demo 7: Network Status Check');
    console.log('='.repeat(40));
    
    console.log('Checking network status...');
    const networkStatus = await offlineManager.checkNetworkStatus();
    console.log(`Network status: ${networkStatus}`);
    console.log('');

    // Demo 8: Queue management
    console.log('🗂️  Demo 8: Queue Management');
    console.log('='.repeat(40));
    
    // Add more requests
    console.log('Adding more requests to demonstrate queue management...');
    await offlineManager.queueEmbeddingRequest('Additional note content 1');
    await offlineManager.queueEmbeddingRequest('Additional note content 2');
    
    console.log(`Queue size: ${offlineManager.getStatus().queueSize}`);
    
    // Remove a specific request
    const queuedRequests = offlineManager.getQueuedRequests();
    if (queuedRequests.length > 0) {
      const firstRequestId = queuedRequests[0]?.id;
      if (firstRequestId) {
        console.log(`Removing request: ${firstRequestId}`);
        const removed = offlineManager.removeRequest(firstRequestId);
        console.log(`Removed: ${removed}`);
      }
    }
    
    console.log(`Queue size after removal: ${offlineManager.getStatus().queueSize}`);
    
    // Clear remaining queue
    const clearedCount = offlineManager.clearQueue();
    console.log(`Cleared ${clearedCount} requests`);
    console.log(`Final queue size: ${offlineManager.getStatus().queueSize}`);
    console.log('');

    // Cleanup
    console.log('🧹 Cleaning up...');
    await offlineManager.shutdown();
    console.log('✅ Demo completed successfully!');

  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

// Run the demo
if (import.meta.main) {
  demoOfflineManager();
}