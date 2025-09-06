#!/usr/bin/env bun

/**
 * Manual test script for the Cortex database system
 * Run with: bun src/manual-test.ts
 */

import { DatabaseManager, ConfigManager, NoteManager, type Note } from './index.js';
import { join } from 'path';

async function main() {
  console.log('🚀 Cortex Database Manual Test\n');

  // Setup
  const config = ConfigManager.getDefaultConfig();
  config.databasePath = join(import.meta.dir, 'manual_test.db');
  config.notesPath = join(import.meta.dir, 'manual_test_notes');

  const dbManager = new DatabaseManager(config);
  const noteManager = new NoteManager(config);

  try {
    // Initialize database
    console.log('📚 Initializing database...');
    await dbManager.initialize();
    console.log('✅ Database initialized\n');

    // Health check
    const isHealthy = await dbManager.healthCheck();
    console.log(`💖 Health check: ${isHealthy ? '✅ Healthy' : '❌ Unhealthy'}\n`);

    // Create some sample notes
    console.log('📝 Creating sample notes...');
    
    const notes = [
      { title: 'AI and Machine Learning Basics', content: 'Understanding neural networks, deep learning, and artificial intelligence fundamentals.', template: 'default' },
      { title: 'Database Design Principles', content: 'Normalization, indexing, and query optimization techniques for efficient databases.', template: 'default' },
      { title: 'Vector Embeddings Explained', content: 'How vector embeddings work in semantic search and similarity matching.', template: 'default' },
      { title: 'Daily Standup - Project Update', content: 'Discussed progress on the AI integration and database implementation.', template: 'meeting' },
      { title: 'Research on HNSW Algorithm', content: 'Hierarchical Navigable Small World graphs for approximate nearest neighbor search.', template: 'default' }
    ];

    const createdNotes: Note[] = [];
    for (const noteData of notes) {
      const note = await noteManager.createNote(noteData.title, noteData.template);
      
      // Update content
      note.content = noteData.content;
      
      // Store in database
      const noteRecord = {
        id: note.id,
        title: note.title,
        content: note.content,
        path: note.path,
        frontmatter_json: JSON.stringify(note.frontmatter),
        created_at: note.createdAt.toISOString(),
        updated_at: note.updatedAt.toISOString(),
        tags_json: JSON.stringify(note.tags)
      };
      
      await dbManager.createNote(noteRecord);
      createdNotes.push(note);
      console.log(`   ✅ Created: "${note.title}"`);
    }
    console.log(`\n📊 Created ${createdNotes.length} notes\n`);

    // Add sample embeddings (simulated - in real use, these would come from an AI model)
    console.log('🧠 Adding vector embeddings...');
    for (let i = 0; i < createdNotes.length; i++) {
      // Create a somewhat realistic embedding based on content theme
      const embedding = Array(1536).fill(0).map(() => {
        // Add some theme-based bias to make similar content cluster together
        let value = Math.random() * 0.4 - 0.2; // Base random value
        
        // Add bias based on content theme
        const content = createdNotes[i]!.content.toLowerCase();
        if (content.includes('ai') || content.includes('neural') || content.includes('machine learning')) {
          value += Math.random() * 0.3; // AI theme
        }
        if (content.includes('database') || content.includes('indexing') || content.includes('query')) {
          value += Math.random() * 0.2 + 0.1; // Database theme
        }
        if (content.includes('vector') || content.includes('embedding') || content.includes('similarity')) {
          value += Math.random() * 0.25 + 0.05; // Vector theme
        }
        
        return value;
      });
      
      await dbManager.storeEmbedding(createdNotes[i]!.id, embedding);
      console.log(`   ✅ Added embedding for: "${createdNotes[i]!.title}"`);
    }
    console.log('\n');

    // Test full-text search
    console.log('🔍 Testing full-text search...');
    const textQueries = ['AI machine learning', 'database design', 'vector embeddings', 'daily standup'];
    
    for (const query of textQueries) {
      const results = await dbManager.searchNotes(query);
      console.log(`   Query: "${query}" → ${results.length} results`);
      if (results.length > 0) {
        console.log(`      Top result: "${results[0]?.title}"`);
      }
    }
    console.log('');

    // Test vector similarity search
    console.log('🎯 Testing vector similarity search...');
    
    // Use the first note's embedding as a query to find similar notes
    if (createdNotes.length > 0) {
      const firstNoteRecord = await dbManager.getNoteById(createdNotes[0]!.id);
      if (firstNoteRecord?.embedding_id) {
        const queryEmbedding = await dbManager.getEmbedding(firstNoteRecord.embedding_id);
        if (queryEmbedding) {
          const similarNotes = await dbManager.searchSimilarNotes(queryEmbedding, 3);
          
          console.log(`   Query note: "${createdNotes[0]!.title}"`);
          console.log('   Similar notes:');
          for (const result of similarNotes) {
            const note = await dbManager.getNoteById(result.noteId);
            console.log(`      ${(result.similarity * 100).toFixed(1)}% - "${note?.title}"`);
          }
        }
      }
    }
    console.log('');

    // Test pagination
    console.log('📄 Testing pagination...');
    const page1 = await dbManager.getAllNotes(2, 0);
    const page2 = await dbManager.getAllNotes(2, 2);
    
    console.log('   Page 1 (limit 2, offset 0):');
    page1.forEach(note => console.log(`      - ${note.title}`));
    
    console.log('   Page 2 (limit 2, offset 2):');
    page2.forEach(note => console.log(`      - ${note.title}`));
    console.log('');

    // Database statistics
    console.log('📈 Database Statistics...');
    const stats = await dbManager.getStats();
    console.log(`   📝 Total notes: ${stats.totalNotes}`);
    console.log(`   🧠 Total embeddings: ${stats.totalEmbeddings}`);
    console.log(`   💾 Database size: ${Math.round(stats.dbSizeBytes / 1024)} KB`);
    console.log(`   🗂️ Vector index size: ${Math.round(stats.indexSizeBytes / 1024)} KB`);
    console.log('');

    // Test update operations
    console.log('✏️ Testing update operations...');
    if (createdNotes.length > 0) {
      const firstNote = createdNotes[0]!;
      await dbManager.updateNote(firstNote.id, {
        title: 'Updated: AI and Machine Learning Basics',
        content: 'Updated content with more details about neural networks and deep learning applications.',
        updated_at: new Date().toISOString()
      });
      
      const updatedNote = await dbManager.getNoteById(firstNote.id);
      console.log(`   ✅ Updated note: "${updatedNote?.title}"`);
    }
    console.log('');

    // Performance benchmark
    console.log('⚡ Performance Benchmark...');
    const startTime = Date.now();
    
    // Batch operations
    const batchResults = await Promise.all([
      dbManager.getAllNotes(10),
      dbManager.searchNotes('machine'),
      dbManager.getStats()
    ]);
    
    const endTime = Date.now();
    console.log(`   ✅ Executed 3 concurrent operations in ${endTime - startTime}ms`);
    console.log(`      - Retrieved ${batchResults[0].length} notes`);
    console.log(`      - Found ${batchResults[1].length} search results`);
    console.log(`      - Database has ${batchResults[2].totalNotes} total notes`);
    console.log('');

    console.log('🎉 All manual tests completed successfully!');
    console.log('\n💡 Try running more queries:');
    console.log('   - Different search terms');
    console.log('   - Various similarity searches');
    console.log('   - Update and delete operations');
    console.log('   - Stress test with many notes\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up
    await dbManager.close();
    console.log('🔒 Database connection closed');
  }
}

// Run the test
if (import.meta.main) {
  main().catch(console.error);
}