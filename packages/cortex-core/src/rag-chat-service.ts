import { AIProviderManager } from './ai-service.js';
import { RAGContextService, type RAGQuery, type RAGContext } from './rag-service.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
  metadata?: Record<string, any>;
}

export interface ChatResponse {
  content: string;
  citations: Citation[];
  contexts: RAGContext[];
  confidence: number;
  fallbackUsed: boolean;
  generationStats: {
    contextsRetrieved: number;
    totalContextTokens: number;
    responseTokens: number;
    retrievalTimeMs: number;
    generationTimeMs: number;
  };
}

export interface Citation {
  id: string;
  title: string;
  path: string;
  snippet: string;
  relevanceScore: number;
  usedInResponse: boolean;
}

export interface RAGChatConfig {
  systemPrompt?: string;
  maxContextTokens: number;
  includeConversationHistory: boolean;
  maxHistoryMessages: number;
  confidenceThreshold: number;
  citationStyle: 'inline' | 'numbered' | 'footnotes';
  enableFallback: boolean;
  fallbackMessage: string;
}

export interface ConversationContext {
  messages: ChatMessage[];
  sessionId: string;
  metadata: Record<string, any>;
}

export class RAGChatService {
  private conversations: Map<string, ConversationContext> = new Map();
  
  private defaultConfig: RAGChatConfig = {
    systemPrompt: `You are a helpful AI assistant that answers questions based on the user's personal notes and knowledge base. 
Always provide accurate information based on the provided context. When referencing information from the notes, include proper citations.
If you cannot answer a question based on the available context, say so clearly.`,
    maxContextTokens: 4000,
    includeConversationHistory: true,
    maxHistoryMessages: 10,
    confidenceThreshold: 0.6,
    citationStyle: 'inline',
    enableFallback: true,
    fallbackMessage: "I don't have enough relevant information in your notes to answer this question confidently."
  };

