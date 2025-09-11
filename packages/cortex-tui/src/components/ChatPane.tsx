/**
 * Chat Pane Component
 * Right pane for chat interface and search results
 */

import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { DatabaseManager, ConfigManager, SemanticSearchService, AIProviderManager, RAGChatService, RAGContextService, type SearchResult } from 'cortex-core';
import { useSearch } from '../hooks/useSearch';
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
  width: number;
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
  height,
  width
}: ChatPaneProps): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchService, setSearchService] = useState<SemanticSearchService | null>(null);
  const [chatService, setChatService] = useState<RAGChatService | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [lineScrollOffset, setLineScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  // Text wrapping function
  const wrapText = (txt: string, w: number): string[] => {
    const width = Math.max(10, w); // safety
    const lines: string[] = [];
    for (const raw of txt.split(/\r?\n/)) {
      let cur = raw;
      while (cur.length > width) {
        lines.push(cur.slice(0, width));
        cur = cur.slice(width);
      }
      lines.push(cur);
    }
    return lines;
  };

  // Use debounced search to prevent flickering
  const {
    query: localSearchQuery,
    setQuery: setLocalSearchQuery,
    debouncedQuery,
    isSearching
  } = useSearch({
    debounceMs: 300 // Increased for more stability
  });

  // Keep previous results visible until new ones load to prevent content jumping
  const [displayResults, setDisplayResults] = useState<SearchResult[]>([]);
  const [isFirstSearch, setIsFirstSearch] = useState(true);

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messages.length > 0) {
      setLineScrollOffset(0); // Reset to show latest messages
    }
  }, [messages, autoScroll]);

  // Handle sending chat messages
  const handleSendMessage = async (message: string) => {
    if (!chatService || isChatLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsChatLoading(true);
    setChatError(null);
    setAutoScroll(true); // Enable auto-scroll when sending message

    try {
      const response = await chatService.generateResponse(message);
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: response.content,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Chat failed');
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: 'Sorry, I encountered an error while processing your message.',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Sync local search query with parent when search query changes from parent
  useEffect(() => {
    if (mode === 'search' && searchQuery !== localSearchQuery) {
      setLocalSearchQuery(searchQuery);
    }
  }, [searchQuery, localSearchQuery, setLocalSearchQuery, mode]);

  // Handle keyboard input for search and chat
  useInput((inputChar, key) => {
    if (!focused) return;
    
    if (mode === 'search') {
      // Handle search result navigation
      if (displayResults.length > 0) {
        if (inputChar === 'j' || key.downArrow) {
          setSelectedResultIndex(prev => Math.min(prev + 1, displayResults.length - 1));
          return;
        }
        if (inputChar === 'k' || key.upArrow) {
          setSelectedResultIndex(prev => Math.max(prev - 1, 0));
          return;
        }
        if (key.return && displayResults[selectedResultIndex]) {
          onSelectFile?.(displayResults[selectedResultIndex].path);
          return;
        }
      }
      
      // Handle search input
      if (key.backspace || key.delete) {
        const newQuery = localSearchQuery.slice(0, -1);
        setLocalSearchQuery(newQuery);
        onSearchUpdate?.(newQuery);
      } else if (inputChar && inputChar.length === 1 && !key.ctrl && !key.meta) {
        // Regular character input
        const newQuery = localSearchQuery + inputChar;
        setLocalSearchQuery(newQuery);
        onSearchUpdate?.(newQuery);
      }
    } else if (mode === 'chat') {
      // Handle chat scrolling
      if ((inputChar === 'j' || key.downArrow) && messages.length > 0) {
        setAutoScroll(false);
        setLineScrollOffset(prev => prev + 1);
        return;
      }
      if ((inputChar === 'k' || key.upArrow) && messages.length > 0) {
        setLineScrollOffset(prev => {
          const newOffset = Math.max(prev - 1, 0);
          if (newOffset === 0) setAutoScroll(true); // Re-enable auto-scroll when back at bottom
          return newOffset;
        });
        return;
      }
      
      // Handle chat input (similar logic)
      if (key.backspace || key.delete) {
        const newInput = input.slice(0, -1);
        onInputUpdate?.(newInput);
      } else if (key.return && input.trim()) {
        // Send the message when Enter is pressed
        handleSendMessage(input.trim());
        onInputUpdate?.(''); // Clear input
      } else if (inputChar && inputChar.length === 1 && !key.ctrl && !key.meta) {
        const newInput = input + inputChar;
        onInputUpdate?.(newInput);
      }
    }
  });

  // Reset selected result when display results change
  useEffect(() => {
    setSelectedResultIndex(0);
  }, [displayResults]);

  // Initialize services
  useEffect(() => {
    const initializeServices = async () => {
      try {
        const config = await ConfigManager.load();
        const dbManager = new DatabaseManager(config);
        await dbManager.initialize();
        const aiManager = new AIProviderManager(config);
        
        // Initialize search service
        const searchSvc = new SemanticSearchService(dbManager, aiManager);
        setSearchService(searchSvc);

        // Initialize chat service
        const ragContextService = new RAGContextService(searchSvc);
        const chatSvc = new RAGChatService(aiManager, ragContextService);
        setChatService(chatSvc);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to initialize services';
        setSearchError(errorMsg);
        setChatError(errorMsg);
      }
    };

    initializeServices();
  }, []);

  // Handle search when in search mode - use debounced query to prevent flickering
  useEffect(() => {
    const performSearch = async () => {
      if (mode === 'search' && debouncedQuery && searchService) {
        setSearchError(null);
        try {
          const results = await searchService.searchSemantic(debouncedQuery, {
            limit: 10,
            includeContent: true
          });
          setSearchResults(results);
          setDisplayResults(results); // Update display results only after successful search
          if (isFirstSearch) {
            setIsFirstSearch(false);
          }
        } catch (error) {
          setSearchError(error instanceof Error ? error.message : 'Search failed');
          // Don't clear display results on error - keep previous results visible
        }
      } else if (mode !== 'search') {
        setSearchResults([]);
        setDisplayResults([]);
        setIsFirstSearch(true);
      } else if (mode === 'search' && !debouncedQuery) {
        // Clear results only when query is empty, not while typing
        setSearchResults([]);
        setDisplayResults([]);
      }
    };

    performSearch();
  }, [mode, debouncedQuery, searchService, isFirstSearch]);

  const maxDisplayHeight = height - 4; // Account for borders and header
  const chatViewHeight = maxDisplayHeight - 3; // Available height for chat messages

  // Compute all display lines with proper wrapping
  const allLines = useMemo(() => {
    const availWidth = width - 4; // account for borders/padding/icons
    const lines: { key: string; type: Message['type']; text: string }[] = [];
    messages.forEach(m => {
      const icon = m.type === 'user' ? '👤 ' : '🤖 ';
      const wrapped = wrapText(m.content, availWidth - icon.length);
      wrapped.forEach((l, i) => {
        lines.push({
          key: `${m.id}:${i}`,
          type: m.type,
          text: (i === 0 ? icon : '   ') + l
        });
      });
      // Add spacer line after each message
      lines.push({ key: `${m.id}:spacer`, type: m.type, text: '' });
    });
    return lines;
  }, [messages, width]);

  // Auto-scroll and clamp offset when content changes
  useEffect(() => {
    if (autoScroll) {
      setLineScrollOffset(0);
    } else {
      // Clamp offset if content shrank
      const maxOffset = Math.max(0, allLines.length - chatViewHeight);
      setLineScrollOffset(o => Math.min(o, maxOffset));
    }
  }, [allLines, autoScroll, chatViewHeight]);

  // Calculate visible lines
  const maxOffset = Math.max(0, allLines.length - chatViewHeight);
  const clampedOffset = Math.min(lineScrollOffset, maxOffset);
  const start = Math.max(0, allLines.length - chatViewHeight - clampedOffset);
  const end = start + chatViewHeight;
  const visibleLines = allLines.slice(start, end);

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
          {/* Search query display - only show debounced query to minimize re-renders */}
          <Box height={1} marginBottom={1}>
            <Text>
              Query: <Text color="cyan">"{(debouncedQuery || localSearchQuery || '').slice(0, 18).padEnd(18, ' ')}"</Text>
            </Text>
          </Box>

           {/* Search results - Fixed height layout to prevent shifting */}
           <Box flexDirection="column" height={maxDisplayHeight - 3}>
             {/* Status line - always present to maintain consistent spacing */}
             <Box height={1} marginBottom={1}>
               {searchError ? (
                 <Text color="red">❌ {searchError}</Text>
               ) : isSearching ? (
                 <Text color="yellow">🔍 Searching...</Text>
               ) : localSearchQuery ? (
                 <Text dimColor>{displayResults.length} results</Text>
               ) : (
                 <Text dimColor>Start typing to search...</Text>
               )}
             </Box>

             {/* Results area - fixed height container */}
             <Box flexDirection="column" flexGrow={1}>
               {displayResults.length > 0 ? (
                 displayResults.slice(0, Math.floor((maxDisplayHeight - 4) / 2)).map((result, index) => {
                   const isSelected = index === selectedResultIndex;
                   return (
                     <Box key={result.id} height={2}>
                       <Box>
                         <Text 
                           color={isSelected ? 'black' : 'green'}
                           backgroundColor={isSelected ? 'cyan' : undefined}
                         >
                           📝 {result.title}
                         </Text>
                       </Box>
                       <Box>
                         <Text 
                           dimColor={!isSelected}
                           color={isSelected ? 'black' : undefined}
                           backgroundColor={isSelected ? 'cyan' : undefined}
                         >
                           {"   " + (result.snippet || '').slice(0, 40) + '...'}
                         </Text>
                       </Box>
                     </Box>
                   );
                 })
               ) : null}
             </Box>
           </Box>
        </Box>
      )}

      {/* Chat Mode */}
      {mode === 'chat' && (
        <Box flexDirection="column">
          {/* Chat messages */}
          <Box flexDirection="column" marginBottom={1} height={chatViewHeight}>
            {chatError ? (
              <Text color="red">❌ {chatError}</Text>
            ) : visibleLines.length === 0 ? (
              <Text dimColor>Start a conversation...</Text>
            ) : (
              visibleLines.map(line => (
                <Text key={line.key} color={line.type === 'user' ? 'green' : 'blue'}>
                  {line.text}
                </Text>
              ))
            )}

            {/* Loading indicator for chat */}
            {isChatLoading && (
              <Box marginBottom={1}>
                <Text color="yellow">🤖 Thinking...</Text>
              </Box>
            )}
          </Box>

          {/* Chat input area with scroll indicator */}
          <Box flexDirection="column">
            <Box borderStyle="single" borderColor="gray" paddingX={1}>
              <Text>
                💬 {input || 'Type your message...'}
                <Text color="cyan">│</Text>
              </Text>
            </Box>
            
            {/* Scroll indicator */}
            {allLines.length > chatViewHeight && (
              <Box justifyContent="center" marginTop={1}>
                <Text dimColor>
                  {autoScroll
                    ? '📍 Bottom'
                    : `📜 ${clampedOffset}↑ (${maxOffset - clampedOffset}↓)`}
                </Text>
              </Box>
            )}
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
mode === 'chat' ? 
                 (allLines.length > chatViewHeight ? 
                   'Type message • Enter: Send • j/k: Scroll • Esc: Exit' : 
                   'Type message • Enter: Send • Esc: Exit') :
               'Ctrl+F: Search • Ctrl+A: Chat'}
            </Text>
          </Box>
        )}
    </Box>
  );
}