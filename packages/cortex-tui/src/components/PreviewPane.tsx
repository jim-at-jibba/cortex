/**
 * Preview Pane Component
 * Center pane for displaying markdown content with syntax highlighting
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
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
  const [content, setContent] = useState<string>('');
  const [renderedContent, setRenderedContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Load file content when filePath changes
  useEffect(() => {
    const loadFile = async () => {
      if (!filePath) {
        setContent('');
        setRenderedContent('');
        setError(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const fileContent = await fs.readFile(filePath, 'utf-8');
        setContent(fileContent);
        
        // Render markdown content
        const rendered = await renderMarkdown(fileContent);
        setRenderedContent(rendered);
        setScrollOffset(0); // Reset scroll when loading new file
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
        setContent('');
        setRenderedContent('');
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [filePath]);

  // Handle scrolling (would be implemented with keyboard events)
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
          <Text dimColor>↑↓ Scroll • PgUp/PgDn: Fast scroll</Text>
        </Box>
      )}
    </Box>
  );
}