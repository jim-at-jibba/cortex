/**
 * Status Bar Component
 * Bottom bar showing keyboard shortcuts and system status
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { FocusedPane, Mode } from './App';

export interface StatusBarProps {
  focusedPane: FocusedPane;
  mode: Mode;
  selectedFile: string | null;
  searchQuery: string;
}

export function StatusBar({
  focusedPane,
  mode,
  selectedFile,
  searchQuery
}: StatusBarProps): JSX.Element {
  // Get keyboard shortcuts based on current context
  const getShortcuts = () => {
    const shortcuts: string[] = [];
    
    if (mode === 'search') {
      shortcuts.push('Esc: Exit search', 'Enter: Select result');
    } else if (mode === 'chat') {
      shortcuts.push('Esc: Exit chat', 'Enter: Send message');
    } else {
      shortcuts.push('h/l: Switch panes', 'j/k: Navigate');
      if (focusedPane === 'files') {
        shortcuts.push('Enter: Select file', 'Ctrl+F: Search');
      } else if (focusedPane === 'preview') {
        shortcuts.push('↑↓: Scroll', 'PgUp/PgDn: Fast scroll');
      } else if (focusedPane === 'chat') {
        shortcuts.push('Ctrl+A: Start chat', 'Ctrl+F: Search');
      }
    }
    
    shortcuts.push('q: Quit');
    return shortcuts;
  };

  // Get current status
  const getStatus = () => {
    if (mode === 'search') {
      return `Search: "${searchQuery || '...'}"`;
    } else if (mode === 'chat') {
      return 'Chat Mode';
    } else if (selectedFile) {
      return `File: ${require('path').basename(selectedFile)}`;
    } else {
      return 'Ready';
    }
  };

  const shortcuts = getShortcuts();
  const status = getStatus();

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      {/* Left side - Status */}
      <Box>
        <Text>
          <Text color="cyan">[{focusedPane.toUpperCase()}]</Text>
          {' '}
          <Text color={mode === 'normal' ? 'white' : 'yellow'}>{status}</Text>
        </Text>
      </Box>

      {/* Center - Clock */}
      <Box>
        <Text dimColor>
          {new Date().toLocaleTimeString()}
        </Text>
      </Box>

      {/* Right side - Shortcuts */}
      <Box>
        <Text dimColor>
          {shortcuts.join(' • ')}
        </Text>
      </Box>
    </Box>
  );
}