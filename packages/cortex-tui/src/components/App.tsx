/**
 * Main App Component - Three Pane Layout
 */

import { useState, useCallback } from 'react';
import { Box, useStdout } from 'ink';
import { FileExplorer } from './FileExplorer';
import { PreviewPane } from './PreviewPane';
import { ChatPane } from './ChatPane';
import { StatusBar } from './StatusBar';
import { useKeyboard } from '../hooks/useKeyboard';

export type FocusedPane = 'files' | 'preview' | 'chat';
export type Mode = 'normal' | 'search' | 'chat';

export interface AppState {
  focusedPane: FocusedPane;
  mode: Mode;
  selectedFile: string | null;
  searchQuery: string;
  chatInput: string;
}

export function App(): JSX.Element {
  const { stdout } = useStdout();
  // Remove setRawMode as Ink handles this automatically
  
  const [state, setState] = useState<AppState>({
    focusedPane: 'files',
    mode: 'normal',
    selectedFile: null,
    searchQuery: '',
    chatInput: ''
  });

  // Handle pane switching
  const switchPane = useCallback((pane: FocusedPane) => {
    setState(prev => ({ ...prev, focusedPane: pane }));
  }, []);

  // Handle mode switching
  const switchMode = useCallback((mode: Mode) => {
    setState(prev => ({ ...prev, mode }));
  }, []);

  // Handle file selection
  const selectFile = useCallback((filePath: string) => {
    setState(prev => ({ ...prev, selectedFile: filePath }));
  }, []);

  // Handle search query update
  const updateSearch = useCallback((query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }));
  }, []);

  // Handle chat input update
  const updateChatInput = useCallback((input: string) => {
    setState(prev => ({ ...prev, chatInput: input }));
  }, []);

  // Initialize keyboard handling
  useKeyboard({
    onSwitchPane: switchPane,
    onSwitchMode: switchMode,
    focusedPane: state.focusedPane,
    mode: state.mode
  });

  const terminalWidth = stdout.columns || 80;
  const terminalHeight = (stdout.rows || 24) - 1; // Reserve space for status bar

  // Calculate pane widths (30% - 40% - 30%)
  const filesPaneWidth = Math.floor(terminalWidth * 0.3);
  const previewPaneWidth = Math.floor(terminalWidth * 0.4);
  const chatPaneWidth = terminalWidth - filesPaneWidth - previewPaneWidth;

  return (
    <Box flexDirection="column" height={terminalHeight + 1}>
      <Box flexGrow={1}>
        {/* File Explorer Pane */}
        <Box
          width={filesPaneWidth}
          borderStyle="single"
          borderColor={state.focusedPane === 'files' ? 'cyan' : 'gray'}
        >
          <FileExplorer
            focused={state.focusedPane === 'files'}
            selectedFile={state.selectedFile}
            onSelectFile={selectFile}
            searchQuery={state.mode === 'search' ? state.searchQuery : ''}
            onSearchUpdate={updateSearch}
            searchMode={state.mode === 'search'}
            height={terminalHeight}
          />
        </Box>

        {/* Preview Pane */}
        <Box
          width={previewPaneWidth}
          borderStyle="single"
          borderColor={state.focusedPane === 'preview' ? 'cyan' : 'gray'}
        >
          <PreviewPane
            focused={state.focusedPane === 'preview'}
            filePath={state.selectedFile}
            height={terminalHeight}
          />
        </Box>

        {/* Chat/Search Pane */}
        <Box
          width={chatPaneWidth}
          borderStyle="single"
          borderColor={state.focusedPane === 'chat' ? 'cyan' : 'gray'}
        >
          <ChatPane
            focused={state.focusedPane === 'chat'}
            mode={state.mode}
            input={state.chatInput}
            onInputUpdate={updateChatInput}
            searchQuery={state.searchQuery}
            onSearchUpdate={updateSearch}
            onSelectFile={selectFile}
            height={terminalHeight}
            width={chatPaneWidth}
          />
        </Box>
      </Box>

      {/* Status Bar */}
      <StatusBar
        focusedPane={state.focusedPane}
        mode={state.mode}
        selectedFile={state.selectedFile}
        searchQuery={state.searchQuery}
      />
    </Box>
  );
}