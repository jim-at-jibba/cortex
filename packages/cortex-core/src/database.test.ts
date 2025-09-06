import { test, expect, beforeAll, afterAll } from 'bun:test';
import { DatabaseManager, type NoteRecord } from './database.js';
import { ConfigManager } from './config.js';
import { join } from 'path';
import { unlink } from 'fs/promises';

let dbManager: DatabaseManager;
let testConfig: any;
let testDbPath: string;
let testVectorPath: string;

beforeAll(async () => {
  // Create test config with temp paths
  testConfig = ConfigManager.getDefaultConfig();
  testConfig.databasePath = join(import.meta.dir, 'test_cortex.db');
  testVectorPath = testConfig.databasePath.replace('.db', '_vector_index.bin');
  testDbPath = testConfig.databasePath;
  
  dbManager = new DatabaseManager(testConfig);
  await dbManager.initialize();
});

afterAll(async () => {
  await dbManager.close();
  
  // Clean up test files
  try {
    await unlink(testDbPath);
  } catch {}
  try {
    await unlink(testVectorPath);
  } catch {}
});

test('DatabaseManager initialization', async () => {
  expect(await dbManager.healthCheck()).toBe(true);
});

test('Create and retrieve note', async () => {
  const noteData: Omit<NoteRecord, 'embedding_id'> = {
    id: 'test-note-1',
    title: 'Test Note',
    content: 'This is a test note content.',
    path: '/test/path/note.md',
    frontmatter_json: JSON.stringify({ tags: ['test'], author: 'Test User' }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags_json: JSON.stringify(['test', 'demo'])
  };

  // Create note
  await dbManager.createNote(noteData);

  // Retrieve note
  const retrievedNote = await dbManager.getNoteById('test-note-1');
  expect(retrievedNote).not.toBeNull();
  expect(retrievedNote?.title).toBe('Test Note');
  expect(retrievedNote?.content).toBe('This is a test note content.');
});

test('Update note', async () => {
  const updates = {
    title: 'Updated Test Note',
    content: 'Updated content',
    updated_at: new Date().toISOString()
  };

  await dbManager.updateNote('test-note-1', updates);

  const updatedNote = await dbManager.getNoteById('test-note-1');
  expect(updatedNote).not.toBeNull();
  expect(updatedNote?.title).toBe('Updated Test Note');
  expect(updatedNote?.content).toBe('Updated content');
});

test('Store and retrieve embedding', async () => {
  const embedding = Array(1536).fill(0).map(() => Math.random());
  
  const embeddingId = await dbManager.storeEmbedding('test-note-1', embedding);
  expect(embeddingId).toBeGreaterThan(0);

  const retrievedEmbedding = await dbManager.getEmbedding(embeddingId);
  expect(retrievedEmbedding).not.toBeNull();
  expect(retrievedEmbedding?.length).toBe(1536);
});

test('Vector similarity search', async () => {
  // Create another note with different embedding
  const noteData2: Omit<NoteRecord, 'embedding_id'> = {
    id: 'test-note-2',
    title: 'Another Test Note',
    content: 'Different content for similarity testing.',
    path: '/test/path/note2.md',
    frontmatter_json: JSON.stringify({ tags: ['test2'] }),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags_json: JSON.stringify(['test2'])
  };

  await dbManager.createNote(noteData2);
  
  const embedding2 = Array(1536).fill(0).map(() => Math.random());
  await dbManager.storeEmbedding('test-note-2', embedding2);

  // Test similarity search
  const queryEmbedding = Array(1536).fill(0).map(() => Math.random());
  const similarNotes = await dbManager.searchSimilarNotes(queryEmbedding, 5);
  
  expect(similarNotes.length).toBeGreaterThan(0);
  expect(similarNotes.length).toBeLessThanOrEqual(5);
  expect(similarNotes[0]).toHaveProperty('noteId');
  expect(similarNotes[0]).toHaveProperty('similarity');
});

test('Full-text search', async () => {
  const results = await dbManager.searchNotes('test', 10);
  expect(results.length).toBeGreaterThan(0);
  
  // Should find our test notes
  const titles = results.map(note => note.title);
  expect(titles.some(title => title.includes('Test'))).toBe(true);
});

test('Get all notes with pagination', async () => {
  const allNotes = await dbManager.getAllNotes();
  expect(allNotes.length).toBe(2);

  const limitedNotes = await dbManager.getAllNotes(1);
  expect(limitedNotes.length).toBe(1);

  const offsetNotes = await dbManager.getAllNotes(1, 1);
  expect(offsetNotes.length).toBe(1);
  expect(offsetNotes[0].id).not.toBe(limitedNotes[0].id);
});

test('Database statistics', async () => {
  const stats = await dbManager.getStats();
  expect(stats.totalNotes).toBe(2);
  expect(stats.totalEmbeddings).toBe(2);
  expect(stats.dbSizeBytes).toBeGreaterThan(0);
});

test('Delete note', async () => {
  await dbManager.deleteNote('test-note-1');
  
  const deletedNote = await dbManager.getNoteById('test-note-1');
  expect(deletedNote).toBeNull();

  // Verify the embedding was cascade deleted
  const stats = await dbManager.getStats();
  expect(stats.totalNotes).toBe(1);
  expect(stats.totalEmbeddings).toBe(1);
});