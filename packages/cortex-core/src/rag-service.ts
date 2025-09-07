import type { SearchResult } from './search-service.js';
import { SemanticSearchService } from './search-service.js';

export interface RAGContext {
  id: string;
  content: string;
  source: ContextSource;
  relevanceScore: number;
  tokenCount: number;
  chunkIndex: number;
  metadata: Record<string, any>;
}

export interface ContextSource {
  noteId: string;
  title: string;
  path: string;
  tags: string[];
  createdAt: Date;
  snippet: string;
}

export interface ChunkingStrategy {
  maxTokens: number;        // Maximum tokens per chunk
  overlapTokens: number;    // Overlap between consecutive chunks
  preserveStructure: boolean; // Try to preserve markdown structure
  semanticBoundaries: boolean; // Split at semantic boundaries (sentences, paragraphs)
}

export interface RAGRetrievalConfig {
  maxContexts: number;       // Maximum number of contexts to retrieve
  maxTokens: number;         // Maximum total tokens for all contexts
  minRelevanceScore: number; // Minimum relevance score threshold
  diversityWeight: number;   // Weight for diversity vs relevance trade-off
  chunkingStrategy: ChunkingStrategy;
  deduplicationThreshold: number; // Similarity threshold for deduplication
}

export interface RAGQuery {
  query: string;
  contextHints?: string[];   // Additional context hints
  requiredTags?: string[];   // Must include notes with these tags
  excludeTags?: string[];    // Must exclude notes with these tags
  timeRange?: {
    from?: Date;
    to?: Date;
  };
  maxResults?: number;
}

export interface RAGRetrievalResult {
  contexts: RAGContext[];
  totalTokens: number;
  searchResults: SearchResult[];
  query: RAGQuery;
  retrievalStats: {
    totalCandidates: number;
    filteredCandidates: number;
    chunksGenerated: number;
    duplicatesRemoved: number;
    finalContexts: number;
  };
}

export class RAGContextService {
  private defaultConfig: RAGRetrievalConfig = {
    maxContexts: 8,
    maxTokens: 4000, // Conservative limit for most models
    minRelevanceScore: 0.3,
    diversityWeight: 0.2,
    chunkingStrategy: {
      maxTokens: 500,
      overlapTokens: 50,
      preserveStructure: true,
      semanticBoundaries: true
    },
    deduplicationThreshold: 0.85
  };

  constructor(
    private searchService: SemanticSearchService,
    private config: Partial<RAGRetrievalConfig> = {}
  ) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Retrieve relevant contexts for a RAG query
   */
  async retrieveContexts(query: RAGQuery): Promise<RAGRetrievalResult> {
    const config = this.config as RAGRetrievalConfig;

    // Step 1: Perform semantic search to get relevant notes
    const searchResults = await this.performSemanticSearch(query, config);
    
    const stats = {
      totalCandidates: searchResults.length,
      filteredCandidates: 0,
      chunksGenerated: 0,
      duplicatesRemoved: 0,
      finalContexts: 0
    };

    // Step 2: Filter results by relevance score
    const filteredResults = searchResults.filter(result => 
      result.relevanceScore >= config.minRelevanceScore
    );
    stats.filteredCandidates = filteredResults.length;

    if (filteredResults.length === 0) {
      return {
        contexts: [],
        totalTokens: 0,
        searchResults,
        query,
        retrievalStats: stats
      };
    }

    // Step 3: Chunk the content of relevant notes
    const chunkedContexts = await this.chunkContent(filteredResults, config.chunkingStrategy);
    stats.chunksGenerated = chunkedContexts.length;

    // Step 4: Remove duplicate/similar chunks
    const uniqueContexts = await this.deduplicateContexts(chunkedContexts, config.deduplicationThreshold);
    stats.duplicatesRemoved = chunkedContexts.length - uniqueContexts.length;

    // Step 5: Select best contexts within token limits
    const selectedContexts = this.selectBestContexts(
      uniqueContexts,
      config.maxContexts,
      config.maxTokens,
      config.diversityWeight
    );
    stats.finalContexts = selectedContexts.length;

    const totalTokens = selectedContexts.reduce((sum, ctx) => sum + ctx.tokenCount, 0);

    return {
      contexts: selectedContexts,
      totalTokens,
      searchResults,
      query,
      retrievalStats: stats
    };
  }

