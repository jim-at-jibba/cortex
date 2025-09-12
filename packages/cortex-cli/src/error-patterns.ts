/**
 * Enhanced Error Boundary Patterns for CLI Commands
 * Extends the core error boundary with CLI-specific patterns and utilities
 */

import { 
  ErrorBoundary, 
  ErrorCategory, 
  ErrorSeverity, 
  createErrorContext 
} from 'cortex-core';
import type { CLIError, ErrorContext } from 'cortex-core';

/**
 * CLI-specific error patterns with enhanced context and recovery
 */
export interface CLIErrorPattern {
  category: ErrorCategory;
  patterns: string[];
  severity: ErrorSeverity;
  recoveryCommands: string[];
  userMessages: string[];
}

/**
 * Enhanced CLI error boundary with pattern matching
 */
export class CLIErrorBoundary extends ErrorBoundary {
  private errorPatterns: Map<ErrorCategory, CLIErrorPattern> = new Map();

  constructor(debugMode: boolean = false) {
    super(debugMode);
    this.setupErrorPatterns();
  }

  /**
   * Setup CLI-specific error patterns
   */
  private setupErrorPatterns(): void {
    // Network error patterns
    this.errorPatterns.set(ErrorCategory.NETWORK, {
      category: ErrorCategory.NETWORK,
      patterns: [
        'network',
        'connection',
        'timeout',
        'ECONNREFUSED',
        'ENOTFOUND',
        'fetch',
        'request',
        'offline'
      ],
      severity: ErrorSeverity.MEDIUM,
      recoveryCommands: [
        'ping google.com',
        'cortex config --show',
        'cortex daemon --status'
      ],
      userMessages: [
        'Check your internet connection',
        'Verify API keys are configured',
        'Try again when connection is stable'
      ]
    });

    // Permission error patterns
    this.errorPatterns.set(ErrorCategory.PERMISSION, {
      category: ErrorCategory.PERMISSION,
      patterns: [
        'permission',
        'denied',
        'EACCES',
        'EPERM',
        'unauthorized',
        'forbidden'
      ],
      severity: ErrorSeverity.HIGH,
      recoveryCommands: [
        'ls -la',
        'chmod 755 ~/.cortex',
        'sudo cortex <command>'
      ],
      userMessages: [
        'Check file and directory permissions',
        'Try running with elevated privileges',
        'Verify user has access to required files'
      ]
    });

    // Configuration error patterns
    this.errorPatterns.set(ErrorCategory.CONFIGURATION, {
      category: ErrorCategory.CONFIGURATION,
      patterns: [
        'config',
        'configuration',
        'settings',
        'not found',
        'invalid',
        'missing',
        'undefined'
      ],
      severity: ErrorSeverity.MEDIUM,
      recoveryCommands: [
        'cortex config --show',
        'cortex config --set key=value',
        'env | grep -E "(API_KEY|CORTEX)"'
      ],
      userMessages: [
        'Check your configuration file',
        'Verify all required settings are present',
        'Reset configuration if corrupted'
      ]
    });

    // File system error patterns
    this.errorPatterns.set(ErrorCategory.FILE_SYSTEM, {
      category: ErrorCategory.FILE_SYSTEM,
      patterns: [
        'file',
        'directory',
        'ENOENT',
        'EISDIR',
        'ENOTDIR',
        'no such file',
        'exists',
        'space'
      ],
      severity: ErrorSeverity.MEDIUM,
      recoveryCommands: [
        'ls -la',
        'df -h',
        'mkdir -p ~/.cortex',
        'file /path/to/file'
      ],
      userMessages: [
        'Verify file paths exist',
        'Check available disk space',
        'Create missing directories'
      ]
    });

    // AI service error patterns
    this.errorPatterns.set(ErrorCategory.AI_SERVICE, {
      category: ErrorCategory.AI_SERVICE,
      patterns: [
        'api',
        'ai',
        'embedding',
        'openai',
        'anthropic',
        'ollama',
        'rate limit',
        'quota',
        'token',
        'model'
      ],
      severity: ErrorSeverity.MEDIUM,
      recoveryCommands: [
        'cortex config --show',
        'cortex chat --test',
        'cortex config --set aiProvider=ollama'
      ],
      userMessages: [
        'Check AI service API keys',
        'Verify API quota and rate limits',
        'Try a different AI provider'
      ]
    });

    // Database error patterns
    this.errorPatterns.set(ErrorCategory.DATABASE, {
      category: ErrorCategory.DATABASE,
      patterns: [
        'database',
        'sqlite',
        'constraint',
        'unique',
        'foreign key',
        'db',
        'corrupt',
        'lock'
      ],
      severity: ErrorSeverity.HIGH,
      recoveryCommands: [
        'ls -la ~/.cortex/*.db',
        'rm ~/.cortex/*.db && cortex embed --force',
        'chmod 644 ~/.cortex/*.db'
      ],
      userMessages: [
        'Database file may be corrupted',
        'Try rebuilding the database',
        'Check database file permissions'
      ]
    });
  }

