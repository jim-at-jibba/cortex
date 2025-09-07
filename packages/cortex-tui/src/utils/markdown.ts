/**
 * Markdown Utilities
 * Simple terminal-friendly markdown rendering with syntax highlighting
 */

import chalk from 'chalk';

// Simple markdown parser for terminal display
export async function renderMarkdown(content: string): Promise<string> {
  try {
    const lines = content.split('\n');
    const rendered: string[] = [];
    
    let inCodeBlock = false;
    let codeBlockLanguage = '';
    
    for (const line of lines) {
      // Handle code blocks
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          rendered.push(chalk.gray('```'));
          inCodeBlock = false;
          codeBlockLanguage = '';
        } else {
          codeBlockLanguage = line.substring(3).trim();
          rendered.push(chalk.gray('```') + (codeBlockLanguage ? ` ${codeBlockLanguage}` : ''));
          inCodeBlock = true;
        }
        continue;
      }
      
      // Handle code block content
      if (inCodeBlock) {
        rendered.push(highlightCode(line, codeBlockLanguage));
        continue;
      }
      
      // Handle headings
      if (line.startsWith('#')) {
        const level = line.match(/^#+/)?.[0].length || 1;
        const text = line.substring(level).trim();
        const colors = [chalk.red.bold, chalk.yellow.bold, chalk.green.bold, chalk.cyan.bold, chalk.blue.bold, chalk.magenta.bold];
        const color = colors[Math.min(level - 1, colors.length - 1)] || chalk.white;
        rendered.push('');
        rendered.push(color('#'.repeat(level) + ' ' + text));
        rendered.push('');
        continue;
      }
      
      // Handle lists
      if (line.match(/^\s*[-*+]\s/)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const content = line.replace(/^\s*[-*+]\s/, '');
        rendered.push(indent + '• ' + processInlineMarkdown(content));
        continue;
      }
      
      // Handle ordered lists
      if (line.match(/^\s*\d+\.\s/)) {
        const indent = line.match(/^\s*/)?.[0] || '';
        const number = line.match(/^\s*(\d+)\./)?.[1] || '1';
        const content = line.replace(/^\s*\d+\.\s/, '');
        rendered.push(indent + number + '. ' + processInlineMarkdown(content));
        continue;
      }
      
      // Handle blockquotes
      if (line.startsWith('>')) {
        const content = line.substring(1).trim();
        rendered.push(chalk.gray('│ ') + processInlineMarkdown(content));
        continue;
      }
      
      // Handle horizontal rules
      if (line.match(/^---+$/)) {
        rendered.push(chalk.gray('─'.repeat(50)));
        continue;
      }
      
      // Handle regular paragraphs
      if (line.trim() === '') {
        rendered.push('');
      } else {
        rendered.push(processInlineMarkdown(line));
      }
    }
    
    return rendered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    
  } catch (error) {
    return chalk.red(`Error rendering markdown: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Process inline markdown formatting
function processInlineMarkdown(text: string): string {
  return text
    // Bold text
    .replace(/\*\*([^*]+)\*\*/g, chalk.bold('$1'))
    .replace(/__([^_]+)__/g, chalk.bold('$1'))
    // Italic text
    .replace(/\*([^*]+)\*/g, chalk.italic('$1'))
    .replace(/_([^_]+)_/g, chalk.italic('$1'))
    // Inline code
    .replace(/`([^`]+)`/g, chalk.bgGray.black(' $1 '))
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, chalk.underline.blue('$1') + chalk.gray(' ($2)'))
    // Strikethrough
    .replace(/~~([^~]+)~~/g, chalk.strikethrough('$1'));
}

// Basic syntax highlighting for code blocks
function highlightCode(code: string, language?: string): string {
  if (!language) {
    return chalk.gray(code);
  }

  switch (language.toLowerCase()) {
    case 'javascript':
    case 'js':
    case 'typescript':
    case 'ts':
      return highlightJavaScript(code);
    
    case 'python':
    case 'py':
      return highlightPython(code);
    
    case 'bash':
    case 'shell':
    case 'sh':
      return highlightBash(code);
    
    case 'json':
      return highlightJSON(code);
    
    default:
      return chalk.gray(code);
  }
}

function highlightJavaScript(code: string): string {
  return code
    .replace(/\b(function|const|let|var|if|else|for|while|return|import|export|class|extends|async|await)\b/g, chalk.blue('$1'))
    .replace(/\b(true|false|null|undefined)\b/g, chalk.yellow('$1'))
    .replace(/"([^"]*)"/g, chalk.green('"$1"'))
    .replace(/'([^']*)'/g, chalk.green("'$1'"))
    .replace(/`([^`]*)`/g, chalk.green('`$1`'))
    .replace(/\/\/.*$/g, chalk.gray('$&'));
}

function highlightPython(code: string): string {
  return code
    .replace(/\b(def|class|import|from|if|elif|else|for|while|return|try|except|finally|with|as)\b/g, chalk.blue('$1'))
    .replace(/\b(True|False|None)\b/g, chalk.yellow('$1'))
    .replace(/"([^"]*)"/g, chalk.green('"$1"'))
    .replace(/'([^']*)'/g, chalk.green("'$1'"))
    .replace(/#.*$/g, chalk.gray('$&'));
}

function highlightBash(code: string): string {
  return code
    .replace(/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function)\b/g, chalk.blue('$1'))
    .replace(/\$\w+/g, chalk.yellow('$&'))
    .replace(/"([^"]*)"/g, chalk.green('"$1"'))
    .replace(/'([^']*)'/g, chalk.green("'$1'"))
    .replace(/#.*$/g, chalk.gray('$&'));
}

function highlightJSON(code: string): string {
  try {
    const parsed = JSON.parse(code);
    return JSON.stringify(parsed, null, 2)
      .replace(/"([^"]+)":/g, chalk.blue('"$1"') + ':')
      .replace(/: "([^"]*)"/g, ': ' + chalk.green('"$1"'))
      .replace(/: (\d+)/g, ': ' + chalk.yellow('$1'))
      .replace(/: (true|false|null)/g, ': ' + chalk.yellow('$1'));
  } catch {
    return chalk.gray(code);
  }
}

// Utility function to strip ANSI codes for length calculation
export function stripAnsiCodes(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Utility function to wrap text with ANSI codes preserved
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const textLines = text.split('\n');
  
  for (const line of textLines) {
    if (stripAnsiCodes(line).length <= width) {
      lines.push(line);
    } else {
      // Simple word wrapping that preserves ANSI codes
      const words = line.split(' ');
      let currentLine = '';
      
      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (stripAnsiCodes(testLine).length <= width) {
          currentLine = testLine;
        } else {
          if (currentLine) {
            lines.push(currentLine);
          }
          currentLine = word;
        }
      }
      
      if (currentLine) {
        lines.push(currentLine);
      }
    }
  }
  
  return lines;
}