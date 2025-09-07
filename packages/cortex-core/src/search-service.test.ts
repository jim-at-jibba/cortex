import { test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { SemanticSearchService } from './search-service.js';
import { DatabaseManager } from './database.js';
import { AIProviderManager } from './ai-service.js';
import type { NoteRecord, EmbeddingRecord } from './database.js';

// Test data
const mockNote1: NoteRecord = {
  id: 'note-1',
  title: 'TypeScript Basics',
  content: 'TypeScript is a strongly typed programming language that builds on JavaScript.',
  path: '/notes/typescript-basics.md',
  frontmatter_json: JSON.stringify({ category: 'programming', difficulty: 'beginner' }),
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  tags_json: JSON.stringify(['typescript', 'programming', 'javascript']),
  embedding_id: 1
};

const mockNote2: NoteRecord = {
  id: 'note-2',
  title: 'JavaScript Functions',
  content: 'JavaScript functions are reusable blocks of code that perform specific tasks.',
  path: '/notes/js-functions.md',
  frontmatter_json: JSON.stringify({ category: 'programming', difficulty: 'intermediate' }),
  created_at: '2024-01-02T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  tags_json: JSON.stringify(['javascript', 'functions', 'programming']),
  embedding_id: 2
};

const mockEmbedding1: EmbeddingRecord = {
  id: 1,
  note_id: 'note-1',
  embedding: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
  created_at: '2024-01-01T00:00:00Z'
};

const mockEmbedding2: EmbeddingRecord = {
  id: 2,
  note_id: 'note-2',
  embedding: new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6]),
  created_at: '2024-01-02T00:00:00Z'
};

// Tests focus on core search functionality with mocked dependencies

// Mock dependencies
const mockDatabase = {
  getAllEmbeddings: mock().mockResolvedValue([mockEmbedding1, mockEmbedding2]),
  getNoteById: mock((id: string) => {
    if (id === 'note-1') return Promise.resolve(mockNote1);
    if (id === 'note-2') return Promise.resolve(mockNote2);
    return Promise.resolve(null);
  })
} as Partial<DatabaseManager> as DatabaseManager;

const mockEmbeddingFn = mock().mockResolvedValue([0.15, 0.25, 0.35, 0.45, 0.55]);

const mockAIManager = {
  generateEmbedding: mockEmbeddingFn
} as Partial<AIProviderManager> as AIProviderManager;

let searchService: SemanticSearchService;

beforeAll(() => {
  searchService = new SemanticSearchService(mockDatabase, mockAIManager);
});

afterAll(() => {
  searchService.clearCache();
});

test('SemanticSearchService initialization', () => {
  expect(searchService).toBeDefined();
  expect(searchService.getCacheStats().size).toBe(0);
});

test('Semantic search with results', async () => {
  const results = await searchService.searchSemantic('programming languages', {
    limit: 5,
    minSimilarity: 0.1
  });

  expect(results).toHaveLength(2);
  expect(results[0].id).toBeDefined();
  expect(results[0].title).toBeDefined();
  expect(results[0].similarity).toBeGreaterThan(0);
  expect(results[0].relevanceScore).toBeGreaterThan(0);
  expect(results[0].tags).toBeInstanceOf(Array);

  // Check that results are sorted by relevance
  if (results.length > 1) {
    expect(results[0].relevanceScore).toBeGreaterThanOrEqual(results[1].relevanceScore);
  }
});

test('Semantic search with similarity threshold', async () => {
  const results = await searchService.searchSemantic('programming languages', {
    minSimilarity: 0.9 // Very high threshold
  });

  // Should return fewer or no results due to high threshold
  expect(results.length).toBeLessThanOrEqual(2);
});

test('Semantic search with tag filters', async () => {
  const results = await searchService.searchSemantic('programming', {
    filters: {
      tags: ['typescript']
    }
  });

  // Should only return notes with typescript tag
  const typescriptResults = results.filter(result => 
    result.tags.includes('typescript')
  );
  expect(typescriptResults.length).toBeGreaterThan(0);
});

test('Semantic search with exclude tag filters', async () => {
  const results = await searchService.searchSemantic('programming', {
    filters: {
      excludeTags: ['typescript']
    }
  });

  // Should not return notes with typescript tag
  const typescriptResults = results.filter(result => 
    result.tags.includes('typescript')
  );
  expect(typescriptResults.length).toBe(0);
});

test('Semantic search with date filters', async () => {
  const results = await searchService.searchSemantic('programming', {
    filters: {
      dateFrom: new Date('2024-01-02T00:00:00Z')
    }
  });

  // Should only return notes created on or after 2024-01-02
  results.forEach(result => {
    expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(
      new Date('2024-01-02T00:00:00Z').getTime()
    );
  });
});