  /**
   * Generate context string for AI prompt
   */
  generateContextPrompt(contexts: RAGContext[]): string {
    if (contexts.length === 0) {
      return 'No relevant context found.';
    }

    let prompt = 'Based on the following context from your notes:\n\n';
    
    contexts.forEach((context, index) => {
      prompt += `**Context ${index + 1}** (from "${context.source.title}"):\n`;
      prompt += `${context.content}\n\n`;
    });

    prompt += 'Please provide a helpful response based on this context. ';
    prompt += 'Include citations by referencing the note titles when appropriate.';

    return prompt;
  }

  /**
   * Generate citation information for contexts
   */
  generateCitations(contexts: RAGContext[]): Array<{
    id: string;
    title: string;
    path: string;
    snippet: string;
    relevanceScore: number;
  }> {
    return contexts.map(context => ({
      id: context.source.noteId,
      title: context.source.title,
      path: context.source.path,
      snippet: context.source.snippet,
      relevanceScore: context.relevanceScore
    }));
  }

  /**
   * Perform semantic search with query expansion
   */
  private async performSemanticSearch(query: RAGQuery, config: RAGRetrievalConfig): Promise<SearchResult[]> {
    // Expand query with context hints
    let expandedQuery = query.query;
    if (query.contextHints && query.contextHints.length > 0) {
      expandedQuery += ' ' + query.contextHints.join(' ');
    }

    // Configure search options
    const searchOptions = {
      limit: Math.max(config.maxContexts * 3, 20), // Get more candidates for better selection
      minSimilarity: config.minRelevanceScore * 0.8, // Slightly lower threshold for initial search
      includeContent: true,
      filters: {
        tags: query.requiredTags,
        excludeTags: query.excludeTags,
        dateFrom: query.timeRange?.from,
        dateTo: query.timeRange?.to
      }
    };

    return await this.searchService.searchSemantic(expandedQuery, searchOptions);
  }

  /**
   * Chunk content into manageable pieces
   */
  private async chunkContent(searchResults: SearchResult[], strategy: ChunkingStrategy): Promise<RAGContext[]> {
    const contexts: RAGContext[] = [];
    
    for (const result of searchResults) {
      const chunks = await this.chunkText(result.content, strategy);
      
      chunks.forEach((chunk, index) => {
        contexts.push({
          id: `${result.id}-chunk-${index}`,
          content: chunk.text,
          source: {
            noteId: result.id,
            title: result.title,
            path: result.path,
            tags: result.tags,
            createdAt: result.createdAt,
            snippet: result.snippet
          },
          relevanceScore: result.relevanceScore,
          tokenCount: chunk.tokenCount,
          chunkIndex: index,
          metadata: {
            ...result.metadata,
            originalLength: result.content.length,
            totalChunks: chunks.length
          }
        });
      });
    }

    return contexts;
  }

  /**
   * Chunk text according to strategy
   */
  private async chunkText(text: string, strategy: ChunkingStrategy): Promise<Array<{ text: string; tokenCount: number }>> {
    if (!text.trim()) {
      return [];
    }

    const chunks: Array<{ text: string; tokenCount: number }> = [];
    
    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);

    if (strategy.preserveStructure && strategy.semanticBoundaries) {
      // Try to split at semantic boundaries while preserving structure
      const sections = this.splitAtSemanticBoundaries(text);
      
      let currentChunk = '';
      let currentTokens = 0;

      for (const section of sections) {
        const sectionTokens = estimateTokens(section);
        
        // If adding this section would exceed max tokens, save current chunk and start new one
        if (currentTokens + sectionTokens > strategy.maxTokens && currentChunk.trim()) {
          chunks.push({
            text: currentChunk.trim(),
            tokenCount: currentTokens
          });
          
          // Start new chunk with overlap if configured
          if (strategy.overlapTokens > 0) {
            const overlapText = this.extractOverlapText(currentChunk, strategy.overlapTokens);
            currentChunk = overlapText + section;
            currentTokens = estimateTokens(currentChunk);
          } else {
            currentChunk = section;
            currentTokens = sectionTokens;
          }
        } else {
          currentChunk += section;
          currentTokens += sectionTokens;
        }
      }

      // Add final chunk
      if (currentChunk.trim()) {
        chunks.push({
          text: currentChunk.trim(),
          tokenCount: currentTokens
        });
      }
    } else {
      // Simple sliding window chunking
      const maxChars = strategy.maxTokens * 4; // Rough conversion
      const overlapChars = strategy.overlapTokens * 4;
      
      for (let i = 0; i < text.length; i += maxChars - overlapChars) {
        const chunkText = text.slice(i, i + maxChars);
        if (chunkText.trim()) {
          chunks.push({
            text: chunkText,
            tokenCount: estimateTokens(chunkText)
          });
        }
      }
    }

