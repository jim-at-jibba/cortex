/**
 * File Explorer Component
 * Left pane for browsing files and folders
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs/promises';
import path from 'path';

export interface FileExplorerProps {
  focused: boolean;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
  searchQuery: string;
  onSearchUpdate: (query: string) => void;
  searchMode: boolean;
  height: number;
}

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isMarkdown: boolean;
}

export function FileExplorer({
  focused,
  selectedFile,
  onSelectFile,
  searchQuery,
  searchMode,
  height
}: FileExplorerProps): JSX.Element {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState(process.cwd());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Load files from current directory
  useEffect(() => {
    const loadFiles = async () => {
      try {
        setError(null);
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        
        const fileItems: FileItem[] = [];
        
        // Add parent directory if not at root
        if (currentPath !== '/') {
          fileItems.push({
            name: '..',
            path: path.dirname(currentPath),
            isDirectory: true,
            isMarkdown: false
          });
        }

        // Process directory entries
        for (const entry of entries) {
          // Skip hidden files and directories
          if (entry.name.startsWith('.')) continue;
          
          const fullPath = path.join(currentPath, entry.name);
          const isMarkdown = entry.isFile() && (
            entry.name.endsWith('.md') || 
            entry.name.endsWith('.markdown')
          );

          fileItems.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            isMarkdown
          });
        }

        // Sort: directories first, then files, alphabetically
        fileItems.sort((a, b) => {
          if (a.name === '..') return -1;
          if (b.name === '..') return 1;
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });

        setFiles(fileItems);
        setSelectedIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load directory');
      }
    };

    loadFiles();
  }, [currentPath]);

  // Filter files based on search query
  const filteredFiles = useMemo(() => {
    if (!searchMode || !searchQuery) return files;
    
    return files.filter(file =>
      file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (file.isMarkdown && file.name.includes(searchQuery))
    );
  }, [files, searchMode, searchQuery]);

  // Handle file/directory selection
  const handleSelect = (file: FileItem) => {
    if (file.isDirectory) {
      setCurrentPath(file.path);
    } else if (file.isMarkdown) {
      onSelectFile(file.path);
    }
  };

  // Get display items for current view
  const displayFiles = filteredFiles;
  const maxDisplayHeight = height - 4; // Account for borders and title

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={focused ? 'cyan' : 'gray'}>
          📁 Files {searchMode ? `(search: "${searchQuery}")` : ''}
        </Text>
      </Box>

      {/* Current path */}
      <Box marginBottom={1}>
        <Text dimColor>{path.relative(process.cwd(), currentPath) || '.'}</Text>
      </Box>

      {/* Error display */}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">❌ {error}</Text>
        </Box>
      )}

      {/* File list */}
      <Box flexDirection="column">
        {displayFiles.length === 0 ? (
          <Text dimColor>
            {searchMode ? 'No matching files found' : 'No files in directory'}
          </Text>
        ) : (
          displayFiles.slice(0, maxDisplayHeight).map((file, index) => {
            const isSelected = index === selectedIndex && focused;
            const isCurrentFile = selectedFile === file.path;
            
            let icon = '📄';
            if (file.name === '..') icon = '⬆️';
            else if (file.isDirectory) icon = '📁';
            else if (file.isMarkdown) icon = '📝';

            return (
              <Box key={file.path} marginBottom={0}>
                <Text
                  color={
                    isSelected ? 'black' : 
                    isCurrentFile ? 'cyan' :
                    file.isMarkdown ? 'green' :
                    file.isDirectory ? 'blue' : 'white'
                  }
                  backgroundColor={isSelected ? 'cyan' : undefined}
                >
                  {icon} {file.name}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Status info */}
      {displayFiles.length > maxDisplayHeight && (
        <Box marginTop={1}>
          <Text dimColor>
            Showing {maxDisplayHeight} of {displayFiles.length} items
          </Text>
        </Box>
      )}

      {/* Help text when focused */}
      {focused && !searchMode && (
        <Box marginTop={1}>
          <Text dimColor>↑↓ Navigate • Enter: Select • Ctrl+F: Search</Text>
        </Box>
      )}
    </Box>
  );
}