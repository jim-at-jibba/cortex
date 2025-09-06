/**
 * Utility functions for file and directory operations
 */

import { mkdir } from 'fs/promises';
import { dirname } from 'path';

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Ensure the parent directory of a file exists
 */
export async function ensureParentDir(filePath: string): Promise<void> {
  await ensureDir(dirname(filePath));
}

/**
 * Sanitize a string to be safe for use as a filename
 */
export function sanitizeFilename(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/^-|-$/g, '');
}

/**
 * Generate a timestamp-based filename
 */
export function generateTimestampFilename(title: string): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const sanitizedTitle = sanitizeFilename(title);
  return `${timestamp}-${sanitizedTitle}.md`;
}