  /**
   * Enhanced error normalization with pattern matching
   */
  public normalizeErrorWithPatterns(
    error: unknown,
    command: string,
    context?: ErrorContext
  ): CLIError {
    // First, use the base normalization
    const baseError = this.normalizeError(error, command, context);

    // Then enhance with pattern matching
    const enhancedError = this.enhanceErrorWithPatterns(baseError);
    
    return enhancedError;
  }

  /**
   * Enhance error with pattern-specific information
   */
  private enhanceErrorWithPatterns(error: CLIError): CLIError {
    const pattern = this.findMatchingPattern(error);
    
    if (pattern) {
      // Enhance recovery suggestions with pattern-specific commands
      const enhancedRecovery = error.recoverySuggestions.map((suggestion, index) => {
        if (pattern.recoveryCommands[index]) {
          return {
            ...suggestion,
            command: pattern.recoveryCommands[index]
          };
        }
        return suggestion;
      });

      // Add pattern-specific user messages if needed
      if (pattern.userMessages.length > 0) {
        const additionalInfo = error.context?.additionalInfo || {};
        additionalInfo.patternMessages = pattern.userMessages;
        
        return {
          ...error,
          recoverySuggestions: enhancedRecovery,
          context: {
            ...error.context,
            additionalInfo
          }
        };
      }
    }

    return error;
  }

  /**
   * Find matching error pattern
   */
  private findMatchingPattern(error: CLIError): CLIErrorPattern | null {
    const errorMessage = error.message.toLowerCase();
    
    for (const pattern of this.errorPatterns.values()) {
      const matches = pattern.patterns.some(patternStr => 
        errorMessage.includes(patternStr.toLowerCase())
      );
      
      if (matches) {
        return pattern;
      }
    }
    
    return null;
  }

  /**
   * Create a command-specific error context
   */
  public createCommandContext(
    command: string,
    operation: string,
    args: string[] = [],
    options: Record<string, any> = {}
  ): ErrorContext {
    return createErrorContext(
      command,
      operation,
      undefined,
      {
        args,
        options,
        timestamp: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version
      }
    );
  }

  /**
   * Execute command with enhanced error handling
   */
  async executeWithEnhancedHandling<T>(
    command: string,
    operation: string,
    args: string[],
    options: Record<string, any>,
    fn: () => Promise<T>
  ): Promise<T> {
    const context = this.createCommandContext(command, operation, args, options);
    
    try {
      return await fn();
    } catch (error) {
      const enhancedError = this.normalizeErrorWithPatterns(error, command, context);
      this.handleError(enhancedError);
      throw enhancedError;
    }
  }

  /**
   * Get error statistics and patterns
   */
  public getErrorStats(): Record<string, any> {
    return {
      availablePatterns: Array.from(this.errorPatterns.keys()).map(key => ({
        category: key,
        patterns: this.errorPatterns.get(key)?.patterns || []
      })),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Global CLI error boundary instance
 */
export const globalCLIErrorBoundary = new CLIErrorBoundary(
  process.env.CORTEX_DEBUG === 'true' || process.env.DEBUG === 'true'
);

/**
 * Decorator for enhanced error boundary handling
 */
export function withEnhancedErrorBoundary(
  commandName: string,
  operation?: string
) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const method = descriptor.value!;

    descriptor.value = (async function(this: any, ...args: any[]) {
      const [options, ...restArgs] = args;
      
      return await globalCLIErrorBoundary.executeWithEnhancedHandling(
        commandName,
        operation || propertyName,
        restArgs,
        options || {},
        () => method.apply(this, args)
      );
    }) as any;

    return descriptor;
  };
}

/**
 * Utility to create CLI-specific error suggestions
 */
export function createCLISuggestions(
  category: ErrorCategory,
  context?: ErrorContext
): Array<{action: string, description: string, command?: string}> {
  const suggestions: Array<{action: string, description: string, command?: string}> = [];
  
  // Add context-aware suggestions
  if (context?.command) {
    suggestions.push({
      action: 'check_help',
      description: `Get help for ${context.command} command`,
      command: `cortex ${context.command} --help`
    });
  }

  // Add category-specific suggestions
  switch (category) {
    case ErrorCategory.NETWORK:
      suggestions.push({
        action: 'check_daemon',
        description: 'Check if daemon is running for offline support',
        command: 'cortex daemon --status'
      });
      break;
      
    case ErrorCategory.CONFIGURATION:
      suggestions.push({
        action: 'validate_config',
        description: 'Validate configuration syntax',
        command: 'cortex config --show'
      });
      break;
      
    case ErrorCategory.AI_SERVICE:
      suggestions.push({
        action: 'test_connectivity',
        description: 'Test AI service connectivity',
        command: 'cortex chat --test'
      });
      break;
  }

  return suggestions;
}