/**
 * Metadata management utilities for notes
 */



export interface NoteMetadata {
  title: string;
  created: string;
  updated?: string;
  tags: string[];
  status?: 'draft' | 'published' | 'archived';
  [key: string]: any;
}

export class MetadataManager {
  /**
   * Update frontmatter in a note file
   */
  async updateNoteFrontmatter(notePath: string, updates: Partial<NoteMetadata>): Promise<void> {
    const matter = await import('gray-matter');
    
    // Read current file
    const content = await Bun.file(notePath).text();
    const parsed = matter.default(content);
    
    // Merge updates with existing frontmatter
    const updatedData = {
      ...parsed.data,
      ...updates,
      updated: new Date().toISOString(), // Always update the timestamp
    };
    
    // Reconstruct the file with updated frontmatter
    const updatedContent = matter.default.stringify(parsed.content, updatedData);
    
    // Write back to file
    await Bun.write(notePath, updatedContent);
  }
  
  /**
   * Add tags to a note
   */
  async addTags(notePath: string, newTags: string[]): Promise<void> {
    const matter = await import('gray-matter');
    
    const content = await Bun.file(notePath).text();
    const parsed = matter.default(content);
    
    const currentTags = parsed.data.tags || [];
    const updatedTags = [...new Set([...currentTags, ...newTags])];
    
    await this.updateNoteFrontmatter(notePath, { tags: updatedTags });
  }
  
  /**
   * Remove tags from a note
   */
  async removeTags(notePath: string, tagsToRemove: string[]): Promise<void> {
    const matter = await import('gray-matter');
    
    const content = await Bun.file(notePath).text();
    const parsed = matter.default(content);
    
    const currentTags = parsed.data.tags || [];
    const updatedTags = currentTags.filter((tag: string) => !tagsToRemove.includes(tag));
    
    await this.updateNoteFrontmatter(notePath, { tags: updatedTags });
  }
  
  /**
   * Get all unique tags from notes in a directory
   */
  async getAllTags(notesPath: string): Promise<string[]> {
    const { readdir } = await import('fs/promises');
    const { join } = await import('path');
    const matter = await import('gray-matter');
    
    try {
      const files = await readdir(notesPath);
      const markdownFiles = files.filter(file => file.endsWith('.md'));
      
      const allTags = new Set<string>();
      
      for (const file of markdownFiles) {
        const filePath = join(notesPath, file);
        const content = await Bun.file(filePath).text();
        const parsed = matter.default(content);
        
        const tags = parsed.data.tags || [];
        tags.forEach((tag: string) => allTags.add(tag));
      }
      
      return Array.from(allTags).sort();
    } catch (error) {
      console.warn('Error getting tags:', error);
      return [];
    }
  }
  
  /**
   * Find notes by tag
   */
  async findNotesByTag(notesPath: string, tag: string): Promise<string[]> {
    const { readdir } = await import('fs/promises');
    const { join } = await import('path');
    const matter = await import('gray-matter');
    
    try {
      const files = await readdir(notesPath);
      const markdownFiles = files.filter(file => file.endsWith('.md'));
      
      const matchingFiles: string[] = [];
      
      for (const file of markdownFiles) {
        const filePath = join(notesPath, file);
        const content = await Bun.file(filePath).text();
        const parsed = matter.default(content);
        
        const tags = parsed.data.tags || [];
        if (tags.includes(tag)) {
          matchingFiles.push(filePath);
        }
      }
      
      return matchingFiles;
    } catch (error) {
      console.warn('Error finding notes by tag:', error);
      return [];
    }
  }
  
  /**
   * Update note status
   */
  async updateNoteStatus(notePath: string, status: 'draft' | 'published' | 'archived'): Promise<void> {
    await this.updateNoteFrontmatter(notePath, { status });
  }
  
  /**
   * Get note statistics
   */
  async getNoteStats(notesPath: string): Promise<{
    totalNotes: number;
    tagCount: number;
    statusBreakdown: Record<string, number>;
    recentlyUpdated: number; // Notes updated in last 7 days
  }> {
    const { readdir } = await import('fs/promises');
    const { join } = await import('path');
    const matter = await import('gray-matter');
    
    try {
      const files = await readdir(notesPath);
      const markdownFiles = files.filter(file => file.endsWith('.md'));
      
      const allTags = new Set<string>();
      const statusBreakdown: Record<string, number> = {};
      let recentlyUpdated = 0;
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      for (const file of markdownFiles) {
        const filePath = join(notesPath, file);
        const content = await Bun.file(filePath).text();
        const parsed = matter.default(content);
        
        // Count tags
        const tags = parsed.data.tags || [];
        tags.forEach((tag: string) => allTags.add(tag));
        
        // Count status
        const status = parsed.data.status || 'draft';
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
        
        // Count recently updated
        const updated = parsed.data.updated || parsed.data.created;
        if (updated && new Date(updated) > oneWeekAgo) {
          recentlyUpdated++;
        }
      }
      
      return {
        totalNotes: markdownFiles.length,
        tagCount: allTags.size,
        statusBreakdown,
        recentlyUpdated
      };
    } catch (error) {
      console.warn('Error getting note stats:', error);
      return {
        totalNotes: 0,
        tagCount: 0,
        statusBreakdown: {},
        recentlyUpdated: 0
      };
    }
  }
}