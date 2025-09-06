import { test, expect, beforeAll, afterAll } from 'bun:test';
import { DatabaseManager, NoteManager, ConfigManager } from './index.js';
import { join } from 'path';
import { unlink } from 'fs/promises';

let dbManager: DatabaseManager;
let noteManager: NoteManager;
let testConfig: any;
let testDbPath: string;
let testVectorPath: string;
beforeAll(async () => {
  // Create test config with temp paths
  testConfig = ConfigManager.getDefaultConfig();
  testConfig.databasePath = join(import.meta.dir, 'integration_test.db');
  testConfig.notesPath = join(import.meta.dir, 'test_notes');
  testVectorPath = testConfig.databasePath.replace('.db', '_vector_index.bin');
  testDbPath = testConfig.databasePath;
  
  dbManager = new DatabaseManager(testConfig);
  noteManager = new NoteManager(testConfig);
  
  await dbManager.initialize();
});

afterAll(async () => {
  await dbManager.close();
  
  // Clean up test files
  try {
    await unlink(testDbPath);
    await unlink(testVectorPath);
    // Clean up notes directory would require recursive delete - skip for this test
  } catch {}
});

test('End-to-end note creation and database storage workflow', async () => {
  console.log('\n=== TESTING END-TO-END WORKFLOW ===\n');
  
  // Step 1: Create a note using NoteManager
  console.log('1. Creating note with NoteManager...');
  const note = await noteManager.createNote('My Test Note', 'daily');
  expect(note.title).toBe('My Test Note');
  expect(note.tags).toContain('daily');
  console.log(`   ✓ Created note: ${note.id}`);
  
  // Step 2: Store the note in database
  console.log('2. Storing note in database...');
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
  console.log('   ✓ Note stored in database');
  
  // Step 3: Create some sample embeddings (simulated)
  console.log('3. Creating sample embeddings...');
  const sampleEmbedding = Array(1536).fill(0).map(() => Math.random());
  const embeddingId = await dbManager.storeEmbedding(note.id, sampleEmbedding);
  console.log(`   ✓ Embedding stored with ID: ${embeddingId}`);
  
  // Step 4: Test full-text search
  console.log('4. Testing full-text search...');
  const searchResults = await dbManager.searchNotes('Test');
  expect(searchResults.length).toBeGreaterThan(0);
  expect(searchResults[0]?.title).toContain('Test');
  console.log(`   ✓ Found ${searchResults.length} notes via text search`);
  
  // Step 5: Test vector similarity search
  console.log('5. Testing vector similarity search...');
  const queryEmbedding = Array(1536).fill(0).map(() => Math.random());
  const similarNotes = await dbManager.searchSimilarNotes(queryEmbedding, 3);
  expect(similarNotes.length).toBeGreaterThan(0);
  console.log(`   ✓ Found ${similarNotes.length} similar notes`);
  console.log(`   ✓ Top similarity score: ${similarNotes[0]?.similarity.toFixed(4)}`);
  
  // Step 6: Test database statistics
  console.log('6. Checking database statistics...');
  const stats = await dbManager.getStats();
  expect(stats.totalNotes).toBe(1);
  expect(stats.totalEmbeddings).toBe(1);
  expect(stats.dbSizeBytes).toBeGreaterThan(0);
  console.log(`   ✓ Database contains ${stats.totalNotes} notes and ${stats.totalEmbeddings} embeddings`);
  console.log(`   ✓ Database size: ${Math.round(stats.dbSizeBytes / 1024)} KB`);
  console.log(`   ✓ Vector index size: ${Math.round(stats.indexSizeBytes / 1024)} KB`);
  
  console.log('\n=== ALL TESTS PASSED ===\n');
});

test('Performance test with multiple notes', async () => {
  console.log('\n=== TESTING PERFORMANCE ===\n');
  
  const startTime = Date.now();
  
  // Create multiple notes
  console.log('Creating 50 test notes...');
  const noteIds: string[] = [];
  
  for (let i = 0; i < 50; i++) {
    const note = await noteManager.createNote(`Performance Test Note ${i}`, 'meeting');
    const noteRecord = {
      id: note.id,
      title: note.title,
      content: `Content for note ${i}. This is test content with some keywords: performance, testing, database, vector, similarity, search.`,
      path: note.path,
      frontmatter_json: JSON.stringify(note.frontmatter),
      created_at: note.createdAt.toISOString(),
      updated_at: note.updatedAt.toISOString(),
      tags_json: JSON.stringify(note.tags)
    };
    
    await dbManager.createNote(noteRecord);
    noteIds.push(note.id);
  }
  
  const creationTime = Date.now() - startTime;
  console.log(`   ✓ Created 50 notes in ${creationTime}ms (${(creationTime/50).toFixed(1)}ms per note)`);
  
  // Add embeddings in batch
  console.log('Adding embeddings for all notes...');
  const embeddingStartTime = Date.now();
  
  for (const noteId of noteIds) {
    const embedding = Array(1536).fill(0).map(() => Math.random());
    await dbManager.storeEmbedding(noteId, embedding);
  }
  
  const embeddingTime = Date.now() - embeddingStartTime;
  console.log(`   ✓ Added 50 embeddings in ${embeddingTime}ms (${(embeddingTime/50).toFixed(1)}ms per embedding)`);
  
  // Test search performance
  console.log('Testing search performance...');
  const searchStartTime = Date.now();
  
  const textSearchResults = await dbManager.searchNotes('performance testing');
  const textSearchTime = Date.now() - searchStartTime;
  
  const vectorSearchStartTime = Date.now();
  const queryEmbedding = Array(1536).fill(0).map(() => Math.random());
  const vectorSearchResults = await dbManager.searchSimilarNotes(queryEmbedding, 10);
  const vectorSearchTime = Date.now() - vectorSearchStartTime;
  
  console.log(`   ✓ Text search: ${textSearchTime}ms, found ${textSearchResults.length} results`);
  console.log(`   ✓ Vector search: ${vectorSearchTime}ms, found ${vectorSearchResults.length} results`);
  
  // Final stats
  const finalStats = await dbManager.getStats();
  console.log(`   ✓ Final database: ${finalStats.totalNotes} notes, ${finalStats.totalEmbeddings} embeddings`);
  console.log(`   ✓ Database size: ${Math.round(finalStats.dbSizeBytes / 1024)} KB`);
  
  const totalTime = Date.now() - startTime;
  console.log(`\n   Total test time: ${totalTime}ms`);
  
  // Verify we have expected number of notes
  expect(finalStats.totalNotes).toBe(51); // 1 from previous test + 50 new
  expect(finalStats.totalEmbeddings).toBe(51);
  
  console.log('\n=== PERFORMANCE TEST PASSED ===\n');
});