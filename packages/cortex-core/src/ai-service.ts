import type { CortexConfig } from './config.js';
import { OfflineManager, OfflineMode, NetworkStatus, JobPriority } from './offline-manager.js';
import type { IJobQueue } from './offline-manager.js';

export interface EmbeddingCache {
  [text: string]: {
    embedding: number[];
    timestamp: number;
    model: string;
  };
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export class AIProviderManager {
  private embeddingCache: EmbeddingCache = {};
  private cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours in ms
  
  private defaultRetryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
  };

  private offlineManager: OfflineManager | null = null;

  constructor(private config: CortexConfig) {}

  async generateEmbedding(text: string): Promise<number[]> {
    const cacheKey = `${text}-${this.config.embeddingModel}-${this.config.aiProvider}`;
    
    // Check cache first
    const cached = this.embeddingCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
      return cached.embedding;
    }

    // Check if we're offline and should queue the request
    if (this.offlineManager && this.offlineManager.getStatus().networkStatus === NetworkStatus.OFFLINE) {
      console.log('📡 Network offline - queuing embedding request');
      await this.offlineManager.queueEmbeddingRequest(text, {
        priority: JobPriority.MEDIUM
      });
      throw new Error('Network offline - embedding request queued for processing');
    }

    return this.withRetry(async () => {
      let embedding: number[];

      if (this.config.aiProvider === 'openai') {
        embedding = await this.generateOpenAIEmbedding(text);
      } else if (this.config.aiProvider === 'anthropic') {
        // Anthropic doesn't have embeddings, fallback to OpenAI
        if (!this.config.apiKeys.openai) {
          throw new Error('OpenAI API key required for embeddings when using Anthropic');
        }
        embedding = await this.generateOpenAIEmbedding(text);
      } else if (this.config.aiProvider === 'ollama') {
        embedding = await this.generateOllamaEmbedding(text);
      } else {
        throw new Error(`Embedding not supported for provider: ${this.config.aiProvider}`);
      }

      // Cache the result
      this.embeddingCache[cacheKey] = {
        embedding,
        timestamp: Date.now(),
        model: this.config.embeddingModel
      };

      return embedding;
    });
  }

  async generateEmbeddings(texts: string[], batchSize: number = 20): Promise<number[][]> {
    if (texts.length === 0) return [];
    
    // Check if provider supports batch processing
    if (this.config.aiProvider === 'openai') {
      return this.generateOpenAIEmbeddingsBatch(texts, batchSize);
    }
    
    // For providers that don't support batch processing, process in parallel batches
    const embeddings: number[][] = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map(text => this.generateEmbedding(text));
      const batchEmbeddings = await Promise.all(batchPromises);
      embeddings.push(...batchEmbeddings);
    }
    
    return embeddings;
  }

  private async generateOpenAIEmbeddingsBatch(texts: string[], batchSize: number): Promise<number[][]> {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { embedMany } = await import('ai');
    
    if (!this.config.apiKeys.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const openai = createOpenAI({
      apiKey: this.config.apiKeys.openai
    });

    const embeddings: number[][] = [];
    
    // Process in batches to avoid hitting API limits
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      const result = await this.withRetry(async () => {
        return await embedMany({
          model: openai.textEmbedding(this.config.embeddingModel || 'text-embedding-ada-002'),
          values: batch
        });
      });
      
      embeddings.push(...result.embeddings);
      
      // Cache the results
      batch.forEach((text, index) => {
        const embedding = result.embeddings[index];
        if (embedding) {
          const cacheKey = `${text}-${this.config.embeddingModel}-${this.config.aiProvider}`;
          this.embeddingCache[cacheKey] = {
            embedding: embedding,
            timestamp: Date.now(),
            model: this.config.embeddingModel
          };
        }
      });
    }
    
    return embeddings;
  }

  async chatCompletion(messages: Array<{role: string, content: string}>): Promise<string> {
    return this.withRetry(async () => {
      if (this.config.aiProvider === 'openai') {
        return this.generateOpenAIChat(messages);
      } else if (this.config.aiProvider === 'anthropic') {
        return this.generateAnthropicChat(messages);
      } else if (this.config.aiProvider === 'ollama') {
        return this.generateOllamaChat(messages);
      } else {
        throw new Error(`Chat completion not supported for provider: ${this.config.aiProvider}`);
      }
    });
  }

  async streamChatCompletion(messages: Array<{role: string, content: string}>): Promise<AsyncIterable<string>> {
    return this.withRetry(async () => {
      if (this.config.aiProvider === 'openai') {
        return this.streamOpenAIChat(messages);
      } else if (this.config.aiProvider === 'anthropic') {
        return this.streamAnthropicChat(messages);
      } else if (this.config.aiProvider === 'ollama') {
        return this.streamOllamaChat(messages);
      } else {
        throw new Error(`Streaming chat not supported for provider: ${this.config.aiProvider}`);
      }
    });
  }

  private async generateOpenAIEmbedding(text: string): Promise<number[]> {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { embed } = await import('ai');
    
    if (!this.config.apiKeys.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const openai = createOpenAI({
      apiKey: this.config.apiKeys.openai
    });

    const result = await embed({
      model: openai.textEmbedding(this.config.embeddingModel || 'text-embedding-ada-002'),
      value: text
    });

    return result.embedding;
  }

  private async generateOpenAIChat(messages: Array<{role: string, content: string}>): Promise<string> {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { generateText } = await import('ai');
    
    if (!this.config.apiKeys.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const openai = createOpenAI({
      apiKey: this.config.apiKeys.openai
    });

    const result = await generateText({
      model: openai(this.config.chatModel || 'gpt-4'),
      messages: messages.map(msg => ({ role: msg.role as any, content: msg.content }))
    });

    return result.text;
  }

  private async streamOpenAIChat(messages: Array<{role: string, content: string}>): Promise<AsyncIterable<string>> {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { streamText } = await import('ai');
    
    if (!this.config.apiKeys.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const openai = createOpenAI({
      apiKey: this.config.apiKeys.openai
    });

    const result = streamText({
      model: openai(this.config.chatModel || 'gpt-4'),
      messages: messages.map(msg => ({ role: msg.role as any, content: msg.content }))
    });

    return result.textStream;
  }

  private async generateAnthropicChat(messages: Array<{role: string, content: string}>): Promise<string> {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { generateText } = await import('ai');
    
    if (!this.config.apiKeys.anthropic) {
      throw new Error('Anthropic API key not configured');
    }

    const anthropic = createAnthropic({
      apiKey: this.config.apiKeys.anthropic
    });

    const result = await generateText({
      model: anthropic(this.config.chatModel || 'claude-3-5-sonnet-20241022'),
      messages: messages.map(msg => ({ role: msg.role as any, content: msg.content }))
    });

    return result.text;
  }

  private async streamAnthropicChat(messages: Array<{role: string, content: string}>): Promise<AsyncIterable<string>> {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { streamText } = await import('ai');
    
    if (!this.config.apiKeys.anthropic) {
      throw new Error('Anthropic API key not configured');
    }

    const anthropic = createAnthropic({
      apiKey: this.config.apiKeys.anthropic
    });

    const result = streamText({
      model: anthropic(this.config.chatModel || 'claude-3-5-sonnet-20241022'),
      messages: messages.map(msg => ({ role: msg.role as any, content: msg.content }))
    });

    return result.textStream;
  }

  private async generateOllamaEmbedding(text: string): Promise<number[]> {
    const { createOllama } = await import('ollama-ai-provider-v2');
    const { embed } = await import('ai');
    
    const ollama = createOllama({
      baseURL: 'http://localhost:11434'
    });

    const result = await embed({
      model: ollama.textEmbeddingModel(this.config.embeddingModel || 'nomic-embed-text'),
      value: text
    });

    return result.embedding;
  }

  private async generateOllamaChat(messages: Array<{role: string, content: string}>): Promise<string> {
    const { createOllama } = await import('ollama-ai-provider-v2');
    const { generateText } = await import('ai');
    
    const ollama = createOllama({
      baseURL: 'http://localhost:11434'
    });

    const result = await generateText({
      model: ollama(this.config.chatModel || 'llama3'),
      messages: messages.map(msg => ({ role: msg.role as any, content: msg.content }))
    });

    return result.text;
  }

  private async streamOllamaChat(messages: Array<{role: string, content: string}>): Promise<AsyncIterable<string>> {
    const { createOllama } = await import('ollama-ai-provider-v2');
    const { streamText } = await import('ai');
    
    const ollama = createOllama({
      baseURL: 'http://localhost:11434'
    });

    const result = streamText({
      model: ollama(this.config.chatModel || 'llama3'),
      messages: messages.map(msg => ({ role: msg.role as any, content: msg.content }))
    });

    return result.textStream;
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    retryConfig: Partial<RetryConfig> = {}
  ): Promise<T> {
    const config = { ...this.defaultRetryConfig, ...retryConfig };
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on the last attempt
        if (attempt === config.maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelay * Math.pow(config.backoffFactor, attempt),
          config.maxDelay
        );

        console.warn(`AI operation failed (attempt ${attempt + 1}/${config.maxRetries + 1}): ${lastError.message}. Retrying in ${delay}ms...`);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`AI operation failed after ${config.maxRetries + 1} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  // Cache management methods
  clearCache(): void {
    this.embeddingCache = {};
  }

  getCacheStats(): { size: number; oldEntries: number } {
    const now = Date.now();
    let oldEntries = 0;
    
    Object.values(this.embeddingCache).forEach(entry => {
      if ((now - entry.timestamp) > this.cacheExpiry) {
        oldEntries++;
      }
    });

    return {
      size: Object.keys(this.embeddingCache).length,
      oldEntries
    };
  }

  cleanExpiredCache(): number {
    const now = Date.now();
    const initialSize = Object.keys(this.embeddingCache).length;
    
    Object.keys(this.embeddingCache).forEach(key => {
      const entry = this.embeddingCache[key];
      if (entry && (now - entry.timestamp) > this.cacheExpiry) {
        delete this.embeddingCache[key];
      }
    });

    const finalSize = Object.keys(this.embeddingCache).length;
    return initialSize - finalSize;
  }

  // Health check for providers
  async healthCheck(): Promise<{ [provider: string]: boolean }> {
    const results: { [provider: string]: boolean } = {};
    
    try {
      // Test embedding generation
      await this.generateEmbedding('health check test');
      results[this.config.aiProvider] = true;
    } catch (error) {
      console.warn(`Health check failed for provider ${this.config.aiProvider}:`, error);
      results[this.config.aiProvider] = false;
    }

    return results;
  }

  /**
   * Initialize offline manager
   */
  async initializeOfflineManager(jobQueue: IJobQueue): Promise<void> {
    this.offlineManager = new OfflineManager({
      notificationCallback: (message, type) => {
        console.log(`[OfflineManager] [${type.toUpperCase()}] ${message}`);
      }
    });

    await this.offlineManager.initialize(this.config, jobQueue);
    console.log('✅ Offline manager initialized for AI service');
  }

  /**
   * Get offline manager instance
   */
  getOfflineManager(): OfflineManager | null {
    return this.offlineManager;
  }

  /**
   * Set offline mode
   */
  setOfflineMode(mode: OfflineMode): void {
    if (this.offlineManager) {
      this.offlineManager.setOfflineMode(mode);
    }
  }

  /**
   * Get offline status
   */
  getOfflineStatus() {
    return this.offlineManager?.getStatus() || null;
  }
}