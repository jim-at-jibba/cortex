/**
 * Chat Pane Component
 * Right pane for chat interface and search results
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { DatabaseManager, ConfigManager, SemanticSearchService, AIProviderManager, type SearchResult } from 'cortex-core';
import type { Mode } from './App';

export interface ChatPaneProps {
  focused: boolean;
  mode: Mode;
  input: string;
  onInputUpdate: (input: string) => void;
  searchQuery: string;
  onSearchUpdate: (query: string) => void;
  onSelectFile?: (filePath: string) => void;
  height: number;
}

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  streaming?: boolean;
}

export function ChatPane({
  focused,
  mode,
  input,
  onInputUpdate,
  searchQuery,
  onSearchUpdate,
  onSelectFile,
  height
}: ChatPaneProps): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchService, setSearchService] = useState<SemanticSearchService | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);

  // Handle keyboard input for search and chat
  useInput((inputChar, key) => {
    if (!focused) return;
    
    if (mode === 'search') {
      // Handle search result navigation
      if (searchResults.length > 0) {
        if (inputChar === 'j' || key.downArrow) {
          setSelectedResultIndex(prev => Math.min(prev + 1, searchResults.length - 1));
          return;
        }
        if (inputChar === 'k' || key.upArrow) {
          setSelectedResultIndex(prev => Math.max(prev - 1, 0));
          return;
        }
        if (key.return && searchResults[selectedResultIndex]) {
          onSelectFile?.(searchResults[selectedResultIndex].path);
          return;
        }
      }
      
      // Handle search input
      if (key.backspace || key.delete) {
        const newQuery = searchQuery.slice(0, -1);
        onSearchUpdate?.(newQuery);
      } else if (inputChar && inputChar.length === 1 && !key.ctrl && !key.meta) {
        // Regular character input
        const newQuery = searchQuery + inputChar;
        onSearchUpdate?.(newQuery);
      }
    } else if (mode === 'chat') {
      // Handle chat input (similar logic)
      if (key.backspace || key.delete) {
        const newInput = input.slice(0, -1);
        onInputUpdate?.(newInput);
      } else if (inputChar && inputChar.length === 1 && !key.ctrl && !key.meta) {
        const newInput = input + inputChar;
        onInputUpdate?.(newInput);
      }
    }
  });

  // Reset selected result when search results change
  useEffect(() => {
    setSelectedResultIndex(0);
  }, [searchResults]);

  // Initialize search service
  useEffect(() => {
    const initializeSearch = async () => {
      try {
        const config = await ConfigManager.load();
        const dbManager = new DatabaseManager(config);
        await dbManager.initialize();
        const aiManager = new AIProviderManager(config);
        const service = new SemanticSearchService(dbManager, aiManager);
        setSearchService(service);
      } catch (error) {
        setSearchError(error instanceof Error ? error.message : 'Failed to initialize search');
      }
    };

    initializeSearch();
  }, []);

  // Handle search when in search mode
  useEffect(() => {
    const performSearch = async () => {
      if (mode === 'search' && searchQuery && searchService) {
        setIsLoading(true);
        setSearchError(null);
        try {
          const results = await searchService.searchSemantic(searchQuery, {
            limit: 10,
            includeContent: true
          });
          setSearchResults(results);
        } catch (error) {
          setSearchError(error instanceof Error ? error.message : 'Search failed');
          setSearchResults([]);
        } finally {
          setIsLoading(false);
        }
      } else {
        setSearchResults([]);
      }
    };

    performSearch();
  }, [mode, searchQuery, searchService]);

  const maxDisplayHeight = height - 4; // Account for borders and header

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={focused ? 'cyan' : 'gray'}>
          {mode === 'search' ? '🔍 Search' : 
           mode === 'chat' ? '💬 Chat' : 
           '📋 Panel'}
        </Text>
      </Box>

      {/* Search Mode */}
      {mode === 'search' && (
        <Box flexDirection="column">
          {/* Search query display */}
          <Box marginBottom={1}>
            <Text>
              Query: <Text color="cyan">"{searchQuery || '...'}"</Text>
            </Text>
          </Box>

           {/* Search results */}
           <Box flexDirection="column">
             {searchError && (
               <Box marginBottom={1}>
                 <Text color="red">❌ {searchError}</Text>
               </Box>
             )}
             
             {isLoading && (
               <Box marginBottom={1}>
                 <Text color="yellow">🔍 Searching...</Text>
               </Box>
             )}
             
             {searchQuery && !isLoading ? (
               searchResults.length > 0 ? (
                 searchResults.slice(0, maxDisplayHeight - 3).map((result, index) => {
                   const isSelected = index === selectedResultIndex;
                   return (
                     <Box key={result.id} marginBottom={0}>
                       <Text 
                         color={isSelected ? 'black' : 'green'}
                         backgroundColor={isSelected ? 'cyan' : undefined}
                       >
                         📝 {result.title}
                       </Text>
                       {result.snippet && (
                         <Text 
                           dimColor={!isSelected}
                           color={isSelected ? 'black' : undefined}
                           backgroundColor={isSelected ? 'cyan' : undefined}
                         >
                           {"   " + result.snippet}
                         </Text>
                       )}
                     </Box>
                   );
                 })
               ) : (
                 <Text dimColor>No results found for "{searchQuery}"</Text>
               )
             ) : !isLoading ? (
               <Text dimColor>Start typing to search...</Text>
             ) : null}
           </Box>
        </Box>
      )}

      {/* Chat Mode */}
      {mode === 'chat' && (
        <Box flexDirection="column">
          {/* Chat messages */}
          <Box flexDirection="column" marginBottom={1}>
            {messages.length === 0 ? (
              <Text dimColor>Start a conversation...</Text>
            ) : (
              messages.slice(-maxDisplayHeight + 3).map((message) => (
                <Box key={message.id} marginBottom={1}>
                  <Text color={message.type === 'user' ? 'green' : 'blue'}>
                    {message.type === 'user' ? '👤' : '🤖'} {message.content}
                  </Text>
                </Box>
              ))
            )}

            {/* Loading indicator */}
            {isLoading && (
              <Box>
                <Text color="yellow">🤖 ⏳ Thinking...</Text>
              </Box>
            )}
          </Box>

          {/* Chat input area */}
          <Box borderStyle="single" borderColor="gray" paddingX={1}>
            <Text>
              💬 {input || 'Type your message...'}
              <Text color="cyan">│</Text>
            </Text>
          </Box>
        </Box>
      )}

      {/* Normal Mode */}
      {mode === 'normal' && (
        <Box justifyContent="center" alignItems="center" flexGrow={1}>
          <Box flexDirection="column" alignItems="center">
            <Text dimColor>Press Ctrl+F to search</Text>
            <Text dimColor>Press Ctrl+A to start chat</Text>
          </Box>
        </Box>
      )}

       {/* Help text when focused */}
       {focused && (
         <Box marginTop={1}>
           <Text dimColor>
             {mode === 'search' ? 
               (searchResults.length > 0 ? 
                 'Type to search • j/k: Navigate • Enter: Select • Esc: Exit' : 
                 'Type to search • Esc: Exit') :
              mode === 'chat' ? 'Type message • Enter: Send • Esc: Exit' :
              'Ctrl+F: Search • Ctrl+A: Chat'}
           </Text>
         </Box>
       )}
    </Box>
  );
}