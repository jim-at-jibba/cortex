import type { DatabaseManager, NoteRecord, EmbeddingRecord } from './database.js';
import { AIProviderManager } from './ai-service.js';
import { RankingService, type HybridRankingConfig } from './ranking-service.js';
import { FallbackSearchService } from './fallback-search-service.js';

export interface SearchResult {
  id: string;
  title: string;
  content: string;
  path: string;
  similarity: number;
  relevanceScore: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>;
  snippet: string;
  highlights: string[];
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  minSimilarity?: number;
  includeContent?: boolean;
  filters?: SearchFilters;
  rankingWeights?: RankingWeights;
}

export interface SearchFilters {
  tags?: string[];
  excludeTags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  metadata?: Record<string, any>;
  contentLength?: { min?: number; max?: number };
}

export interface RankingWeights {
  similarity?: number;
  recency?: number;
  tagBoost?: number;
  lengthPenalty?: number;
  metadataBoost?: Record<string, number>;
}

export interface VectorSearchCache {
  [queryHash: string]: {
    results: SearchResult[];
    timestamp: number;
    query: string;
    options: SearchOptions;
  };
}

export class SemanticSearchService {
  private searchCache: VectorSearchCache = {};
  private readonly cacheExpiry = 5 * 60 * 1000; // 5 minutes
  private rankingService: RankingService;
  private fallbackSearchService: FallbackSearchService;
  private defaultRankingWeights: RankingWeights = {
    similarity: 0.7,
    recency: 0.15,
    tagBoost: 0.1,
    lengthPenalty: 0.05
  };

  constructor(
    private database: DatabaseManager,
    private aiManager: AIProviderManager,
    rankingConfig?: Partial<HybridRankingConfig>
  ) {
    this.rankingService = new RankingService(rankingConfig);
    this.fallbackSearchService = new FallbackSearchService(database);
  }

  /**
   * Perform semantic search using vector similarity
   */
  async searchSemantic(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      offset = 0,
      minSimilarity = 0.3,
      includeContent = false,
      filters,
      rankingWeights
    } = options;

    // Check cache first
    const cacheKey = this.generateCacheKey(query, options);
    const cachedResult = this.getFromCache(cacheKey);
    if (cachedResult) {
      return this.paginateResults(cachedResult, offset, limit);
    }

