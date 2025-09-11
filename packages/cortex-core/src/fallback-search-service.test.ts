import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { FallbackSearchService } from './fallback-search-service.js';
import type { DatabaseManager, NoteRecord } from './database.js';

describe('FallbackSearchService', () => {
  let mockDatabase: DatabaseManager;
  let fallbackSearchService: FallbackSearchService;
  let mockNotes: NoteRecord[];

  beforeEach(() => {
    mockNotes = [
      {
        id: 'note-1',
        title: 'Introduction to Programming',
        content: 'Programming is the process of creating computer software using programming languages.',
        path: '/notes/intro.md',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        tags_json: JSON.stringify(['programming', 'intro']),
        frontmatter_json: JSON.stringify({ difficulty: 'beginner' })
      },
      {
        id: 'note-2',
        title: 'Advanced JavaScript Concepts',
        content: 'JavaScript is a versatile programming language used for web development.',
        path: '/notes/javascript.md',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        tags_json: JSON.stringify(['javascript', 'advanced']),
        frontmatter_json: JSON.stringify({ difficulty: 'advanced' })
      },
      {
        id: 'note-3',
        title: 'Web Development Basics',
        content: 'Web development involves creating websites and web applications.',
        path: '/notes/web-dev.md',
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
        tags_json: JSON.stringify(['web', 'development']),
        frontmatter_json: JSON.stringify({ difficulty: 'beginner' })
      }
    ];

    mockDatabase = {
      getAllNotes: mock().mockResolvedValue(mockNotes),
      getNoteById: mock().mockImplementation((id: string) => {
        return Promise.resolve(mockNotes.find(note => note.id === id) || null);
      }),
      getAllEmbeddings: mock().mockResolvedValue([]),
      storeNote: mock(),
      updateNote: mock(),
      deleteNote: mock(),
      storeEmbedding: mock(),
      searchNotes: mock(),
      getStats: mock().mockResolvedValue({
        noteCount: 3,
        embeddingCount: 0,
        databaseSize: 1024,
        vectorIndexSize: 512
      })
    } as unknown as DatabaseManager;

    fallbackSearchService = new FallbackSearchService(mockDatabase);
  });

  test('FallbackSearchService initialization', () => {
    expect(fallbackSearchService).toBeDefined();
    expect(fallbackSearchService.isAvailable()).toBe(false); // Index not built yet
  });

  test('Fallback search with results', async () => {
    const results = await fallbackSearchService.searchFallback('programming');

    expect(results).toHaveLength(2); // Should find notes about programming and JavaScript
    if (results[0]) {
      expect(results[0].id).toBeDefined();
      expect(results[0].title).toBeDefined();
      expect(results[0].similarity).toBeGreaterThan(0);
      expect(results[0].relevanceScore).toBeGreaterThan(0);
      expect(results[0].tags).toBeInstanceOf(Array);
    }
  });

  test('Fallback search with no results', async () => {
    const results = await fallbackSearchService.searchFallback('nonexistent topic');

    expect(results).toHaveLength(0);
  });

  test('Fallback search with tag filters', async () => {
    const results = await fallbackSearchService.searchFallback('programming', {
      filters: {
        tags: ['programming']
      }
    });

    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result.tags).toContain('programming');
    });
  });

  test('Fallback search with exclude tag filters', async () => {
    const results = await fallbackSearchService.searchFallback('programming', {
      filters: {
        excludeTags: ['advanced']
      }
    });

    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result.tags).not.toContain('advanced');
    });
  });

  test('Fallback search with date filters', async () => {
    const results = await fallbackSearchService.searchFallback('programming', {
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

  test('Fallback search with content length filters', async () => {
    const results = await fallbackSearchService.searchFallback('programming', {
      includeContent: true,
      filters: {
        contentLength: { min: 50, max: 200 }
      }
    });

    // Should only return notes within length constraints
    if (results[0]) {
      expect(results[0].content.length).toBeGreaterThanOrEqual(50);
      expect(results[0].content.length).toBeLessThanOrEqual(200);
    }
  });

  test('Fallback search with metadata filters', async () => {
    const results = await fallbackSearchService.searchFallback('programming', {
      filters: {
        metadata: { difficulty: 'beginner' }
      }
    });

    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result.metadata.difficulty).toBe('beginner');
    });
  });

  test('Fallback search with pagination', async () => {
    const page1 = await fallbackSearchService.searchFallback('programming', {
      limit: 1,
      offset: 0
    });

    const page2 = await fallbackSearchService.searchFallback('programming', {
      limit: 1,
      offset: 1
    });

    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    if (page1[0] && page2[0]) {
      expect(page1[0].id).not.toBe(page2[0].id);
    }
  });

  test('Fallback search with includeContent option', async () => {
    const withContent = await fallbackSearchService.searchFallback('programming', {
      includeContent: true,
      limit: 1
    });

    const withoutContent = await fallbackSearchService.searchFallback('programming', {
      includeContent: false,
      limit: 1
    });

    if (withContent[0] && withoutContent[0]) {
      expect(withContent[0].content).toBeTruthy();
      expect(withoutContent[0].content).toBe('');
    }
  });

  test('Index rebuild', async () => {
    await fallbackSearchService.rebuildIndex();
    
    const stats = fallbackSearchService.getIndexStats();
    expect(stats.isReady).toBe(true);
    expect(stats.lastUpdate).toBeGreaterThan(0);
  });

  test('Index statistics', async () => {
    const stats = fallbackSearchService.getIndexStats();
    
    expect(stats.isReady).toBeDefined();
    expect(stats.lastUpdate).toBeDefined();
  });

  test('Empty database handling', async () => {
    mockDatabase.getAllNotes = mock().mockResolvedValue([]);
    
    const results = await fallbackSearchService.searchFallback('programming');
    expect(results).toHaveLength(0);
  });

  test('Invalid JSON data handling', async () => {
    const notesWithInvalidJson = [
      {
        ...mockNotes[0],
        tags_json: 'invalid json',
        frontmatter_json: 'invalid json'
      }
    ];
    
    mockDatabase.getAllNotes = mock().mockResolvedValue(notesWithInvalidJson);
    
    // Should not throw error, but handle gracefully
    const results = await fallbackSearchService.searchFallback('test');
    expect(results).toHaveLength(1);
    if (results[0]) {
      expect(results[0].tags).toEqual([]);
      expect(results[0].metadata).toEqual({});
    }
  });
});