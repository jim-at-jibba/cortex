import type { DatabaseManager, NoteRecord } from './database.js';
import Fuse from 'fuse.js';
import type { SearchResult, SearchOptions, SearchFilters } from './search-service.js';

export interface FallbackSearchConfig {
  threshold?: number;
  distance?: number;
  minMatchCharLength?: number;
  keys?: Array<{ name: string; weight?: number }>;
  includeScore?: boolean;
  includeMatches?: boolean;
}

export class FallbackSearchService {
  private fuse: Fuse<NoteRecord> | null = null;
  private lastDatabaseUpdate: number = 0;
  private readonly defaultConfig: FallbackSearchConfig = {
    threshold: 0.4, // Lower threshold = more strict matching
    distance: 100,
    minMatchCharLength: 2,
    keys: [
      { name: 'title', weight: 0.4 },
      { name: 'content', weight: 0.3 },
      { name: 'path', weight: 0.2 },
      { name: 'tags_json', weight: 0.1 }
    ],
    includeScore: true,
    includeMatches: true
  };

  constructor(
    private database: DatabaseManager,
    private config: FallbackSearchConfig = {}
  ) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Perform fallback search using fuzzy matching
   */
  async searchFallback(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      offset = 0,
      includeContent = false,
      filters
    } = options;

    console.log(`🔍 Performing fallback search for: "${query}"`);

    try {
      // Get all notes from database
      const allNotes = await this.database.getAllNotes();
      
      if (allNotes.length === 0) {
        console.log('⚠️  No notes found in database');
        return [];
      }

      // Update Fuse index if needed
      await this.updateFuseIndex(allNotes);

      if (!this.fuse) {
        throw new Error('Failed to initialize search index');
      }

      // Perform fuzzy search
      const fuseResults = this.fuse.search(query, {
        limit: limit + offset // Get more results to account for pagination
      });

      // Convert Fuse results to SearchResult format
      const searchResults: SearchResult[] = [];
      
      for (const fuseResult of fuseResults.slice(offset)) {
        const note = fuseResult.item;
        
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

        // Calculate relevance score based on Fuse score
        const fuseScore = fuseResult.score || 1;
        const relevanceScore = Math.max(0, 1 - fuseScore); // Invert score (lower Fuse score = better match)

        // Generate highlights from matches
        const highlights = this.generateHighlights(fuseResult.matches || []);

        const searchResult: SearchResult = {
          id: note.id,
          title: note.title,
          content: includeContent ? note.content : '',
          path: note.path,
          similarity: relevanceScore, // Use relevanceScore as similarity for fallback
          relevanceScore,
          tags,
          createdAt: new Date(note.created_at),
          updatedAt: new Date(note.updated_at),
          metadata,
          snippet: this.generateSnippet(note.content, query, 150),
          highlights
        };

        searchResults.push(searchResult);

        // Stop if we've reached the limit
        if (searchResults.length >= limit) {
          break;
        }
      }

      console.log(`✅ Fallback search found ${searchResults.length} results`);
      return searchResults;

    } catch (error) {
      console.error('❌ Fallback search failed:', error);
      throw new Error(`Fallback search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update or create Fuse search index
   */
  private async updateFuseIndex(notes: NoteRecord[]): Promise<void> {
    const now = Date.now();
    
    // Check if we need to update the index
    if (this.fuse && (now - this.lastDatabaseUpdate) < 60000) { // 1 minute cache
      return;
    }

    try {
      console.log('🔄 Updating fallback search index...');
      
      this.fuse = new Fuse(notes, this.config);
      this.lastDatabaseUpdate = now;
      
      console.log(`✅ Fallback search index updated with ${notes.length} notes`);
    } catch (error) {
      console.error('❌ Failed to update fallback search index:', error);
      throw error;
    }
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
   * Generate highlights from Fuse matches
   */
  private generateHighlights(matches: readonly any[]): string[] {
    const highlights: string[] = [];
    
    for (const match of matches) {
      if (match.indices) {
        for (const [start, end] of match.indices) {
          // Extract the matched text (simplified - in practice you'd want to get the actual text)
          highlights.push(`${match.key}:${start}-${end}`);
        }
      }
    }
    
    return highlights;
  }

  /**
   * Generate a snippet from content with query highlighting
   */
  private generateSnippet(content: string, query: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    // Simple approach: find the first occurrence of query terms and create snippet around it
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    
    for (const term of queryTerms) {
      const termIndex = content.toLowerCase().indexOf(term);
      if (termIndex !== -1) {
        // Create snippet around the found term
        const start = Math.max(0, termIndex - maxLength / 2);
        const end = Math.min(content.length, start + maxLength);
        let snippet = content.substring(start, end);
        
        // Add ellipsis if we're not at the beginning/end
        if (start > 0) snippet = '...' + snippet;
        if (end < content.length) snippet = snippet + '...';
        
        return snippet;
      }
    }

    // Fallback to simple truncation
    const truncated = content.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Force rebuild of the search index
   */
  async rebuildIndex(): Promise<void> {
    const allNotes = await this.database.getAllNotes();
    this.lastDatabaseUpdate = 0; // Force update
    await this.updateFuseIndex(allNotes);
  }

  /**
   * Get index statistics
   */
  getIndexStats(): { isReady: boolean; lastUpdate: number; noteCount?: number } {
    return {
      isReady: this.fuse !== null,
      lastUpdate: this.lastDatabaseUpdate,
      noteCount: undefined // Fuse.js doesn't provide direct access to collection size
    };
  }

  /**
   * Check if fallback search is available
   */
  isAvailable(): boolean {
    return this.fuse !== null;
  }
}