import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { SemanticSearchService } from './search-service.js';
import { AIProviderManager } from './ai-service.js';
import type { DatabaseManager, NoteRecord } from './database.js';
import type { CortexConfig } from './config.js';

describe('Search Fallback Integration', () => {
  let mockDatabase: DatabaseManager;
  let mockAIManager: AIProviderManager;
  let searchService: SemanticSearchService;
  let mockNotes: NoteRecord[];
  let mockEmbeddings: any[];

  beforeEach(() => {
    mockNotes = [
      {
        id: 'note-1',
        title: 'Introduction to Programming',
        content: 'Programming is the process of creating computer software.',
        path: '/notes/intro.md',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        tags_json: JSON.stringify(['programming', 'intro']),
        frontmatter_json: JSON.stringify({ difficulty: 'beginner' })
      },
      {
        id: 'note-2',
        title: 'Web Development Guide',
        content: 'Web development involves creating websites and applications.',
        path: '/notes/web-dev.md',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        tags_json: JSON.stringify(['web', 'development']),
        frontmatter_json: JSON.stringify({ difficulty: 'beginner' })
      }
    ];

    mockEmbeddings = [
      {
        id: 1,
        note_id: 'note-1',
        embedding: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
        created_at: '2024-01-01T00:00:00Z'
      },
      {
        id: 2,
        note_id: 'note-2',
        embedding: new Float32Array([0.2, 0.3, 0.4, 0.5, 0.6]),
        created_at: '2024-01-02T00:00:00Z'
      }
    ];

    mockDatabase = {
      getAllNotes: mock().mockResolvedValue(mockNotes),
      getNoteById: mock().mockImplementation((id: string) => {
        return Promise.resolve(mockNotes.find(note => note.id === id) || null);
      }),
      getAllEmbeddings: mock().mockResolvedValue(mockEmbeddings),
      storeNote: mock(),
      updateNote: mock(),
      deleteNote: mock(),
      storeEmbedding: mock(),
      searchNotes: mock(),
      getStats: mock().mockResolvedValue({
        noteCount: 2,
        embeddingCount: 2,
        databaseSize: 1024,
        vectorIndexSize: 512
      })
    } as unknown as DatabaseManager;

    const mockConfig: CortexConfig = {
      aiProvider: 'openai',
      embeddingModel: 'text-embedding-ada-002',
      chatModel: 'gpt-4',
      apiKeys: {
        openai: 'test-key'
      },
      notesPath: '/test/notes',
      templatesPath: '/test/templates',
      databasePath: '/test/database.db',
      autoCommit: false,
      daemon: {
        enabled: false,
        port: 3000
      }
    };

    mockAIManager = new AIProviderManager(mockConfig);
    searchService = new SemanticSearchService(mockDatabase, mockAIManager);
  });

  test('Search falls back to fuzzy search when embeddings fail', async () => {
    // Mock AI manager to fail embedding generation
    const originalGenerateEmbedding = mockAIManager.generateEmbedding;
    mockAIManager.generateEmbedding = mock().mockRejectedValue(new Error('API unavailable'));

    const results = await searchService.searchSemantic('programming');

    // Should still return results using fallback
    expect(results.length).toBeGreaterThan(0);
    if (results[0]) {
      expect(results[0].id).toBeDefined();
      expect(results[0].title).toBeDefined();
    }

    // Restore original method
    mockAIManager.generateEmbedding = originalGenerateEmbedding;
  });

  test('Search handles both semantic and fallback failures gracefully', async () => {
    // Mock AI manager to fail embedding generation
    mockAIManager.generateEmbedding = mock().mockRejectedValue(new Error('API unavailable'));

    // Mock database to return no notes (fallback will also fail)
    mockDatabase.getAllNotes = mock().mockResolvedValue([]);

    await expect(searchService.searchSemantic('programming')).rejects.toThrow(
      'Both semantic and fallback search failed'
    );
  });

  test('Search status methods work correctly', async () => {
    const status = await searchService.getSearchStatus();
    
    expect(status).toHaveProperty('semanticAvailable');
    expect(status).toHaveProperty('fallbackAvailable');
    expect(status).toHaveProperty('fallbackStats');
    expect(typeof status.semanticAvailable).toBe('boolean');
    expect(typeof status.fallbackAvailable).toBe('boolean');
  });

  test('Fallback index rebuild works', async () => {
    // This should not throw an error
    await searchService.rebuildFallbackIndex();
  });

  test('Semantic search availability check', async () => {
    const isAvailable = await searchService.isSemanticSearchAvailable();
    
    // This will depend on whether the AI service is actually available
    expect(typeof isAvailable).toBe('boolean');
  });

  test('Fallback search availability check', () => {
    const isAvailable = searchService.isFallbackSearchAvailable();
    
    expect(typeof isAvailable).toBe('boolean');
  });

  test('Search continues to work when embeddings are empty', async () => {
    // Mock empty embeddings
    mockDatabase.getAllEmbeddings = mock().mockResolvedValue([]);

    const results = await searchService.searchSemantic('programming');

    // Should still return results using fallback
    expect(results.length).toBeGreaterThan(0);
  });

  test('Search with filters works in fallback mode', async () => {
    // Mock AI manager to fail embedding generation
    const originalGenerateEmbedding = mockAIManager.generateEmbedding;
    mockAIManager.generateEmbedding = mock().mockRejectedValue(new Error('API unavailable'));

    const results = await searchService.searchSemantic('programming', {
      filters: {
        tags: ['programming']
      }
    });

    // Should return filtered results using fallback
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result.tags).toContain('programming');
    });

    // Restore original method
    mockAIManager.generateEmbedding = originalGenerateEmbedding;
  });
});