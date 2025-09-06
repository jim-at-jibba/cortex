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
    const { ConfigManager, AIProviderManager, DatabaseManager } = await import('cortex-core');
    
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
      const workingProvider = Object.entries(health).find(([provider, isHealthy]) => isHealthy)?.[0];
      
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
  .action(() => {
    console.log('Generating embeddings...');
  });

program
  .command('daemon')
  .description('Manage background daemon service')
  .action(() => {
    console.log('Managing daemon...');
  });

program
  .command('tui')
  .description('Launch terminal user interface')
  .action(() => {
    console.log('Launching TUI...');
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
  .command('templates')
  .description('Manage note templates')
  .option('-l, --list', 'List available templates')
  .option('-s, --show <name>', 'Show template content')
  .action(async (options) => {
    const { ConfigManager } = await import('cortex-core');
    
    try {
      // Load configuration
      const config = await ConfigManager.load();
      
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