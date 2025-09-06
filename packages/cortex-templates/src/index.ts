/**
 * Cortex Templates - Template system
 * Handles note templates and variable substitution
 */

import { join, basename } from 'path';
import { readdir } from 'fs/promises';

export interface Template {
  name: string;
  content: string;
  variables: string[];
}

export interface TemplateVariables {
  title?: string;
  date?: string;
  time?: string;
  timestamp?: string;
  author?: string;
  [key: string]: string | undefined;
}

export class TemplateManager {
  private templatesPath: string;

  constructor(templatesPath?: string) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    this.templatesPath = templatesPath || join(homeDir, '.cortex', 'templates');
  }

  async loadTemplates(): Promise<Template[]> {
    try {
      // Ensure templates directory exists
      await this.ensureTemplatesDirectory();
      
      // Get all template files
      const files = await readdir(this.templatesPath);
      const templateFiles = files.filter(file => file.endsWith('.md') || file.endsWith('.txt'));
      
      const templates: Template[] = [];
      for (const file of templateFiles) {
        const filePath = join(this.templatesPath, file);
        const content = await Bun.file(filePath).text();
        const name = basename(file, file.endsWith('.md') ? '.md' : '.txt');
        const variables = this.extractVariables(content);
        
        templates.push({
          name,
          content,
          variables
        });
      }
      
      return templates;
    } catch (error) {
      console.warn('Error loading templates:', error);
      return [];
    }
  }
  
  async renderTemplate(templateName: string, variables: TemplateVariables): Promise<string> {
    try {
      let templateContent: string;
      
      // Try to load from file first
      const templatePath = join(this.templatesPath, `${templateName}.md`);
      const templateFile = Bun.file(templatePath);
      
      if (await templateFile.exists()) {
        templateContent = await templateFile.text();
      } else {
        // Check for .txt extension
        const txtTemplatePath = join(this.templatesPath, `${templateName}.txt`);
        const txtTemplateFile = Bun.file(txtTemplatePath);
        
        if (await txtTemplateFile.exists()) {
          templateContent = await txtTemplateFile.text();
        } else {
          // Use built-in templates
          templateContent = this.getBuiltinTemplate(templateName);
        }
      }
      
      // Merge with default variables
      const allVariables: TemplateVariables = {
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toTimeString().slice(0, 5),
        timestamp: new Date().toISOString(),
        author: process.env.USER || process.env.USERNAME || 'Unknown',
        ...variables
      };
      
      // Replace variables in template
      return this.substituteVariables(templateContent, allVariables);
    } catch (error) {
      console.warn('Error rendering template:', error);
      return this.getBuiltinTemplate('default', variables);
    }
  }
  
  async createTemplate(name: string, content: string): Promise<void> {
    await this.ensureTemplatesDirectory();
    const templatePath = join(this.templatesPath, `${name}.md`);
    await Bun.write(templatePath, content);
  }
  
  private async ensureTemplatesDirectory(): Promise<void> {
    try {
      await Bun.write(join(this.templatesPath, '.gitkeep'), '');
      
      // Create default templates if they don't exist
      await this.createDefaultTemplates();
    } catch (error) {
      // Directory might not be writable, continue anyway
    }
  }
  
  private async createDefaultTemplates(): Promise<void> {
    const defaultTemplate = join(this.templatesPath, 'default.md');
    const dailyTemplate = join(this.templatesPath, 'daily.md');
    const meetingTemplate = join(this.templatesPath, 'meeting.md');
    
    // Default template
    if (!(await Bun.file(defaultTemplate).exists())) {
      await Bun.write(defaultTemplate, `---
title: "{{title}}"
created: {{timestamp}}
tags: []
---

# {{title}}

`);
    }
    
    // Daily template
    if (!(await Bun.file(dailyTemplate).exists())) {
      await Bun.write(dailyTemplate, `---
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
- 
`);
    }
    
    // Meeting template
    if (!(await Bun.file(meetingTemplate).exists())) {
      await Bun.write(meetingTemplate, `---
title: "{{title}}"
created: {{timestamp}}
tags: ["meeting"]
date: {{date}}
attendees: []
---

# {{title}}

**Date:** {{date}}  
**Time:** {{time}}  
**Attendees:** 

## Agenda


## Notes


## Action Items
- [ ] 

## Next Steps

`);
    }
  }
  
  private extractVariables(content: string): string[] {
    const matches = content.match(/\{\{([^}]+)\}\}/g);
    if (!matches) return [];
    
    return [...new Set(matches.map(match => match.slice(2, -2).trim()))];
  }
  
  private substituteVariables(template: string, variables: TemplateVariables): string {
    let result = template;
    
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined) {
        const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
        result = result.replace(regex, value);
      }
    }
    
    return result;
  }
  
  private getBuiltinTemplate(templateName: string, variables?: TemplateVariables): string {
    const defaults: TemplateVariables = {
      title: variables?.title || 'Untitled',
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toTimeString().slice(0, 5),
      timestamp: new Date().toISOString(),
      ...variables
    };
    
    switch (templateName) {
      case 'daily':
        return this.substituteVariables(`---
title: "Daily Note - {{date}}"
created: {{timestamp}}
tags: ["daily"]
date: {{date}}
---

# Daily Note - {{date}}

## Today's Plan
- 

## Notes

`, defaults);
        
      case 'meeting':
        return this.substituteVariables(`---
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

`, defaults);
        
      default:
        return this.substituteVariables(`---
title: "{{title}}"
created: {{timestamp}}
tags: []
---

# {{title}}

`, defaults);
    }
  }
}