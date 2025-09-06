/**
 * File operations for note management
 */

import { spawn } from 'child_process';
import { basename, join, dirname } from 'path';
import { readdir, stat, unlink } from 'fs/promises';

export class FileOperations {
  /**
   * Open a file in the user's preferred editor
   */
  async openInEditor(filePath: string, editor?: string): Promise<void> {
    const editorCommand = editor || process.env.EDITOR || process.env.VISUAL || 'nano';
    
    return new Promise((resolve, reject) => {
      const child = spawn(editorCommand, [filePath], {
        stdio: 'inherit',
        shell: true
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Editor exited with code ${code}`));
        }
      });
      
      child.on('error', reject);
    });
  }
  
  /**
   * Get file information
   */
  async getFileInfo(filePath: string): Promise<{
    size: number;
    created: Date;
    modified: Date;
    name: string;
    directory: string;
  }> {
    const stats = await stat(filePath);
    
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      name: basename(filePath),
      directory: dirname(filePath)
    };
  }
  
  /**
   * List all note files in a directory
   */
  async listNoteFiles(directory: string): Promise<string[]> {
    try {
      const files = await readdir(directory);
      return files
        .filter(file => file.endsWith('.md'))
        .map(file => join(directory, file));
    } catch (error) {
      console.warn('Error listing note files:', error);
      return [];
    }
  }
  
  /**
   * Delete a note file with confirmation
   */
  async deleteNote(filePath: string, force: boolean = false): Promise<boolean> {
    if (!force) {
      // In a real implementation, this would prompt the user
      // For now, we'll require the force flag
      throw new Error('Delete operation requires confirmation. Use force flag if certain.');
    }
    
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      console.warn('Error deleting note:', error);
      return false;
    }
  }
  
  /**
   * Create a backup of a note
   */
  async backupNote(filePath: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.backup.${timestamp}`;
    
    const content = await Bun.file(filePath).text();
    await Bun.write(backupPath, content);
    
    return backupPath;
  }
  
  /**
   * Watch a file for changes
   */
  async watchFile(filePath: string, callback: (event: string) => void): Promise<() => void> {
    const chokidar = await import('chokidar');
    
    const watcher = chokidar.watch(filePath, {
      persistent: true,
      ignoreInitial: true
    });
    
    watcher.on('change', () => callback('change'));
    watcher.on('unlink', () => callback('delete'));
    
    // Return cleanup function
    return () => watcher.close();
  }
  
  /**
   * Get word count and reading time for a note
   */
  async getReadingStats(filePath: string): Promise<{
    wordCount: number;
    characterCount: number;
    readingTimeMinutes: number;
  }> {
    const matter = await import('gray-matter');
    const content = await Bun.file(filePath).text();
    const parsed = matter.default(content);
    
    // Remove markdown formatting for word count
    const plainText = parsed.content
      .replace(/[#*`_~]/g, '') // Remove markdown formatting
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to just text
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim();
    
    const words = plainText.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    const characterCount = plainText.length;
    
    // Average reading speed is 200-250 words per minute
    const readingTimeMinutes = Math.ceil(wordCount / 225);
    
    return {
      wordCount,
      characterCount,
      readingTimeMinutes
    };
  }
  
  /**
   * Ensure directory exists and is writable
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await Bun.write(join(dirPath, '.gitkeep'), '');
    } catch (error) {
      throw new Error(`Cannot write to directory: ${dirPath}`);
    }
  }
}