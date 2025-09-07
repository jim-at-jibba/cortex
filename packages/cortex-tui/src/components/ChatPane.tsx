/**
 * Chat Pane Component
 * Right pane for chat interface and search results
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Mode } from './App';

export interface ChatPaneProps {
  focused: boolean;
  mode: Mode;
  input: string;
  onInputUpdate: (input: string) => void;
  searchQuery: string;
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
  searchQuery,
  height
}: ChatPaneProps): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<string[]>([]);

  // Handle search when in search mode
  useEffect(() => {
    if (mode === 'search' && searchQuery) {
      // Simulate search results (would integrate with cortex-core search)
      setSearchResults([
        `📝 notes/project-ideas.md - Found "${searchQuery}" in title`,
        `📝 docs/readme.md - Found "${searchQuery}" in content`,
        `📝 journal/daily-notes.md - Found "${searchQuery}" 3 times`
      ]);
    } else {
      setSearchResults([]);
    }
  }, [mode, searchQuery]);

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
            {searchQuery ? (
              searchResults.length > 0 ? (
                searchResults.slice(0, maxDisplayHeight - 2).map((result, index) => (
                  <Box key={index} marginBottom={0}>
                    <Text>{result}</Text>
                  </Box>
                ))
              ) : (
                <Text dimColor>No results found for "{searchQuery}"</Text>
              )
            ) : (
              <Text dimColor>Start typing to search...</Text>
            )}
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
            {mode === 'search' ? 'Type to search • Esc: Exit' :
             mode === 'chat' ? 'Type message • Enter: Send • Esc: Exit' :
             'Ctrl+F: Search • Ctrl+A: Chat'}
          </Text>
        </Box>
      )}
    </Box>
  );
}