    try {
      // Generate embedding for the search query
      console.log(`🔍 Generating embedding for query: "${query}"`);
      const queryEmbedding = await this.aiManager.generateEmbedding(query);
      
      // Get all embeddings from database
      const allEmbeddings = await this.database.getAllEmbeddings();
      
      if (allEmbeddings.length === 0) {
        console.log('⚠️  No embeddings found in database');
        return [];
      }

      // Calculate similarities
      const similarities = await this.calculateSimilarities(
        queryEmbedding,
        allEmbeddings,
        minSimilarity
      );

      // Get note details and create search results
      const searchResults = await this.buildSearchResults(
        similarities,
        includeContent,
        filters
      );

      // Apply ranking algorithm - use enhanced hybrid ranking
      const rankedResults = this.rankingService.rankResults(searchResults, query);
      
      // Apply legacy ranking for additional customization if weights provided
      if (rankingWeights && rankingWeights !== this.defaultRankingWeights) {
        const legacyRanked = this.rankResults(
          rankedResults,
          query,
          rankingWeights
        );
        // Combine scores: 70% hybrid + 30% legacy for smooth transition
        const finalResults = legacyRanked.map((result, index) => ({
          ...result,
          relevanceScore: 0.7 * (rankedResults[index]?.relevanceScore || 0) + 0.3 * result.relevanceScore
        }));
        this.addToCache(cacheKey, finalResults, query, options);
        return this.paginateResults(finalResults, offset, limit);
      }

      // Cache results
      this.addToCache(cacheKey, rankedResults, query, options);

      // Return paginated results
      return this.paginateResults(rankedResults, offset, limit);

    } catch (error) {
      console.error('❌ Semantic search failed:', error);
      console.log('🔄 Attempting fallback search...');
      
      try {
        // Attempt fallback search
        const fallbackResults = await this.fallbackSearchService.searchFallback(query, options);
        console.log(`✅ Fallback search completed with ${fallbackResults.length} results`);
        
        // Add notification about fallback mode
        if (fallbackResults.length > 0) {
          console.log('⚠️  Running in fallback mode - using local fuzzy search instead of embeddings');
        }
        
        return fallbackResults;
      } catch (fallbackError) {
        console.error('❌ Fallback search also failed:', fallbackError);
        throw new Error(`Both semantic and fallback search failed. Semantic error: ${error instanceof Error ? error.message : 'Unknown error'}. Fallback error: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Calculate cosine similarity between query embedding and all stored embeddings
   */
  private async calculateSimilarities(
    queryEmbedding: number[],
    allEmbeddings: EmbeddingRecord[],
    minSimilarity: number
  ): Promise<Array<{ noteId: string; similarity: number; embeddingId: number }>> {
    const similarities: Array<{ noteId: string; similarity: number; embeddingId: number }> = [];

    for (const embedding of allEmbeddings) {
      try {
        // Convert Float32Array to number[]
        const embeddingArray = Array.from(embedding.embedding);
        const similarity = this.cosineSimilarity(queryEmbedding, embeddingArray);
        
        if (similarity >= minSimilarity) {
          similarities.push({
            noteId: embedding.note_id,
            similarity,
            embeddingId: embedding.id
          });
        }
      } catch (error) {
        console.warn(`⚠️  Failed to calculate similarity for embedding ${embedding.id}:`, error);
        continue;
      }
    }

    // Sort by similarity descending
    return similarities.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] || 0;
      const bVal = b[i] || 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  /**
   * Build SearchResult objects from similarity calculations
   */
  private async buildSearchResults(
    similarities: Array<{ noteId: string; similarity: number; embeddingId: number }>,
    includeContent: boolean,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const { noteId, similarity } of similarities) {
      try {
        const note = await this.database.getNoteById(noteId);
        if (!note) {
          console.warn(`⚠️  Note not found: ${noteId}`);
          continue;
        }

        // Apply filters
        if (filters && !this.passesFilters(note, filters)) {
          continue;
        }

        // Parse JSON fields safely
        let tags: string[] = [];
        let metadata: Record<string, any> = {};
        
        try {
          tags = note.tags_json ? JSON.parse(note.tags_json) : [];
        } catch (error) {
          console.warn(`Failed to parse tags for note ${note.id}:`, error);
        }
        
        try {
          metadata = note.frontmatter_json ? JSON.parse(note.frontmatter_json) : {};
        } catch (error) {
          console.warn(`Failed to parse frontmatter for note ${note.id}:`, error);
        }

        // Create search result
        const searchResult: SearchResult = {
          id: note.id,
          title: note.title,
          content: includeContent ? note.content : '',
          path: note.path,
          similarity,
          relevanceScore: similarity, // Will be updated by ranking algorithm
          tags,
          createdAt: new Date(note.created_at),
          updatedAt: new Date(note.updated_at),
          metadata,
          snippet: this.generateSnippet(note.content, 150),
          highlights: []
        };

        results.push(searchResult);
      } catch (error) {
        console.warn(`⚠️  Failed to build search result for note ${noteId}:`, error);
        continue;
      }
    }

    return results;
  }

  /**
   * Check if a note passes the specified filters
   */
  private passesFilters(note: NoteRecord, filters: SearchFilters): boolean {
    // Parse JSON fields
    const noteTags = note.tags_json ? JSON.parse(note.tags_json) : [];
    const noteMetadata = note.frontmatter_json ? JSON.parse(note.frontmatter_json) : {};
    const noteCreatedAt = new Date(note.created_at);

    // Tag filters
    if (filters.tags && filters.tags.length > 0) {
      const hasRequiredTags = filters.tags.some(tag => noteTags.includes(tag));
      if (!hasRequiredTags) return false;
    }

    // Exclude tag filters
    if (filters.excludeTags && filters.excludeTags.length > 0) {
      const hasExcludedTags = filters.excludeTags.some(tag => noteTags.includes(tag));
      if (hasExcludedTags) return false;
    }

    // Date filters
    if (filters.dateFrom && noteCreatedAt < filters.dateFrom) {
      return false;
    }
    if (filters.dateTo && noteCreatedAt > filters.dateTo) {
      return false;
    }

    // Content length filters
    if (filters.contentLength) {
      const contentLength = note.content.length;
      if (filters.contentLength.min && contentLength < filters.contentLength.min) {
        return false;
      }
      if (filters.contentLength.max && contentLength > filters.contentLength.max) {
        return false;
      }
    }

    // Metadata filters
    if (filters.metadata) {
      for (const [key, value] of Object.entries(filters.metadata)) {
        if (noteMetadata[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Apply ranking algorithm to search results
   */
  private rankResults(
    results: SearchResult[],
    _query: string,
    weights: RankingWeights
  ): SearchResult[] {
    const now = Date.now();
    
    return results.map(result => {
      let score = 0;

      // Semantic similarity score
      if (weights.similarity !== undefined) {
        score += result.similarity * weights.similarity;
      }

      // Recency boost
      if (weights.recency !== undefined) {
        const ageInDays = (now - result.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-ageInDays / 30); // Decay over 30 days
        score += recencyScore * weights.recency;
      }

      // Tag boost
      if (weights.tagBoost !== undefined && result.tags && result.tags.length > 0) {
        const tagScore = Math.min(result.tags.length / 5, 1); // Max boost for 5+ tags
        score += tagScore * weights.tagBoost;
      }

      // Length penalty (prefer concise, relevant content)
      if (weights.lengthPenalty !== undefined) {
        const lengthScore = Math.exp(-result.content.length / 5000); // Penalty for very long content
        score -= (1 - lengthScore) * weights.lengthPenalty;
      }

      // Metadata boost
      if (weights.metadataBoost && result.metadata) {
        for (const [key, boost] of Object.entries(weights.metadataBoost)) {
          if (result.metadata[key]) {
            score += boost;
          }
        }
      }

      return {
        ...result,
        relevanceScore: Math.max(0, Math.min(1, score)) // Clamp between 0 and 1
      };
    }).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Generate a snippet from content
   */
  private generateSnippet(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    // Try to break at word boundaries
    const truncated = content.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Cache management
   */
  private generateCacheKey(query: string, options: SearchOptions): string {
    const optionsStr = JSON.stringify({
      ...options,
      // Exclude timestamp-sensitive options from cache key
    });
    return `${query}:${optionsStr}`;
  }

  private getFromCache(key: string): SearchResult[] | null {
    const cached = this.searchCache[key];
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.cacheExpiry;
    if (isExpired) {
      delete this.searchCache[key];
      return null;
    }

    return cached.results;
  }

  private addToCache(key: string, results: SearchResult[], query: string, options: SearchOptions): void {
    this.searchCache[key] = {
      results,
      timestamp: Date.now(),
      query,
      options
    };
  }

  private paginateResults(results: SearchResult[], offset: number, limit: number): SearchResult[] {
    return results.slice(offset, offset + limit);
  }

  /**
   * Clear search cache
   */
  public clearCache(): void {
    this.searchCache = {};
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; entries: string[] } {
    return {
      size: Object.keys(this.searchCache).length,
      entries: Object.keys(this.searchCache)
    };
  }

  /**
   * Cleanup expired cache entries
   */
  public cleanupCache(): void {
    const now = Date.now();
    Object.keys(this.searchCache).forEach(key => {
      const entry = this.searchCache[key];
      if (entry && now - entry.timestamp > this.cacheExpiry) {
        delete this.searchCache[key];
      }
    });
  }

  /**
   * Check if semantic search is available (embeddings working)
   */
  async isSemanticSearchAvailable(): Promise<boolean> {
    try {
      // Try to generate a test embedding
      await this.aiManager.generateEmbedding('test');
      return true;
    } catch (error) {
      console.warn('Semantic search not available:', error);
      return false;
    }
  }

  /**
   * Check if fallback search is available
   */
  isFallbackSearchAvailable(): boolean {
    return this.fallbackSearchService.isAvailable();
  }

  /**
   * Get search service status
   */
  async getSearchStatus(): Promise<{
    semanticAvailable: boolean;
    fallbackAvailable: boolean;
    fallbackStats: { isReady: boolean; lastUpdate: number; noteCount?: number };
  }> {
    return {
      semanticAvailable: await this.isSemanticSearchAvailable(),
      fallbackAvailable: this.isFallbackSearchAvailable(),
      fallbackStats: this.fallbackSearchService.getIndexStats()
    };
  }

  /**
   * Force rebuild of fallback search index
   */
  async rebuildFallbackIndex(): Promise<void> {
    await this.fallbackSearchService.rebuildIndex();
  }
}