/**
 * Keyboard Hook
 * Handles vim-style keyboard navigation and shortcuts
 */

import { useInput } from 'ink';
import type { FocusedPane, Mode } from '../components/App';

export interface UseKeyboardOptions {
  onSwitchPane: (pane: FocusedPane) => void;
  onSwitchMode: (mode: Mode) => void;
  focusedPane: FocusedPane;
  mode: Mode;
}

export function useKeyboard({
  onSwitchPane,
  onSwitchMode,
  focusedPane,
  mode
}: UseKeyboardOptions): void {
  
  useInput((input, key) => {
    // Handle quit
    if (input === 'q' && mode === 'normal') {
      process.exit(0);
    }

    // Handle escape key - exit current mode
    if (key.escape) {
      if (mode !== 'normal') {
        onSwitchMode('normal');
      }
      return;
    }

    // Handle mode switches with Ctrl keys
    if (key.ctrl) {
      if (input === 'f') { // Ctrl+F for search
        onSwitchMode('search');
        onSwitchPane('files');
        return;
      }
      if (input === 'a') { // Ctrl+A for chat
        onSwitchMode('chat');
        onSwitchPane('chat');
        return;
      }
    }

    // Only handle navigation in normal mode
    if (mode !== 'normal') {
      return;
    }

    // Vim-style pane switching (h/l for horizontal movement)
    if (input === 'h') {
      // Move left
      if (focusedPane === 'preview') {
        onSwitchPane('files');
      } else if (focusedPane === 'chat') {
        onSwitchPane('preview');
      }
      return;
    }

    if (input === 'l') {
      // Move right
      if (focusedPane === 'files') {
        onSwitchPane('preview');
      } else if (focusedPane === 'preview') {
        onSwitchPane('chat');
      }
      return;
    }

    // Vim-style vertical navigation (j/k) would be handled by individual components
    // as they need to manage their own scroll state
    
    // Tab for cycling through panes
    if (key.tab) {
      const panes: FocusedPane[] = ['files', 'preview', 'chat'];
      const currentIndex = panes.indexOf(focusedPane);
      const nextIndex = (currentIndex + 1) % panes.length;
      const nextPane = panes[nextIndex];
      if (nextPane) {
        onSwitchPane(nextPane);
      }
      return;
    }

    // Arrow keys for pane switching
    if (key.leftArrow) {
      if (focusedPane === 'preview') {
        onSwitchPane('files');
      } else if (focusedPane === 'chat') {
        onSwitchPane('preview');
      }
      return;
    }

    if (key.rightArrow) {
      if (focusedPane === 'files') {
        onSwitchPane('preview');
      } else if (focusedPane === 'preview') {
        onSwitchPane('chat');
      }
      return;
    }
  });
}