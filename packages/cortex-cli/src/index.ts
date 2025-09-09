#!/usr/bin/env bun

/**
 * Cortex CLI - Main entry point
 * Command-line interface for Cortex note-taking system
 */

import { program } from 'commander';
import pkg from '../package.json';

// Simple prompt utilities
async function promptForTitle(): Promise<string> {
  process.stdout.write('Note title: ');
  process.stdin.setEncoding('utf8');
  
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const title = data.toString().trim();
      resolve(title || 'Untitled Note');
    });
  });
}

async function promptForEditor(): Promise<boolean> {
  process.stdout.write('Open in editor? (y/n): ');
  process.stdin.setEncoding('utf8');
  
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const response = data.toString().trim().toLowerCase();
      resolve(response === 'y' || response === 'yes');
    });
  });
}

async function promptForChoice(maxChoice: number): Promise<number> {
  process.stdout.write(`Choose (1-${maxChoice}, or 0 to cancel): `);
  process.stdin.setEncoding('utf8');
  
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const choice = parseInt(data.toString().trim());
      if (isNaN(choice) || choice < 0 || choice > maxChoice) {
        resolve(-1); // Invalid choice
      } else {
        resolve(choice === 0 ? -1 : choice - 1); // Convert to 0-based index
      }
    });
  });
}

program
  .name('cortex')
  .description('AI-powered note-taking and knowledge management CLI')
  .version(pkg.version);

