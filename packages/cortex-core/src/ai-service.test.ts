import { test, expect, mock } from 'bun:test';
import { AIProviderManager } from './ai-service.js';
import type { CortexConfig } from './config.js';

// Mock config for testing
const mockConfig: CortexConfig = {
  notesPath: './test-notes',
  templatesPath: './test-templates',
  databasePath: './test.db',
  aiProvider: 'openai',
  embeddingModel: 'text-embedding-ada-002',
  chatModel: 'gpt-4',
  apiKeys: {
    openai: 'test-openai-key',
    anthropic: 'test-anthropic-key',
    ollama: 'test-ollama-key'
  },
  autoCommit: true,
  daemon: {
    enabled: false,
    port: 3001
  }
};

// Mock the AI SDK modules
const mockEmbed = mock().mockResolvedValue({
  embedding: [0.1, 0.2, 0.3, 0.4, 0.5]
});

const mockEmbedMany = mock().mockResolvedValue({
  embeddings: [
    [0.1, 0.2, 0.3, 0.4, 0.5],
    [0.2, 0.3, 0.4, 0.5, 0.6]
  ]
});

const mockGenerateText = mock().mockResolvedValue({
  text: 'This is a mock AI response'
});

const mockStreamText = mock().mockResolvedValue({
  textStream: async function* () {
    yield 'This ';
    yield 'is ';
    yield 'streaming ';
    yield 'response';
  }()
});

const mockOpenAIProvider = Object.assign(
  mock().mockReturnValue('mock-chat-model'),
  {
    textEmbedding: mock().mockReturnValue('mock-embedding-model')
  }
);

const mockCreateOpenAI = mock().mockReturnValue(mockOpenAIProvider);

const mockAnthropicProvider = Object.assign(
  mock().mockReturnValue('mock-anthropic-model'),
  {}
);

const mockOllamaProvider = Object.assign(
  mock().mockReturnValue('mock-ollama-model'),
  {
    textEmbeddingModel: mock().mockReturnValue('mock-ollama-embedding-model')
  }
);

const mockCreateAnthropic = mock().mockReturnValue(mockAnthropicProvider);
const mockCreateOllama = mock().mockReturnValue(mockOllamaProvider);

// Mock the modules
mock.module('ai', () => ({
  embed: mockEmbed,
  embedMany: mockEmbedMany,
  generateText: mockGenerateText,
  streamText: mockStreamText
}));

mock.module('@ai-sdk/openai', () => ({
  createOpenAI: mockCreateOpenAI
}));

mock.module('@ai-sdk/anthropic', () => ({
  createAnthropic: mockCreateAnthropic
}));

mock.module('ollama-ai-provider-v2', () => ({
  createOllama: mockCreateOllama
}));

test('AIProviderManager initialization', () => {
  const aiManager = new AIProviderManager(mockConfig);
  expect(aiManager).toBeDefined();
});

test('Generate OpenAI embedding', async () => {
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'openai'
  });
  
  const embedding = await aiManager.generateEmbedding('test text');
  expect(embedding).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  expect(mockEmbed).toHaveBeenCalledWith({
    model: 'mock-embedding-model',
    value: 'test text'
  });
});

test('Generate batch embeddings with OpenAI', async () => {
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'openai'
  });
  
  const embeddings = await aiManager.generateEmbeddings(['text1', 'text2']);
  expect(embeddings).toHaveLength(2);
  expect(embeddings[0]).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  expect(embeddings[1]).toEqual([0.2, 0.3, 0.4, 0.5, 0.6]);
});

test('Chat completion with OpenAI', async () => {
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'openai'
  });
  
  const messages = [{ role: 'user', content: 'Hello' }];
  const response = await aiManager.chatCompletion(messages);
  expect(response).toBe('This is a mock AI response');
});

test('Streaming chat with OpenAI', async () => {
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'openai'
  });
  
  const messages = [{ role: 'user', content: 'Hello' }];
  const stream = await aiManager.streamChatCompletion(messages);
  
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  
  expect(chunks).toEqual(['This ', 'is ', 'streaming ', 'response']);
});

test('Embedding caching', async () => {
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'openai'
  });
  
  // First call should hit the API
  const embedding1 = await aiManager.generateEmbedding('cache test');
  expect(mockEmbed).toHaveBeenCalledTimes(1);
  
  // Second call should use cache
  const embedding2 = await aiManager.generateEmbedding('cache test');
  expect(mockEmbed).toHaveBeenCalledTimes(1); // Still only 1 call
  expect(embedding1).toEqual(embedding2);
});

test('Cache management', () => {
  const aiManager = new AIProviderManager(mockConfig);
  
  // Test cache stats
  const stats = aiManager.getCacheStats();
  expect(stats).toHaveProperty('size');
  expect(stats).toHaveProperty('oldEntries');
  
  // Test clear cache
  aiManager.clearCache();
  const statsAfterClear = aiManager.getCacheStats();
  expect(statsAfterClear.size).toBe(0);
});

test('Retry logic with exponential backoff', async () => {
  const failingEmbed = mock()
    .mockRejectedValueOnce(new Error('API Error 1'))
    .mockRejectedValueOnce(new Error('API Error 2'))
    .mockResolvedValueOnce({ embedding: [0.1, 0.2, 0.3] });

  mock.module('ai', () => ({
    embed: failingEmbed,
    embedMany: mockEmbedMany,
    generateText: mockGenerateText,
    streamText: mockStreamText
  }));
  
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'openai'
  });
  
  const embedding = await aiManager.generateEmbedding('retry test');
  expect(embedding).toEqual([0.1, 0.2, 0.3]);
  expect(failingEmbed).toHaveBeenCalledTimes(3); // 2 failures + 1 success
});

test('Health check', async () => {
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'openai'
  });
  
  const health = await aiManager.healthCheck();
  expect(health).toHaveProperty('openai');
  expect(typeof health.openai).toBe('boolean');
});

test('Provider error handling', async () => {
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'openai',
    apiKeys: { ...mockConfig.apiKeys, openai: undefined }
  });
  
  expect(aiManager.generateEmbedding('test')).rejects.toThrow('OpenAI API key not configured');
});

test('Unsupported provider error', async () => {
  const aiManager = new AIProviderManager({
    ...mockConfig,
    aiProvider: 'unsupported' as any
  });
  
  expect(aiManager.generateEmbedding('test')).rejects.toThrow('Embedding not supported for provider: unsupported');
});