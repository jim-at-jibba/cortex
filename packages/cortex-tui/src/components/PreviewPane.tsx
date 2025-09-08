/**
 * Preview Pane Component
 * Center pane for displaying markdown content with syntax highlighting
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import fs from 'fs/promises';
import { renderMarkdown } from '../utils/markdown';

export interface PreviewPaneProps {
  focused: boolean;
  filePath: string | null;
  height: number;
}

export function PreviewPane({
  focused,
  filePath,
  height
}: PreviewPaneProps): JSX.Element {
  const [renderedContent, setRenderedContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Load file content when filePath changes
  useEffect(() => {
    const loadFile = async () => {
      if (!filePath) {
        setRenderedContent('');
        setError(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const fileContent = await fs.readFile(filePath, 'utf-8');
        
        // Render markdown content
        const rendered = await renderMarkdown(fileContent);
        setRenderedContent(rendered);
        setScrollOffset(0); // Reset scroll when loading new file
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
        setRenderedContent('');
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [filePath]);

  // Handle keyboard scrolling when focused
  useInput((input, key) => {
    if (!focused || !renderedContent) return;
    
    const lines = renderedContent.split('\n');
    const maxDisplayHeight = height - 4;
    const maxScroll = Math.max(0, lines.length - maxDisplayHeight);
    
    // Vim-style navigation
    if (input === 'j' || key.downArrow) {
      setScrollOffset(prev => Math.min(prev + 1, maxScroll));
      return;
    }
    
    if (input === 'k' || key.upArrow) {
      setScrollOffset(prev => Math.max(prev - 1, 0));
      return;
    }
    
    // Page scrolling
    if (key.pageDown || (key.ctrl && input === 'f')) {
      setScrollOffset(prev => Math.min(prev + maxDisplayHeight, maxScroll));
      return;
    }
    
    if (key.pageUp || (key.ctrl && input === 'b')) {
      setScrollOffset(prev => Math.max(prev - maxDisplayHeight, 0));
      return;
    }
    
    // Go to top/bottom
    if (input === 'g') {
      setScrollOffset(0);
      return;
    }
    
    if (input === 'G') {
      setScrollOffset(maxScroll);
      return;
    }
  });

  // Handle scrolling display
  const maxDisplayHeight = height - 4; // Account for borders and header
  const lines = renderedContent.split('\n');
  const displayLines = lines.slice(scrollOffset, scrollOffset + maxDisplayHeight);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={focused ? 'cyan' : 'gray'}>
          📄 Preview {filePath ? `- ${require('path').basename(filePath)}` : ''}
        </Text>
      </Box>

      {/* Loading state */}
      {loading && (
        <Box justifyContent="center" alignItems="center" flexGrow={1}>
          <Text color="yellow">⏳ Loading...</Text>
        </Box>
      )}

      {/* Error state */}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">❌ {error}</Text>
        </Box>
      )}

      {/* No file selected */}
      {!filePath && !loading && !error && (
        <Box justifyContent="center" alignItems="center" flexGrow={1}>
          <Text dimColor>Select a markdown file to preview</Text>
        </Box>
      )}

      {/* Content display */}
      {renderedContent && !loading && !error && (
        <Box flexDirection="column">
          {displayLines.map((line, index) => (
            <Text key={scrollOffset + index}>
              {line || ' '}
            </Text>
          ))}
          
          {/* Scroll indicator */}
          {lines.length > maxDisplayHeight && (
            <Box marginTop={1}>
              <Text dimColor>
                Showing lines {scrollOffset + 1}-{Math.min(scrollOffset + maxDisplayHeight, lines.length)} of {lines.length}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Help text when focused */}
      {focused && renderedContent && (
        <Box marginTop={1}>
          <Text dimColor>j/k: Scroll • g/G: Top/Bottom • Ctrl+f/b: Page scroll</Text>
        </Box>
      )}
    </Box>
  );
}