  constructor(
    private aiManager: AIProviderManager,
    private ragService: RAGContextService,
    private config: Partial<RAGChatConfig> = {}
  ) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Generate a RAG-powered chat response
   */
  async generateResponse(
    query: string,
    sessionId?: string,
    ragQuery?: Partial<RAGQuery>
  ): Promise<ChatResponse> {
    const startTime = Date.now();
    const config = this.config as RAGChatConfig;

    try {
      // Step 1: Retrieve relevant contexts
      const retrievalStart = Date.now();
      const retrievalQuery: RAGQuery = {
        query,
        ...ragQuery
      };
      
      const retrievalResult = await this.ragService.retrieveContexts(retrievalQuery);
      const retrievalTime = Date.now() - retrievalStart;

      // Step 2: Build the prompt with context and conversation history
      const prompt = await this.buildPrompt(
        query,
        retrievalResult.contexts,
        sessionId,
        config
      );

      // Step 3: Generate AI response
      const generationStart = Date.now();
      const aiResponse = await this.aiManager.chatCompletion([
        {
          role: 'system',
          content: config.systemPrompt!
        },
        {
          role: 'user',
          content: prompt
        }
      ]);
      const generationTime = Date.now() - generationStart;

      // Step 4: Process response and extract citations
      const processedResponse = this.processResponse(aiResponse, retrievalResult.contexts);
      
      // Step 5: Calculate confidence score
      const confidence = this.calculateConfidence(
        retrievalResult.contexts,
        processedResponse.content,
        retrievalResult.retrievalStats
      );

      // Step 6: Apply fallback if confidence is too low
      let finalContent = processedResponse.content;
      let fallbackUsed = false;

      if (config.enableFallback && confidence < config.confidenceThreshold) {
        finalContent = config.fallbackMessage;
        fallbackUsed = true;
      }

      // Step 7: Update conversation history
      if (sessionId && config.includeConversationHistory) {
        this.addToConversation(sessionId, query, finalContent);
      }

      // Step 8: Prepare citations
      const citations = this.prepareCitations(
        retrievalResult.contexts,
        processedResponse.citedContexts
      );

      return {
        content: finalContent,
        citations,
        contexts: retrievalResult.contexts,
        confidence,
        fallbackUsed,
        generationStats: {
          contextsRetrieved: retrievalResult.contexts.length,
          totalContextTokens: retrievalResult.totalTokens,
          responseTokens: this.estimateTokens(finalContent),
          retrievalTimeMs: retrievalTime,
          generationTimeMs: generationTime
        }
      };

    } catch (error) {
      console.error('RAG chat generation failed:', error);
      
      return {
        content: 'I encountered an error while trying to answer your question. Please try again.',
        citations: [],
        contexts: [],
        confidence: 0,
        fallbackUsed: true,
        generationStats: {
          contextsRetrieved: 0,
          totalContextTokens: 0,
          responseTokens: 0,
          retrievalTimeMs: 0,
          generationTimeMs: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Generate streaming RAG response
   */
  async* streamResponse(
    query: string,
    sessionId?: string,
    ragQuery?: Partial<RAGQuery>
  ): AsyncIterable<{ chunk: string; isComplete: boolean; response?: ChatResponse }> {
    // First get contexts (non-streaming part)
    const retrievalQuery: RAGQuery = { query, ...ragQuery };
    const retrievalResult = await this.ragService.retrieveContexts(retrievalQuery);
    
    const config = this.config as RAGChatConfig;
    const prompt = await this.buildPrompt(query, retrievalResult.contexts, sessionId, config);

    // Stream the AI response
    const aiStream = await this.aiManager.streamChatCompletion([
      { role: 'system', content: config.systemPrompt! },
      { role: 'user', content: prompt }
    ]);

    let fullContent = '';
    
    for await (const chunk of aiStream) {
      fullContent += chunk;
      yield { chunk, isComplete: false };
    }

    // Process final response
    const processedResponse = this.processResponse(fullContent, retrievalResult.contexts);
    const confidence = this.calculateConfidence(
      retrievalResult.contexts,
      processedResponse.content,
      retrievalResult.retrievalStats
    );

    // Update conversation if needed
    if (sessionId && config.includeConversationHistory) {
      this.addToConversation(sessionId, query, fullContent);
    }

    const citations = this.prepareCitations(retrievalResult.contexts, processedResponse.citedContexts);

    yield {
      chunk: '',
      isComplete: true,
      response: {
        content: fullContent,
        citations,
        contexts: retrievalResult.contexts,
        confidence,
        fallbackUsed: false,
        generationStats: {
          contextsRetrieved: retrievalResult.contexts.length,
          totalContextTokens: retrievalResult.totalTokens,
          responseTokens: this.estimateTokens(fullContent),
          retrievalTimeMs: 0,
          generationTimeMs: 0
        }
      }
    };
  }

  /**
   * Build the complete prompt with context and conversation history
   */
  private async buildPrompt(
    query: string,
    contexts: RAGContext[],
    sessionId?: string,
    config?: RAGChatConfig
  ): Promise<string> {
    let prompt = '';

    // Add conversation history if enabled
    if (sessionId && config?.includeConversationHistory) {
      const conversation = this.conversations.get(sessionId);
      if (conversation && conversation.messages.length > 0) {
        prompt += 'Previous conversation:\n';
        const recentMessages = conversation.messages.slice(-config.maxHistoryMessages);
        
        for (const message of recentMessages) {
          prompt += `${message.role}: ${message.content}\n`;
        }
        prompt += '\n';
      }
    }

    // Add context from retrieved notes
    if (contexts.length > 0) {
      prompt += 'Relevant information from your notes:\n\n';
      
      contexts.forEach((context, index) => {
        const citationLabel = this.getCitationLabel(index, config?.citationStyle || 'inline');
        prompt += `${citationLabel} From "${context.source.title}":\n`;
        prompt += `${context.content}\n\n`;
      });
    }

    // Add the actual question
    prompt += `Based on the above information, please answer the following question:\n${query}\n\n`;
    
    // Add citation instructions
    prompt += this.getCitationInstructions(config?.citationStyle || 'inline');

    return prompt;
  }

  /**
   * Process AI response and identify cited contexts
   */
  private processResponse(content: string, contexts: RAGContext[]): {
    content: string;
    citedContexts: Set<string>;
  } {
    const citedContexts = new Set<string>();

    // Look for references to context titles or note names
    for (const context of contexts) {
      const title = context.source.title.toLowerCase();
      const contentLower = content.toLowerCase();

      // Check if the note title is mentioned in the response
      if (contentLower.includes(title) || contentLower.includes(`"${title}"`)) {
        citedContexts.add(context.id);
      }

      // Check for numbered citations like [1], (1), etc.
      const contextIndex = contexts.indexOf(context);
      const citationPatterns = [
        `\\[${contextIndex + 1}\\]`,
        `\\(${contextIndex + 1}\\)`,
        `^${contextIndex + 1}`,
        `\\*${contextIndex + 1}\\*`
      ];

      for (const pattern of citationPatterns) {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(content)) {
          citedContexts.add(context.id);
        }
      }
    }

    return { content, citedContexts };
  }

  /**
   * Calculate confidence score for the response
   */
  private calculateConfidence(
    contexts: RAGContext[],
    response: string,
    retrievalStats: any
  ): number {
    let confidence = 0;

    // Base confidence from context quality
    if (contexts.length > 0) {
      const avgRelevance = contexts.reduce((sum, ctx) => sum + ctx.relevanceScore, 0) / contexts.length;
      confidence += avgRelevance * 0.4;
    }

    // Boost confidence for longer, more detailed responses
    const responseLength = response.length;
    const lengthScore = Math.min(responseLength / 500, 1); // Normalize to 500 chars max
    confidence += lengthScore * 0.2;

    // Boost confidence when multiple contexts are used
    const contextUsage = Math.min(contexts.length / 3, 1); // Normalize to 3 contexts max
    confidence += contextUsage * 0.2;

    // Boost confidence for good retrieval stats
    if (retrievalStats.filteredCandidates > 0) {
      const retrievalQuality = Math.min(retrievalStats.finalContexts / retrievalStats.filteredCandidates, 1);
      confidence += retrievalQuality * 0.2;
    }

    return Math.min(confidence, 1);
  }

  /**
   * Prepare citation information
   */
  private prepareCitations(contexts: RAGContext[], citedContexts: Set<string>): Citation[] {
    return contexts.map(context => ({
      id: context.source.noteId,
      title: context.source.title,
      path: context.source.path,
      snippet: context.source.snippet,
      relevanceScore: context.relevanceScore,
      usedInResponse: citedContexts.has(context.id)
    }));
  }

  /**
   * Get citation label based on style
   */
  private getCitationLabel(index: number, style: string): string {
    switch (style) {
      case 'numbered':
        return `[${index + 1}]`;
      case 'footnotes':
        return `^${index + 1}`;
      case 'inline':
      default:
        return '**';
    }
  }

  /**
   * Get citation instructions for the AI
   */
  private getCitationInstructions(style: string): string {
    switch (style) {
      case 'numbered':
        return 'When referencing information from the notes, use numbered citations like [1], [2], etc. corresponding to the source notes.';
      case 'footnotes':
        return 'When referencing information from the notes, use footnote citations like ^1, ^2, etc. corresponding to the source notes.';
      case 'inline':
      default:
        return 'When referencing information from the notes, mention the note title in your response (e.g., "According to your note on TypeScript...").';
    }
  }

  /**
   * Add message to conversation history
   */
  private addToConversation(sessionId: string, userMessage: string, assistantMessage: string): void {
    let conversation = this.conversations.get(sessionId);
    
    if (!conversation) {
      conversation = {
        messages: [],
        sessionId,
        metadata: {}
      };
      this.conversations.set(sessionId, conversation);
    }

    conversation.messages.push(
      {
        role: 'user',
        content: userMessage,
        timestamp: new Date()
      },
      {
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date()
      }
    );

    // Keep only recent messages to avoid context overflow
    const maxMessages = (this.config as RAGChatConfig).maxHistoryMessages * 2; // *2 for user+assistant pairs
    if (conversation.messages.length > maxMessages) {
      conversation.messages = conversation.messages.slice(-maxMessages);
    }
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get conversation history
   */
  getConversation(sessionId: string): ConversationContext | null {
    return this.conversations.get(sessionId) || null;
  }

  /**
   * Clear conversation history
   */
  clearConversation(sessionId: string): void {
    this.conversations.delete(sessionId);
  }

  /**
   * Clear all conversations
   */
  clearAllConversations(): void {
    this.conversations.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RAGChatConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RAGChatConfig {
    return { ...this.config } as RAGChatConfig;
  }
}