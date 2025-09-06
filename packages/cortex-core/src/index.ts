/**
 * Cortex Core - Core functionality
 * Shared utilities, types, and business logic for Cortex note-taking system
 */

import type { CortexConfig } from './config.js';

// Core types
export interface Note {
  id: string;
  title: string;
  content: string;
  path: string;
  frontmatter: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

// Core utilities
export class NoteManager {
  constructor(private config: CortexConfig) {}
  
  async createNote(title: string, template?: string): Promise<Note> {
    const { ensureDir, generateTimestampFilename } = await import('./utils');
    const { basename, join, extname } = await import('path');
    
    // Ensure notes directory exists
    await ensureDir(this.config.notesPath);
    
    // Generate filename based on title and timestamp
    const filename = generateTimestampFilename(title);
    const notePath = join(this.config.notesPath, filename);
    
    // Load and render template if provided
    let content = '';
    if (template) {
      // Use built-in template rendering for now
      content = await this.renderBuiltinTemplate(template, {
        title,
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toTimeString().slice(0, 5),
        timestamp: new Date().toISOString(),
      });
    } else {
      // Default template
      content = `---
title: "${title}"
created: ${new Date().toISOString()}
tags: []
---

# ${title}

`;
    }
    
    // Write note to file
    await Bun.write(notePath, content);
    
    // Parse and return Note object
    const matter = await import('gray-matter');
    const parsed = matter.default(content);
    
    return {
      id: basename(notePath, extname(notePath)),
      title,
      content: parsed.content,
      path: notePath,
      frontmatter: parsed.data,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: parsed.data.tags || []
    };
  }
  
  private async renderBuiltinTemplate(templateName: string, variables: Record<string, string>): Promise<string> {
    let templateContent: string;
    
    switch (templateName) {
      case 'daily':
        templateContent = `---
title: "Daily Note - {{date}}"
created: {{timestamp}}
tags: ["daily"]
date: {{date}}
---

# Daily Note - {{date}}

## Today's Plan
- 

## Notes


## Reflections


## Tomorrow
- `;
        break;
        
      case 'meeting':
        templateContent = `---
title: "{{title}}"
created: {{timestamp}}
tags: ["meeting"]
date: {{date}}
---

# {{title}}

**Date:** {{date}}  
**Time:** {{time}}  

## Agenda


## Notes


## Action Items
- [ ] 

## Next Steps
`;
        break;
        
      default:
        templateContent = `---
title: "{{title}}"
created: {{timestamp}}
tags: []
---

# {{title}}

`;
    }
    
    // Replace variables
    let rendered = templateContent;
    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    
    return rendered;
  }
  
  async findNotes(query: string): Promise<Note[]> {
    const { readdir } = await import('fs/promises');
    const { join, basename, extname } = await import('path');
    const matter = await import('gray-matter');
    const Fuse = (await import('fuse.js')).default;
    
    try {
      // Get all markdown files
      const files = await readdir(this.config.notesPath);
      const markdownFiles = files.filter(file => file.endsWith('.md'));
      
      // Load and parse all notes
      const notes: Note[] = [];
      for (const file of markdownFiles) {
        const filePath = join(this.config.notesPath, file);
        const content = await Bun.file(filePath).text();
        const parsed = matter.default(content);
        
        notes.push({
          id: basename(file, extname(file)),
          title: parsed.data.title || basename(file, '.md'),
          content: parsed.content,
          path: filePath,
          frontmatter: parsed.data,
          createdAt: new Date(parsed.data.created || 0),
          updatedAt: new Date(parsed.data.updated || 0),
          tags: parsed.data.tags || []
        });
      }
      
      // If no query, return all notes sorted by created date (newest first)
      if (!query.trim()) {
        return notes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      
      // Use Fuse.js for fuzzy search
      const fuse = new Fuse(notes, {
        keys: ['title', 'content', 'tags'],
        threshold: 0.3,
        includeScore: true
      });
      
      const results = fuse.search(query);
      return results.map(result => result.item);
      
    } catch (error) {
      console.warn('Error searching notes:', error);
      return [];
    }
  }
}

// Export database manager
export { DatabaseManager } from './database.js';
export type { NoteRecord, EmbeddingRecord, MigrationRecord } from './database.js';

// Export AI service
export { AIProviderManager } from './ai-service.js';

// Export configuration management
export { ConfigManager } from './config.js';
export type { CortexConfig } from './config.js';

// Export metadata management
export { MetadataManager } from './metadata.js';
export type { NoteMetadata } from './metadata.js';

// Export file operations
export { FileOperations } from './file-operations.js';