// Placeholder for subcommands - will be implemented in subsequent steps
program
  .command('new')
  .description('Create a new note')
  .argument('[title]', 'Note title')
  .option('-t, --template <name>', 'Template to use')
  .action(async (title, options) => {
    const { ConfigManager, NoteManager } = await import('cortex-core');
    
    try {
      // Load configuration
      const config = await ConfigManager.load();
      const noteManager = new NoteManager(config);
      
      // Get title from argument or prompt user
      let noteTitle = title;
      if (!noteTitle) {
        noteTitle = await promptForTitle();
      }
      
      // Create the note
      const note = await noteManager.createNote(noteTitle, options.template);
      
      console.log(`✅ Created note: ${note.title}`);
      console.log(`📄 File: ${note.path}`);
      
      // Optionally open in editor
      if (process.env.EDITOR) {
        const shouldOpen = await promptForEditor();
        if (shouldOpen) {
          const { spawn } = await import('child_process');
          spawn(process.env.EDITOR, [note.path], { stdio: 'inherit' });
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to create note:', error);
      process.exit(1);
    }
  });

program
  .command('open')
  .description('Open an existing note')
  .argument('[query]', 'Search query to find notes')
  .option('-e, --editor', 'Force open in editor')
  .option('-p, --preview', 'Preview note content instead of opening')
  .action(async (query, options) => {
    const { ConfigManager, NoteManager } = await import('cortex-core');
    
    try {
      // Load configuration
      const config = await ConfigManager.load();
      const noteManager = new NoteManager(config);
      
      let selectedNote;
      
      if (query) {
        // Search for notes matching the query
        const results = await noteManager.findNotes(query);
        
        if (results.length === 0) {
          console.log('❌ No notes found matching your query');
          return;
        }
        
        if (results.length === 1) {
          selectedNote = results[0];
        } else {
          // Show multiple results and let user choose
          console.log(`Found ${results.length} notes:`);
          results.forEach((note, index) => {
            console.log(`${index + 1}. ${note.title} (${note.id})`);
          });
          
          const choice = await promptForChoice(results.length);
          if (choice === -1) {
            console.log('❌ Cancelled');
            return;
          }
          selectedNote = results[choice];
        }
      } else {
        // List all notes for selection
        const allNotes = await noteManager.findNotes('');
        
        if (allNotes.length === 0) {
          console.log('📝 No notes found. Create one with `cortex new`');
          return;
        }
        
        console.log('Select a note to open:');
        allNotes.forEach((note, index) => {
          console.log(`${index + 1}. ${note.title} (${note.id})`);
        });
        
        const choice = await promptForChoice(allNotes.length);
        if (choice === -1) {
          console.log('❌ Cancelled');
          return;
        }
        selectedNote = allNotes[choice];
      }
      
      // Handle the selected note
      if (!selectedNote) {
        console.log('❌ No note selected');
        return;
      }
      
      if (options.preview) {
        // Preview mode - show content
        console.log(`\n📄 ${selectedNote.title}\n${'='.repeat(selectedNote.title.length + 4)}`);
        console.log(selectedNote.content);
      } else if (options.editor || process.env.EDITOR) {
        // Open in editor using FileOperations
        const { FileOperations } = await import('cortex-core');
        const fileOps = new FileOperations();
        console.log(`📝 Opening ${selectedNote.title} in editor...`);
        
        try {
          await fileOps.openInEditor(selectedNote.path);
          console.log(`✅ Finished editing ${selectedNote.title}`);
        } catch (error) {
          console.error('❌ Error opening in editor:', error);
        }
      } else {
        // Show detailed information about the note
        const { FileOperations } = await import('cortex-core');
        const fileOps = new FileOperations();
        
        try {
          const fileInfo = await fileOps.getFileInfo(selectedNote.path);
          const readingStats = await fileOps.getReadingStats(selectedNote.path);
          
          console.log(`📄 ${selectedNote.title}`);
          console.log(`📁 ${selectedNote.path}`);
          console.log(`📊 ${readingStats.wordCount} words, ${readingStats.characterCount} characters`);
          console.log(`⏱️  ~${readingStats.readingTimeMinutes} min read`);
          console.log(`📅 Created: ${fileInfo.created.toLocaleDateString()}`);
          console.log(`📝 Modified: ${fileInfo.modified.toLocaleDateString()}`);
          
          if (selectedNote.tags.length > 0) {
            console.log(`🏷️  Tags: ${selectedNote.tags.join(', ')}`);
          }
        } catch (error) {
          console.log(`📄 ${selectedNote.title}`);
          console.log(`📁 ${selectedNote.path}`);
          console.warn('Could not load file statistics');
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to open note:', error);
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search through notes')
  .argument('[query]', 'Search query')
  .option('-t, --tag <tag>', 'Filter by tag')
  .option('-s, --status <status>', 'Filter by status (draft, published, archived)')
  .option('--stats', 'Show note statistics')
  .option('--tags', 'List all tags')
  .action(async (query, options) => {
    const { ConfigManager, NoteManager, MetadataManager } = await import('cortex-core');
    
    try {
      // Load configuration
      const config = await ConfigManager.load();
      const noteManager = new NoteManager(config);
      const metadataManager = new MetadataManager();
      
      if (options.stats) {
        // Show statistics
        const stats = await metadataManager.getNoteStats(config.notesPath);
        console.log('📊 Note Statistics');
        console.log('─'.repeat(30));
        console.log(`📝 Total Notes: ${stats.totalNotes}`);
        console.log(`🏷️  Unique Tags: ${stats.tagCount}`);
        console.log(`🔄 Recently Updated: ${stats.recentlyUpdated} (last 7 days)`);
        
        if (Object.keys(stats.statusBreakdown).length > 0) {
          console.log('\n📋 Status Breakdown:');
          Object.entries(stats.statusBreakdown).forEach(([status, count]) => {
            console.log(`  ${status}: ${count}`);
          });
        }
        return;
      }
      
      if (options.tags) {
        // List all tags
        const allTags = await metadataManager.getAllTags(config.notesPath);
        if (allTags.length === 0) {
          console.log('🏷️  No tags found');
        } else {
          console.log('🏷️  Available Tags:');
          allTags.forEach(tag => console.log(`  ${tag}`));
        }
        return;
      }
      
      if (options.tag) {
        // Search by tag
        const taggedNotes = await metadataManager.findNotesByTag(config.notesPath, options.tag);
        if (taggedNotes.length === 0) {
          console.log(`🏷️  No notes found with tag: ${options.tag}`);
        } else {
          console.log(`🏷️  Notes tagged with '${options.tag}':`);
          for (const notePath of taggedNotes) {
            const matter = await import('gray-matter');
            const content = await Bun.file(notePath).text();
            const parsed = matter.default(content);
            const title = parsed.data.title || notePath.split('/').pop()?.replace('.md', '') || 'Untitled';
            console.log(`  📄 ${title}`);
          }
        }
        return;
      }
      
      if (!query) {
        console.log('❌ Please provide a search query');
        console.log('💡 Use --tag <tag> to search by tag');
        console.log('💡 Use --stats to see note statistics');
        console.log('💡 Use --tags to list all tags');
        return;
      }
      
      // Regular text search
      const results = await noteManager.findNotes(query);
      
      if (results.length === 0) {
        console.log('❌ No notes found matching your query');
      } else {
        console.log(`🔍 Found ${results.length} notes:`);
        results.forEach((note, index) => {
          console.log(`${index + 1}. 📄 ${note.title}`);
          if (note.tags.length > 0) {
            console.log(`   🏷️  ${note.tags.join(', ')}`);
          }
          console.log(`   📁 ${note.path}`);
          console.log();
        });
      }
      
    } catch (error) {
      console.error('❌ Failed to search notes:', error);
      process.exit(1);
    }
  });

program
  .command('chat')
  .description('Start AI chat session')
  .argument('[message]', 'Initial message to send')
  .option('-s, --stream', 'Use streaming responses')
  .action(async (message, options) => {
    const { ConfigManager, AIProviderManager } = await import('cortex-core');
    
    try {
      // Load configuration
      const config = await ConfigManager.load();
      
      // Check if AI provider is configured
      if (!config.apiKeys?.openai && !config.apiKeys?.anthropic && !config.apiKeys?.ollama) {
        console.log('❌ No AI provider configured. Please set your API keys:');
        console.log('   export OPENAI_API_KEY="your-key"');
        console.log('   export ANTHROPIC_API_KEY="your-key"');
        console.log('   export OLLAMA_API_KEY="your-key"');
        console.log('Or use: cortex config --set "apiKeys.openai=your-key"');
        process.exit(1);
      }
      
      const aiManager = new AIProviderManager(config);
      
      // Test AI provider health
      const health = await aiManager.healthCheck();
      const workingProvider = Object.entries(health).find(([, isHealthy]) => isHealthy)?.[0];
      
      if (!workingProvider) {
        console.log('❌ No AI providers are available. Check your API keys.');
        process.exit(1);
      }
      
      console.log(`🤖 Starting chat with ${workingProvider.toUpperCase()}`);
      console.log('💡 Type "exit" or "quit" to end the session\n');
      
      const messages: Array<{role: string, content: string}> = [];
      
      // Add initial message if provided
      if (message) {
        messages.push({ role: 'user', content: message });
        console.log(`👤 You: ${message}`);
        
        if (options.stream) {
          process.stdout.write('🤖 AI: ');
          const stream = await aiManager.streamChatCompletion(messages);
          let response = '';
          for await (const chunk of stream) {
            process.stdout.write(chunk);
            response += chunk;
          }
          console.log('\n');
          messages.push({ role: 'assistant', content: response });
        } else {
          const response = await aiManager.chatCompletion(messages);
          console.log(`🤖 AI: ${response}\n`);
          messages.push({ role: 'assistant', content: response });
        }
      }
      
      // Interactive chat loop
      while (true) {
        process.stdout.write('👤 You: ');
        process.stdin.setEncoding('utf8');
        
        const userInput = await new Promise<string>((resolve) => {
          process.stdin.once('data', (data) => {
            resolve(data.toString().trim());
          });
        });
        
        if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
          console.log('👋 Chat ended. Goodbye!');
          break;
        }
        
        if (!userInput.trim()) continue;
        
        messages.push({ role: 'user', content: userInput });
        
        try {
          if (options.stream) {
            process.stdout.write('🤖 AI: ');
            const stream = await aiManager.streamChatCompletion(messages);
            let response = '';
            for await (const chunk of stream) {
              process.stdout.write(chunk);
              response += chunk;
            }
            console.log('\n');
            messages.push({ role: 'assistant', content: response });
          } else {
            const response = await aiManager.chatCompletion(messages);
            console.log(`🤖 AI: ${response}\n`);
            messages.push({ role: 'assistant', content: response });
          }
        } catch (error) {
          console.error('❌ Chat error:', error instanceof Error ? error.message : 'Unknown error');
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to start chat:', error);
      process.exit(1);
    }
  });

program
  .command('embed')
  .description('Generate embeddings for notes')
  .option('--force', 'Regenerate embeddings for all notes (even if they exist)')
  .option('--batch-size <number>', 'Process notes in batches (default: 10)', '10')
  .action(async (options) => {
    try {
      console.log('🔄 Starting embedding generation...\n');
      
      const { ConfigManager, DatabaseManager, AIProviderManager } = await import('cortex-core');
      
      // Load configuration
      console.log('📋 Loading configuration...');
      const config = await ConfigManager.load();
      console.log(`✅ Using ${config.aiProvider} provider with ${config.embeddingModel} model\n`);
      
      // Initialize services
      console.log('🗄️ Initializing database...');
      const dbManager = new DatabaseManager(config);
      await dbManager.initialize();
      console.log('✅ Database ready\n');
      
      console.log('🤖 Initializing AI provider...');
      const aiManager = new AIProviderManager(config);
      console.log('✅ AI provider ready\n');
      
      // Get all notes
      console.log('📚 Loading notes...');
      const notes = await dbManager.getAllNotes(1000); // Get up to 1000 notes
      console.log(`✅ Found ${notes.length} notes\n`);
      
      if (notes.length === 0) {
        console.log('ℹ️ No notes found to process');
        return;
      }
      
      // Filter notes that need embeddings
      const allEmbeddings = await dbManager.getAllEmbeddings();
      const existingEmbeddingNoteIds = new Set(allEmbeddings.map(e => e.note_id));
      
      let notesToProcess = notes;
      if (!options.force) {
        notesToProcess = notes.filter(note => !existingEmbeddingNoteIds.has(note.id));
        console.log(`📊 ${notes.length - notesToProcess.length} notes already have embeddings`);
        console.log(`🎯 Processing ${notesToProcess.length} notes that need embeddings\n`);
      } else {
        console.log('🔥 Force mode: regenerating embeddings for all notes\n');
      }
      
      if (notesToProcess.length === 0) {
        console.log('✅ All notes already have embeddings!');
        console.log('💡 Use --force flag to regenerate existing embeddings');
        return;
      }
      
      // Process notes in batches
      const batchSize = parseInt(options.batchSize);
      const totalBatches = Math.ceil(notesToProcess.length / batchSize);
      let processed = 0;
      let errors = 0;
      
      console.log(`🚀 Processing in batches of ${batchSize} notes...\n`);
      
      for (let i = 0; i < notesToProcess.length; i += batchSize) {
        const batch = notesToProcess.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        
        console.log(`📦 Batch ${batchNum}/${totalBatches}: Processing ${batch.length} notes...`);
        
        const batchStartTime = Date.now();
        
        for (const note of batch) {
          try {
            // Generate embedding for note content
            const content = note.content || note.title || '';
            if (content.trim().length === 0) {
              console.log(`⚠️  Skipping empty note: ${note.title || note.id}`);
              continue;
            }
            
            const embedding = await aiManager.generateEmbedding(content);
            
            // Store or update embedding
            if (options.force && existingEmbeddingNoteIds.has(note.id)) {
              // For force mode, we would need to update existing embeddings
              // For now, we'll skip existing ones even in force mode
              // TODO: Implement embedding update functionality
              console.log(`   ⏭️  Skipping existing: ${note.title || note.id}`);
            } else {
              await dbManager.storeEmbedding(note.id, embedding);
              console.log(`   ✅ ${note.title || note.id}`);
            }
            
            processed++;
            
          } catch (error) {
            errors++;
            console.log(`   ❌ Failed: ${note.title || note.id} - ${error instanceof Error ? error.message : error}`);
          }
        }
        
        const batchTime = Date.now() - batchStartTime;
        console.log(`   ⏱️  Batch completed in ${batchTime}ms (${(batchTime/batch.length).toFixed(1)}ms per note)\n`);
        
        // Small delay between batches to avoid rate limits
        if (batchNum < totalBatches) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log('🎉 Embedding generation completed!\n');
      console.log(`📊 Summary:`);
      console.log(`   ✅ Successfully processed: ${processed} notes`);
      console.log(`   ❌ Errors: ${errors} notes`);
      console.log(`   📈 Success rate: ${((processed / (processed + errors)) * 100).toFixed(1)}%`);
      
      if (errors > 0) {
        console.log('\n💡 Tip: Run the command again to retry failed embeddings');
      }
      
    } catch (error) {
      console.error('❌ Failed to generate embeddings:', error);
      process.exit(1);
    }
  });

program
  .command('daemon')
  .description('Manage background daemon service')
  .option('--start', 'Start the daemon')
  .option('--stop', 'Stop the daemon')
  .option('--restart', 'Restart the daemon')
  .option('--status', 'Show daemon status')
  .option('--logs [lines]', 'Show daemon logs (default: 50 lines)')
  .option('--clear-logs', 'Clear daemon logs')
  .option('--health', 'Show detailed health report')
  .option('--force', 'Force stop daemon')
  .action(async (options) => {
    const { DaemonManager } = await import('cortex-daemon');
    
    try {
      const manager = DaemonManager.getInstance();
      
      if (options.start) {
        console.log('🚀 Starting Cortex daemon...');
        const status = await manager.startDaemon(true); // Start detached
        console.log(`✅ Daemon started successfully (PID: ${status.pid})`);
        return;
      }
      
      if (options.stop) {
        console.log('🛑 Stopping Cortex daemon...');
        await manager.stopDaemon(options.force);
        console.log('✅ Daemon stopped successfully');
        return;
      }
      
      if (options.restart) {
        console.log('🔄 Restarting Cortex daemon...');
        const status = await manager.restartDaemon();
        console.log(`✅ Daemon restarted successfully (PID: ${status.pid})`);
        return;
      }
      
      if (options.logs !== undefined) {
        const lines = parseInt(options.logs) || 50;
        console.log(`📋 Daemon logs (last ${lines} lines):`);
        console.log('─'.repeat(50));
        
        const logs = await manager.getLogs(lines);
        if (logs.length === 0) {
          console.log('No logs available');
        } else {
          logs.forEach(line => console.log(line));
        }
        return;
      }
      
      if (options.clearLogs) {
        await manager.clearLogs();
        console.log('✅ Daemon logs cleared');
        return;
      }
      
      if (options.health) {
        console.log('📊 Generating health report...');
        const status = await manager.getDaemonStatus();
        
        if (!status) {
          console.log('❌ Daemon is not running');
          return;
        }
        
        // Try to get detailed health report if available
        try {
          // This would require adding a method to DaemonManager to get health report
          console.log('📋 Daemon Health Report');
          console.log('═'.repeat(50));
          
          const healthIcon = status.health?.healthy ? '✅' : '⚠️';
          console.log(`${healthIcon} Overall Health: ${status.health?.healthy ? 'HEALTHY' : 'UNHEALTHY'} (${status.health?.score || 0}/100)`);
          console.log(`🆔 Process ID: ${status.pid}`);
          console.log(`⏰ Uptime: ${Math.floor(status.uptime / 1000 / 60)} minutes`);
          
          if (status.jobQueue) {
            console.log('\n📋 Job Queue Status:');
            console.log(`  • Pending: ${status.jobQueue.pending}`);
            console.log(`  • Processing: ${status.jobQueue.processing}`);
            console.log(`  • Failed: ${status.jobQueue.failed}`);
            console.log(`  • Total: ${status.jobQueue.totalInQueue}`);
          }
          
          console.log('\n📊 Job Statistics:');
          console.log(`  • Total Processed: ${status.processedJobs}`);
          console.log(`  • Total Failed: ${status.failedJobs}`);
          const failureRate = status.processedJobs + status.failedJobs > 0 
            ? ((status.failedJobs / (status.processedJobs + status.failedJobs)) * 100).toFixed(2) 
            : '0';
          console.log(`  • Failure Rate: ${failureRate}%`);
          
          if (status.health) {
            console.log('\n🔍 Health Details:');
            console.log(`  • Consecutive Failures: ${status.health.consecutiveFailures}`);
            
            if (status.health.issues.length > 0) {
              console.log('  • Current Issues:');
              status.health.issues.forEach(issue => console.log(`    - ${issue}`));
            }
            
            if (status.health.lastError) {
              console.log(`  • Last Error: ${status.health.lastError}`);
            }
          }
          
          if (status.lastHealthCheck) {
            console.log(`\n💓 Last Health Check: ${status.lastHealthCheck.toLocaleString()}`);
          }
          
          console.log('\n═'.repeat(50));
          
        } catch (error) {
          console.error('❌ Failed to generate health report:', error instanceof Error ? error.message : 'Unknown error');
        }
        return;
      }
      
      // Default action: show status
      console.log('🔍 Checking daemon status...');
      const status = await manager.getDaemonStatus();
      
      if (!status) {
        console.log('❌ Daemon is not running');
        console.log('\n💡 Start with: cortex daemon --start');
      } else {
        console.log('✅ Daemon is running');
        console.log('─'.repeat(50));
        
        // Basic info
        console.log(`🆔 PID: ${status.pid}`);
        console.log(`⏰ Uptime: ${Math.floor(status.uptime / 1000 / 60)}m ${Math.floor(status.uptime / 1000) % 60}s`);
        
        // Job queue info
        if (status.jobQueue) {
          console.log('\n📋 Job Queue:');
          console.log(`  Pending: ${status.jobQueue.pending}`);
          console.log(`  Processing: ${status.jobQueue.processing}`);
          console.log(`  Failed: ${status.jobQueue.failed}`);
          console.log(`  Total: ${status.jobQueue.totalInQueue}`);
        }
        
        console.log(`\n📊 Job Statistics:`);
        console.log(`  Processed: ${status.processedJobs}`);
        console.log(`  Failed: ${status.failedJobs}`);
        
        // Health status
        if (status.health) {
          const healthIcon = status.health.healthy ? '✅' : '⚠️';
          console.log(`\n${healthIcon} Health: ${status.health.healthy ? 'Healthy' : 'Unhealthy'} (${status.health.score}/100)`);
          
          if (status.health.consecutiveFailures > 0) {
            console.log(`  Consecutive Failures: ${status.health.consecutiveFailures}`);
          }
          
          if (status.health.issues.length > 0) {
            console.log('  Issues:');
            status.health.issues.forEach(issue => console.log(`    • ${issue}`));
          }
          
          if (status.health.lastError) {
            console.log(`  Last Error: ${status.health.lastError}`);
          }
        }
        
        if (status.lastHealthCheck) {
          console.log(`💓 Last Health Check: ${status.lastHealthCheck.toLocaleString()}`);
        }
        
        console.log('\n💡 Commands:');
        console.log('  cortex daemon --stop      Stop daemon');
        console.log('  cortex daemon --restart   Restart daemon');
        console.log('  cortex daemon --logs      View logs');
        console.log('  cortex daemon --health    Health report');
      }
      
    } catch (error) {
      console.error('❌ Daemon management error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('tui')
  .description('Launch terminal user interface')
  .action(async () => {
    try {
      const { startTUI } = await import('cortex-tui');
      startTUI();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Raw mode is not supported')) {
        console.error('❌ TUI Error: Raw mode is not supported in the current environment.');
        console.error('💡 Try running the TUI in an interactive terminal or with: bun run ./dist/index.js tui');
        process.exit(1);
      }
      throw error;
    }
  });

program
  .command('sync')
  .description('Sync notes with git repository')
  .action(() => {
    console.log('Syncing notes...');
  });

program
  .command('config')
  .description('Manage configuration settings')
  .option('-g, --get <key>', 'Get a configuration value')
  .option('-s, --set <key=value>', 'Set a configuration value')
  .option('--show', 'Show current configuration')
  .action(async (options) => {
    const { ConfigManager } = await import('cortex-core');
    
    try {
      if (options.show) {
        const config = await ConfigManager.load();
        console.log(JSON.stringify(config, null, 2));
      } else if (options.get) {
        const value = await ConfigManager.get(options.get);
        console.log(`${options.get}: ${JSON.stringify(value)}`);
      } else if (options.set) {
        const [key, value] = options.set.split('=');
        if (!key || !value) {
          console.error('❌ Invalid format. Use: --set key=value');
          process.exit(1);
        }
        
        // Try to parse as JSON, fallback to string
        let parsedValue;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          parsedValue = value;
        }
        
        await ConfigManager.set(key, parsedValue);
        console.log(`✅ Set ${key} = ${JSON.stringify(parsedValue)}`);
      } else {
        console.log('Use --help to see available config commands');
      }
    } catch (error) {
      console.error('❌ Configuration error:', error);
      process.exit(1);
    }
  });

program
  .command('template')
  .description('Manage note templates')
  .option('-l, --list', 'List available templates')
  .option('-s, --show <name>', 'Show template content')
  .action(async (options) => {
    const { ConfigManager } = await import('cortex-core');
    
    try {
      // Load configuration
      await ConfigManager.load();
      
      if (options.list || (!options.show)) {
        // List built-in templates
        console.log('📋 Available templates:');
        console.log('  default - Basic note template');
        console.log('  daily   - Daily note with planning sections');  
        console.log('  meeting - Meeting notes with agenda and action items');
        
        // TODO: List custom templates from templates directory
        console.log('\n💡 Use --template <name> with `cortex new` to use a template');
        console.log('💡 Use --show <name> to view template content');
      }
      
      if (options.show) {
        console.log(`\n📄 Template: ${options.show}`);
        console.log('─'.repeat(50));
        
        // Show built-in template examples
        switch (options.show) {
          case 'daily':
            console.log(`---
title: "Daily Note - {{date}}"
created: {{timestamp}}
tags: ["daily"]
date: {{date}}
---

# Daily Note - {{date}}

## Today's Plan
- 

## Notes

## Reflections

## Tomorrow
- `);
            break;
            
          case 'meeting':
            console.log(`---
title: "{{title}}"
created: {{timestamp}}
tags: ["meeting"]
date: {{date}}
---

# {{title}}

**Date:** {{date}}  
**Time:** {{time}}  

## Agenda

## Notes

## Action Items
- [ ] 

## Next Steps`);
            break;
            
          case 'default':
            console.log(`---
title: "{{title}}"
created: {{timestamp}}
tags: []
---

# {{title}}

`);
            break;
            
          default:
            console.log(`❌ Unknown template: ${options.show}`);
            console.log('Available templates: default, daily, meeting');
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to manage templates:', error);
      process.exit(1);
    }
  });

program.parse();