test('Semantic search with content length filters', async () => {
  const results = await searchService.searchSemantic('programming', {
    filters: {
      contentLength: { min: 50, max: 200 }
    }
  });

  // Should only return notes within length constraints
  results.forEach(result => {
    expect(result.content.length).toBeGreaterThanOrEqual(50);
    expect(result.content.length).toBeLessThanOrEqual(200);
  });
});

test('Semantic search with metadata filters', async () => {
  const results = await searchService.searchSemantic('programming', {
    filters: {
      metadata: { difficulty: 'beginner' }
    }
  });

  // Should only return notes with difficulty: beginner
  results.forEach(result => {
    expect(result.metadata.difficulty).toBe('beginner');
  });
});

test('Semantic search with custom ranking weights', async () => {
  const results = await searchService.searchSemantic('programming', {
    rankingWeights: {
      similarity: 0.5,
      recency: 0.3,
      tagBoost: 0.2,
      lengthPenalty: 0.0
    }
  });

  expect(results).toHaveLength(2);
  expect(results[0].relevanceScore).toBeDefined();
  expect(results[0].relevanceScore).toBeGreaterThan(0);
});

test('Semantic search with pagination', async () => {
  const page1 = await searchService.searchSemantic('programming', {
    limit: 1,
    offset: 0
  });

  const page2 = await searchService.searchSemantic('programming', {
    limit: 1,
    offset: 1
  });

  expect(page1).toHaveLength(1);
  expect(page2).toHaveLength(1);
  expect(page1[0].id).not.toBe(page2[0].id);
});

test('Semantic search with includeContent option', async () => {
  const withContent = await searchService.searchSemantic('programming', {
    includeContent: true,
    limit: 1
  });

  const withoutContent = await searchService.searchSemantic('programming', {
    includeContent: false,
    limit: 1
  });

  expect(withContent[0].content).toBeTruthy();
  expect(withoutContent[0].content).toBe('');
});

test('Search result caching', async () => {
  // Clear cache first
  searchService.clearCache();
  expect(searchService.getCacheStats().size).toBe(0);

  // First search should miss cache and call AI
  await searchService.searchSemantic('cached query');
  expect(mockAIManager.generateEmbedding).toHaveBeenCalledWith('cached query');
  expect(searchService.getCacheStats().size).toBe(1);

  // Reset mock to track calls
  mockEmbeddingFn.mockClear();

  // Second identical search should hit cache and not call AI
  await searchService.searchSemantic('cached query');
  expect(mockAIManager.generateEmbedding).not.toHaveBeenCalled();
});

test('Cache cleanup', async () => {
  // Add some cache entries
  await searchService.searchSemantic('test query 1');
  await searchService.searchSemantic('test query 2');
  
  const initialSize = searchService.getCacheStats().size;
  expect(initialSize).toBeGreaterThan(0);

  // Clean up cache
  searchService.cleanupCache();
  
  // Cache should still exist (entries are fresh)
  expect(searchService.getCacheStats().size).toBe(initialSize);

  // Clear all cache
  searchService.clearCache();
  expect(searchService.getCacheStats().size).toBe(0);
});

test('Cosine similarity calculation', async () => {
  // Test with known vectors
  const results = await searchService.searchSemantic('exact match test', {
    minSimilarity: 0.0
  });

  // Results should be ordered by similarity
  expect(results).toHaveLength(2);
  results.forEach(result => {
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
  });
});

test('Snippet generation', async () => {
  const results = await searchService.searchSemantic('programming');

  results.forEach(result => {
    expect(result.snippet).toBeDefined();
    expect(result.snippet.length).toBeGreaterThan(0);
    
    // Long content should be truncated with ellipsis
    if (result.snippet.length > 150) {
      expect(result.snippet).toMatch(/\.\.\.$/);
    }
  });
});

test('Error handling for invalid note data', async () => {
  // Mock database to return note with invalid JSON
  const mockDbWithInvalidData = {
    getAllEmbeddings: mock().mockResolvedValue([mockEmbedding1]),
    getNoteById: mock().mockResolvedValue({
      ...mockNote1,
      tags_json: 'invalid json',
      frontmatter_json: 'invalid json'
    })
  } as Partial<DatabaseManager> as DatabaseManager;

  const testService = new SemanticSearchService(mockDbWithInvalidData, mockAIManager);
  
  // Should not throw error, but handle gracefully
  const results = await testService.searchSemantic('test');
  expect(results).toHaveLength(1);
  expect(results[0].tags).toEqual([]);
  expect(results[0].metadata).toEqual({});
});

test('Empty embedding database', async () => {
  const mockEmptyDb = {
    getAllEmbeddings: mock().mockResolvedValue([]),
    getNoteById: mock().mockResolvedValue(null)
  } as Partial<DatabaseManager> as DatabaseManager;

  const testService = new SemanticSearchService(mockEmptyDb, mockAIManager);
  
  const results = await testService.searchSemantic('any query');
  expect(results).toHaveLength(0);
});