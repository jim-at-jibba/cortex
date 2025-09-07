import type { SearchResult } from './search-service.js';

export interface BM25Params {
  k1?: number; // Term frequency saturation parameter (default: 1.2)
  b?: number;  // Length normalization parameter (default: 0.75)
}

export interface TfIdfParams {
  useSublinearScaling?: boolean; // Apply log scaling to term frequencies
  useL2Norm?: boolean;          // Apply L2 normalization
}

export interface HybridRankingConfig {
  semanticWeight: number;    // Weight for vector similarity
  keywordWeight: number;     // Weight for BM25/TF-IDF score  
  recencyWeight: number;     // Weight for recency boost
  tagWeight: number;         // Weight for tag matching
  metadataWeight: number;    // Weight for metadata boost
  lengthPenalty: number;     // Penalty for very long content
  bm25Params?: BM25Params;
  tfIdfParams?: TfIdfParams;
}

export interface DocumentStats {
  termFrequency: Map<string, number>;
  documentLength: number;
  uniqueTerms: number;
}

export interface CorpusStats {
  totalDocuments: number;
  averageDocumentLength: number;
  documentFrequencies: Map<string, number>; // How many docs contain each term
  vocabulary: Set<string>;
}

export class RankingService {
  private corpusStats: CorpusStats | null = null;
  private config: HybridRankingConfig;
  private stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their'
  ]);

  private defaultConfig: HybridRankingConfig = {
    semanticWeight: 0.4,
    keywordWeight: 0.3,
    recencyWeight: 0.15,
    tagWeight: 0.1,
    metadataWeight: 0.03,
    lengthPenalty: 0.02,
    bm25Params: {
      k1: 1.2,
      b: 0.75
    },
    tfIdfParams: {
      useSublinearScaling: true,
      useL2Norm: true
    }
  };

  constructor(config: Partial<HybridRankingConfig> = {}) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Build corpus statistics from search results for BM25/TF-IDF calculations
   */
  buildCorpusStats(documents: SearchResult[]): CorpusStats {
    const documentFrequencies = new Map<string, number>();
    const vocabulary = new Set<string>();
    let totalLength = 0;

    // Process each document
    for (const doc of documents) {
      const terms = this.tokenize(doc.content + ' ' + doc.title);
      const uniqueTerms = new Set(terms);
      
      totalLength += terms.length;

      // Count document frequencies
      uniqueTerms.forEach(term => {
        vocabulary.add(term);
        documentFrequencies.set(term, (documentFrequencies.get(term) || 0) + 1);
      });
    }

    this.corpusStats = {
      totalDocuments: documents.length,
      averageDocumentLength: documents.length > 0 ? totalLength / documents.length : 0,
      documentFrequencies,
      vocabulary
    };

    return this.corpusStats;
  }

  /**
   * Calculate BM25 score for a query against a document
   */
  calculateBM25Score(query: string, document: SearchResult, corpusStats?: CorpusStats): number {
    const stats = corpusStats || this.corpusStats;
    if (!stats) {
      console.warn('Corpus statistics not available for BM25 calculation');
      return 0;
    }

    const params = this.config.bm25Params!;
    const k1 = params.k1!;
    const b = params.b!;

    const queryTerms = this.tokenize(query);
    const docText = document.content + ' ' + document.title;
    const docTerms = this.tokenize(docText);
    const docStats = this.getDocumentStats(docTerms);

    let bm25Score = 0;

    for (const queryTerm of queryTerms) {
      const termFreq = docStats.termFrequency.get(queryTerm) || 0;
      if (termFreq === 0) continue;

      // Document frequency (how many documents contain this term)
      const docFreq = stats.documentFrequencies.get(queryTerm) || 0;
      if (docFreq === 0) continue;

      // IDF calculation: log((N - df + 0.5) / (df + 0.5))
      const idf = Math.log((stats.totalDocuments - docFreq + 0.5) / (docFreq + 0.5));

      // BM25 term weight calculation
      const numerator = termFreq * (k1 + 1);
      const denominator = termFreq + k1 * (1 - b + b * (docStats.documentLength / stats.averageDocumentLength));
      
      bm25Score += idf * (numerator / denominator);
    }

    return Math.max(0, bm25Score);
  }

  /**
   * Calculate TF-IDF score for a query against a document
   */
  calculateTfIdfScore(query: string, document: SearchResult, corpusStats?: CorpusStats): number {
    const stats = corpusStats || this.corpusStats;
    if (!stats) {
      console.warn('Corpus statistics not available for TF-IDF calculation');
      return 0;
    }

    const params = this.config.tfIdfParams!;
    const queryTerms = this.tokenize(query);
    const docText = document.content + ' ' + document.title;
    const docTerms = this.tokenize(docText);
    const docStats = this.getDocumentStats(docTerms);

    let tfIdfScore = 0;

    for (const queryTerm of queryTerms) {
      const termFreq = docStats.termFrequency.get(queryTerm) || 0;
      if (termFreq === 0) continue;

      const docFreq = stats.documentFrequencies.get(queryTerm) || 0;
      if (docFreq === 0) continue;

      // TF calculation
      let tf = termFreq;
      if (params.useSublinearScaling) {
        tf = 1 + Math.log(termFreq);
      }

      // IDF calculation
      const idf = Math.log(stats.totalDocuments / docFreq);

      tfIdfScore += tf * idf;
    }

    // Apply L2 normalization if enabled
    if (params.useL2Norm && tfIdfScore > 0) {
      const docNorm = this.calculateDocumentL2Norm(docStats, stats);
      tfIdfScore = tfIdfScore / docNorm;
    }

    return Math.max(0, tfIdfScore);
  }

  /**
   * Apply hybrid ranking that combines multiple scoring methods
   */
  rankResults(
    results: SearchResult[],
    query: string,
    config?: Partial<HybridRankingConfig>
  ): SearchResult[] {
    const rankingConfig = { ...this.config, ...config };
    
    // Build corpus statistics for this result set
    const corpusStats = this.buildCorpusStats(results);
    
    const now = Date.now();
    const queryTerms = this.tokenize(query);

    return results.map(result => {
      let hybridScore = 0;

      // 1. Semantic similarity score (from vector search)
      if (rankingConfig.semanticWeight > 0) {
        hybridScore += result.similarity * rankingConfig.semanticWeight;
      }

      // 2. Keyword matching score (BM25)
      if (rankingConfig.keywordWeight > 0) {
        const keywordScore = this.calculateBM25Score(query, result, corpusStats);
        const normalizedKeywordScore = this.normalizeScore(keywordScore, 0, 10); // BM25 typically ranges 0-10
        hybridScore += normalizedKeywordScore * rankingConfig.keywordWeight;
      }

      // 3. Recency boost
      if (rankingConfig.recencyWeight > 0) {
        const ageInDays = (now - result.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const recencyScore = Math.exp(-ageInDays / 365); // Decay over 1 year
        hybridScore += recencyScore * rankingConfig.recencyWeight;
      }

      // 4. Tag matching boost
      if (rankingConfig.tagWeight > 0 && result.tags && result.tags.length > 0) {
        let tagScore = 0;
        
        // Boost for query terms that appear in tags
        for (const tag of result.tags) {
          const tagTerms = this.tokenize(tag);
          for (const queryTerm of queryTerms) {
            if (tagTerms.includes(queryTerm)) {
              tagScore += 1;
            }
          }
        }
        
        // Normalize by number of query terms
        const normalizedTagScore = queryTerms.length > 0 ? tagScore / queryTerms.length : 0;
        hybridScore += normalizedTagScore * rankingConfig.tagWeight;
      }

      // 5. Metadata field boost
      if (rankingConfig.metadataWeight > 0 && result.metadata) {
        let metadataScore = 0;
        
        // Check for query terms in metadata values
        for (const value of Object.values(result.metadata)) {
          if (typeof value === 'string') {
            const metadataTerms = this.tokenize(value);
            for (const queryTerm of queryTerms) {
              if (metadataTerms.includes(queryTerm)) {
                metadataScore += 0.5; // Lower weight than tag matches
              }
            }
          }
        }
        
        const normalizedMetadataScore = queryTerms.length > 0 ? metadataScore / queryTerms.length : 0;
        hybridScore += normalizedMetadataScore * rankingConfig.metadataWeight;
      }

      // 6. Length penalty (prefer concise, focused content)
      if (rankingConfig.lengthPenalty > 0) {
        const contentLength = result.content.length;
        const lengthPenalty = Math.min(contentLength / 10000, 1); // Cap at 10k chars
        hybridScore -= lengthPenalty * rankingConfig.lengthPenalty;
      }

      return {
        ...result,
        relevanceScore: Math.max(0, Math.min(1, hybridScore)) // Clamp between 0 and 1
      };
    }).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Tokenize text into terms (words) for analysis
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .split(/\s+/)
      .filter(term => term.length > 1 && !this.stopWords.has(term));
  }

  /**
   * Get document statistics for BM25/TF-IDF calculations
   */
  private getDocumentStats(terms: string[]): DocumentStats {
    const termFrequency = new Map<string, number>();
    
    for (const term of terms) {
      termFrequency.set(term, (termFrequency.get(term) || 0) + 1);
    }

    return {
      termFrequency,
      documentLength: terms.length,
      uniqueTerms: termFrequency.size
    };
  }

  /**
   * Calculate L2 norm for document vector (for TF-IDF normalization)
   */
  private calculateDocumentL2Norm(docStats: DocumentStats, corpusStats: CorpusStats): number {
    let norm = 0;
    
    for (const [term, tf] of docStats.termFrequency) {
      const df = corpusStats.documentFrequencies.get(term) || 0;
      if (df === 0) continue;
      
      const idf = Math.log(corpusStats.totalDocuments / df);
      const tfIdf = (this.config.tfIdfParams?.useSublinearScaling ? 1 + Math.log(tf) : tf) * idf;
      norm += tfIdf * tfIdf;
    }
    
    return Math.sqrt(norm) || 1; // Avoid division by zero
  }

  /**
   * Normalize a score to 0-1 range
   */
  private normalizeScore(score: number, min: number, max: number): number {
    if (max <= min) return 0;
    return Math.max(0, Math.min(1, (score - min) / (max - min)));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HybridRankingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): HybridRankingConfig {
    return { ...this.config };
  }

  /**
   * Get corpus statistics
   */
  getCorpusStats(): CorpusStats | null {
    return this.corpusStats;
  }

  /**
   * Clear cached corpus statistics
   */
  clearCorpusStats(): void {
    this.corpusStats = null;
  }
}