    return chunks.length > 0 ? chunks : [{ text: text, tokenCount: estimateTokens(text) }];
  }

  /**
   * Split text at semantic boundaries (paragraphs, sentences)
   */
  private splitAtSemanticBoundaries(text: string): string[] {
    // Split by double newlines (paragraphs) first
    const paragraphs = text.split(/\n\s*\n/);
    const sections: string[] = [];

    for (const paragraph of paragraphs) {
      if (paragraph.trim()) {
        // Split long paragraphs by sentences
        if (paragraph.length > 1000) {
          const sentences = paragraph.split(/(?<=[.!?])\s+/);
          sections.push(...sentences.map(s => s.trim()).filter(s => s.length > 0));
        } else {
          sections.push(paragraph.trim());
        }
      }
    }

    return sections;
  }

  /**
   * Extract overlap text for chunk continuity
   */
  private extractOverlapText(text: string, overlapTokens: number): string {
    const overlapChars = overlapTokens * 4; // Rough conversion
    const words = text.slice(-overlapChars).split(' ');
    
    // Try to end at word boundary
    if (words.length > 1) {
      words.shift(); // Remove potentially partial first word
      return words.join(' ') + ' ';
    }
    
    return text.slice(-overlapChars) + ' ';
  }

  /**
   * Remove duplicate/similar contexts
   */
  private async deduplicateContexts(contexts: RAGContext[], threshold: number): Promise<RAGContext[]> {
    if (contexts.length <= 1) {
      return contexts;
    }

    const unique: RAGContext[] = [];
    
    for (const context of contexts) {
      let isDuplicate = false;
      
      for (const existing of unique) {
        const similarity = this.calculateTextSimilarity(context.content, existing.content);
        if (similarity >= threshold) {
          isDuplicate = true;
          // Keep the one with higher relevance score
          if (context.relevanceScore > existing.relevanceScore) {
            const existingIndex = unique.indexOf(existing);
            unique[existingIndex] = context;
          }
          break;
        }
      }
      
      if (!isDuplicate) {
        unique.push(context);
      }
    }

    return unique;
  }

  /**
   * Calculate text similarity for deduplication
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    // Simple Jaccard similarity based on words
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Select the best contexts within token limits
   */
  private selectBestContexts(
    contexts: RAGContext[],
    maxContexts: number,
    maxTokens: number,
    diversityWeight: number
  ): RAGContext[] {
    if (contexts.length === 0) {
      return [];
    }

    // Sort by relevance score first
    contexts.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const selected: RAGContext[] = [];
    let totalTokens = 0;

    for (const context of contexts) {
      if (selected.length >= maxContexts) {
        break;
      }

      if (totalTokens + context.tokenCount > maxTokens) {
        // Try to find a smaller context that fits
        const remaining = contexts.filter(ctx => 
          !selected.includes(ctx) && 
          totalTokens + ctx.tokenCount <= maxTokens
        );
        
        if (remaining.length > 0) {
          const best = remaining[0]; // Already sorted by relevance
          if (best) {
            selected.push(best);
            totalTokens += best.tokenCount;
          }
        }
        break;
      }

      // Apply diversity filter - avoid too many contexts from same source
      if (diversityWeight > 0) {
        const sameSourceCount = selected.filter(ctx => ctx.source.noteId === context.source.noteId).length;
        const maxSameSource = Math.max(1, Math.floor(maxContexts * (1 - diversityWeight)));
        
        if (sameSourceCount >= maxSameSource) {
          continue;
        }
      }

      selected.push(context);
      totalTokens += context.tokenCount;
    }

    return selected;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RAGRetrievalConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RAGRetrievalConfig {
    return { ...this.config } as RAGRetrievalConfig;
  }
}