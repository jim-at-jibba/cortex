/**
 * Error Boundary System for CLI Commands
 * Provides standardized error handling, categorization, and recovery suggestions
 */

export enum ErrorCategory {
  NETWORK = 'network',
  PERMISSION = 'permission',
  CONFIGURATION = 'configuration',
  FILE_SYSTEM = 'file_system',
  AI_SERVICE = 'ai_service',
  DATABASE = 'database',
  VALIDATION = 'validation',
  UNKNOWN = 'unknown'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ErrorContext {
  command?: string;
  operation?: string;
  filePath?: string;
  additionalInfo?: Record<string, any>;
}

export interface RecoverySuggestion {
  action: string;
  description: string;
  command?: string;
}

export interface CLIError extends Error {
  category: ErrorCategory;
  severity: ErrorSeverity;
  context?: ErrorContext;
  recoverySuggestions: RecoverySuggestion[];
  exitCode: number;
  originalError?: Error;
}

export class ErrorBoundary {
  private debugMode: boolean = false;
  private errorHandlers: Map<ErrorCategory, (error: CLIError) => void> = new Map();

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode;
    this.setupDefaultHandlers();
  }

  /**
   * Enable or disable debug mode
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  /**
   * Wrap a command execution with error boundary
   */
  async executeCommand<T>(
    command: string,
    operation: () => Promise<T>,
    context?: ErrorContext
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const cliError = this.normalizeError(error, command, context);
      this.handleError(cliError);
      throw cliError; // Re-throw for caller to handle exit
    }
  }

  /**
   * Wrap a synchronous command execution with error boundary
   */
  executeCommandSync<T>(
    command: string,
    operation: () => T,
    context?: ErrorContext
  ): T {
    try {
      return operation();
    } catch (error) {
      const cliError = this.normalizeError(error, command, context);
      this.handleError(cliError);
      throw cliError; // Re-throw for caller to handle exit
    }
  }

  /**
   * Normalize any error into a CLIError
   */
  public normalizeError(
    error: unknown,
    command: string,
    context?: ErrorContext
  ): CLIError {
    const baseContext = { ...context, command };

    if (error instanceof Error) {
      // Handle specific error types
      if (this.isDatabaseError(error)) {
        return this.createCLIError(
          error.message,
          ErrorCategory.DATABASE,
          ErrorSeverity.HIGH,
          baseContext,
          error
        );
      }

      if (this.isConfigurationError(error)) {
        return this.createCLIError(
          error.message,
          ErrorCategory.CONFIGURATION,
          ErrorSeverity.MEDIUM,
          baseContext,
          error
        );
      }

      if (this.isNetworkError(error)) {
        return this.createCLIError(
          error.message,
          ErrorCategory.NETWORK,
          ErrorSeverity.MEDIUM,
          baseContext,
          error
        );
      }

      if (this.isPermissionError(error)) {
        return this.createCLIError(
          error.message,
          ErrorCategory.PERMISSION,
          ErrorSeverity.HIGH,
          baseContext,
          error
        );
      }

      if (this.isFileSystemError(error)) {
        return this.createCLIError(
          error.message,
          ErrorCategory.FILE_SYSTEM,
          ErrorSeverity.MEDIUM,
          baseContext,
          error
        );
      }

      if (this.isAIServiceError(error)) {
        return this.createCLIError(
          error.message,
          ErrorCategory.AI_SERVICE,
          ErrorSeverity.MEDIUM,
          baseContext,
          error
        );
      }

      if (this.isValidationError(error)) {
        return this.createCLIError(
          error.message,
          ErrorCategory.VALIDATION,
          ErrorSeverity.LOW,
          baseContext,
          error
        );
      }

      // Generic error
      return this.createCLIError(
        error.message,
        ErrorCategory.UNKNOWN,
        ErrorSeverity.MEDIUM,
        baseContext,
        error
      );
    }

    // Handle non-Error objects
    const errorMessage = typeof error === 'string' ? error : 'Unknown error occurred';
    return this.createCLIError(
      errorMessage,
      ErrorCategory.UNKNOWN,
      ErrorSeverity.MEDIUM,
      baseContext
    );
  }

  /**
   * Create a CLIError with appropriate recovery suggestions
   */
  private createCLIError(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    context?: ErrorContext,
    originalError?: Error
  ): CLIError {
    const recoverySuggestions = this.generateRecoverySuggestions(category, context);
    const exitCode = this.getExitCode(severity);

    const cliError: CLIError = {
      name: 'CLIError',
      message,
      category,
      severity,
      context,
      recoverySuggestions,
      exitCode,
      originalError,
      stack: originalError?.stack
    };

    return cliError;
  }

  /**
   * Handle an error with appropriate logging and user feedback
   */
  public handleError(error: CLIError): void {
    // Call category-specific handler if registered
    const handler = this.errorHandlers.get(error.category);
    if (handler) {
      handler(error);
    }

    // Display error to user
    this.displayError(error);

    // Log error details if in debug mode
    if (this.debugMode) {
      this.logErrorDetails(error);
    }
  }

  /**
   * Display error to user in a user-friendly format
   */
  private displayError(error: CLIError): void {
    const icon = this.getErrorIcon(error.severity);
    const categoryLabel = this.getCategoryLabel(error.category);
    
    console.error(`${icon} ${categoryLabel}: ${error.message}`);

    // Show recovery suggestions
    if (error.recoverySuggestions.length > 0) {
      console.error('\n💡 Recovery suggestions:');
      error.recoverySuggestions.forEach((suggestion, index) => {
        console.error(`   ${index + 1}. ${suggestion.description}`);
        if (suggestion.command) {
          console.error(`      Command: ${suggestion.command}`);
        }
      });
    }

    // Show context if available
    if (error.context && Object.keys(error.context).length > 0) {
      console.error('\n📍 Context:');
      Object.entries(error.context).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          console.error(`   ${key}: ${value}`);
        }
      });
    }

    // Show debug info if enabled
    if (this.debugMode && error.originalError) {
      console.error('\n🔍 Debug information:');
      console.error(`   Error type: ${error.originalError.constructor.name}`);
      if (error.originalError.stack) {
        console.error(`   Stack trace: ${error.originalError.stack.split('\n')[1]?.trim() || 'No stack trace'}`);
      }
    }
  }

  /**
   * Log detailed error information
   */
  private logErrorDetails(error: CLIError): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      category: error.category,
      severity: error.severity,
      message: error.message,
      context: error.context,
      originalError: error.originalError ? {
        name: error.originalError.name,
        message: error.originalError.message,
        stack: error.originalError.stack
      } : null
    };

    // In a real implementation, this would write to a log file
    // For now, we'll just log to stderr with debug prefix
    console.error(`[DEBUG] ${timestamp}: ${JSON.stringify(logEntry, null, 2)}`);
  }

  /**
   * Generate recovery suggestions based on error category
   */
  private generateRecoverySuggestions(category: ErrorCategory, context?: ErrorContext): RecoverySuggestion[] {
    const suggestions: RecoverySuggestion[] = [];

    switch (category) {
      case ErrorCategory.NETWORK:
        suggestions.push(
          {
            action: 'check_connection',
            description: 'Check your internet connection',
            command: 'ping google.com'
          },
          {
            action: 'check_api_keys',
            description: 'Verify your API keys are valid and not expired',
            command: 'cortex config --show'
          },
          {
            action: 'retry_later',
            description: 'Try again later - the service might be temporarily unavailable'
          }
        );
        break;

      case ErrorCategory.PERMISSION:
        suggestions.push(
          {
            action: 'check_permissions',
            description: 'Check file/directory permissions',
            command: 'ls -la'
          },
          {
            action: 'run_with_sudo',
            description: 'Try running with elevated privileges if needed',
            command: 'sudo cortex <command>'
          }
        );
        break;

      case ErrorCategory.CONFIGURATION:
        suggestions.push(
          {
            action: 'check_config',
            description: 'Verify your configuration file exists and is valid',
            command: 'cortex config --show'
          },
          {
            action: 'reset_config',
            description: 'Reset configuration to defaults if corrupted',
            command: 'cortex config --set key=value'
          },
          {
            action: 'check_env_vars',
            description: 'Check required environment variables are set',
            command: 'env | grep -E "(API_KEY|CORTEX)"'
          }
        );
        break;

      case ErrorCategory.FILE_SYSTEM:
        suggestions.push(
          {
            action: 'check_path',
            description: 'Verify the file path exists and is accessible',
            command: 'ls -la /path/to/file'
          },
          {
            action: 'check_disk_space',
            description: 'Check available disk space',
            command: 'df -h'
          },
          {
            action: 'create_directory',
            description: 'Create missing directories if needed',
            command: 'mkdir -p /path/to/directory'
          }
        );
        break;

      case ErrorCategory.AI_SERVICE:
        suggestions.push(
          {
            action: 'check_api_keys',
            description: 'Verify AI service API keys are configured',
            command: 'cortex config --show'
          },
          {
            action: 'test_ai_service',
            description: 'Test AI service connectivity',
            command: 'cortex chat --test'
          },
          {
            action: 'switch_provider',
            description: 'Try a different AI provider if available',
            command: 'cortex config --set aiProvider=ollama'
          }
        );
        break;

      case ErrorCategory.DATABASE:
        suggestions.push(
          {
            action: 'check_database_file',
            description: 'Verify database file exists and is not corrupted',
            command: 'ls -la ~/.cortex/*.db'
          },
          {
            action: 'rebuild_database',
            description: 'Rebuild database if corrupted',
            command: 'rm ~/.cortex/*.db && cortex embed --force'
          },
          {
            action: 'check_permissions',
            description: 'Check database file permissions',
            command: 'chmod 644 ~/.cortex/*.db'
          }
        );
        break;

      case ErrorCategory.VALIDATION:
        suggestions.push(
          {
            action: 'check_input',
            description: 'Verify your input parameters are correct',
            command: 'cortex <command> --help'
          },
          {
            action: 'check_format',
            description: 'Ensure file formats are supported',
            command: 'file /path/to/file'
          }
        );
        break;

      default:
        suggestions.push(
          {
            action: 'check_logs',
            description: 'Check application logs for more details',
            command: 'cortex daemon --logs'
          },
          {
            action: 'restart_application',
            description: 'Try restarting the application',
            command: 'cortex daemon --restart'
          },
          {
            action: 'get_help',
            description: 'Get help or report the issue',
            command: 'cortex --help'
          }
        );
    }

    return suggestions;
  }

  /**
   * Get appropriate exit code based on error severity
   */
  private getExitCode(severity: ErrorSeverity): number {
    switch (severity) {
      case ErrorSeverity.LOW:
        return 1;
      case ErrorSeverity.MEDIUM:
        return 2;
      case ErrorSeverity.HIGH:
        return 3;
      case ErrorSeverity.CRITICAL:
        return 4;
      default:
        return 1;
    }
  }

  /**
   * Get error icon based on severity
   */
  private getErrorIcon(severity: ErrorSeverity): string {
    switch (severity) {
      case ErrorSeverity.LOW:
        return '⚠️';
      case ErrorSeverity.MEDIUM:
        return '❌';
      case ErrorSeverity.HIGH:
        return '🚨';
      case ErrorSeverity.CRITICAL:
        return '💥';
      default:
        return '❌';
    }
  }

  /**
   * Get human-readable category label
   */
  private getCategoryLabel(category: ErrorCategory): string {
    switch (category) {
      case ErrorCategory.NETWORK:
        return 'Network Error';
      case ErrorCategory.PERMISSION:
        return 'Permission Error';
      case ErrorCategory.CONFIGURATION:
        return 'Configuration Error';
      case ErrorCategory.FILE_SYSTEM:
        return 'File System Error';
      case ErrorCategory.AI_SERVICE:
        return 'AI Service Error';
      case ErrorCategory.DATABASE:
        return 'Database Error';
      case ErrorCategory.VALIDATION:
        return 'Validation Error';
      default:
        return 'Unknown Error';
    }
  }

  /**
   * Error type detection methods
   */
  private isNetworkError(error: Error): boolean {
    return (
      error.name === 'NetworkError' ||
      error.name === 'FetchError' ||
      error.message.includes('network') ||
      error.message.includes('connection') ||
      error.message.includes('timeout') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND')
    );
  }

  private isPermissionError(error: Error): boolean {
    return (
      error.name === 'PermissionError' ||
      error.message.includes('permission') ||
      error.message.includes('denied') ||
      error.message.includes('EACCES') ||
      error.message.includes('EPERM')
    );
  }

  private isFileSystemError(error: Error): boolean {
    return (
      error.name === 'FileSystemError' ||
      error.message.includes('file') ||
      error.message.includes('directory') ||
      error.message.includes('ENOENT') ||
      error.message.includes('EISDIR') ||
      error.message.includes('ENOTDIR') ||
      error.message.includes('no such file')
    );
  }

  private isAIServiceError(error: Error): boolean {
    return (
      error.message.includes('api') ||
      error.message.includes('ai') ||
      error.message.includes('embedding') ||
      error.message.includes('openai') ||
      error.message.includes('anthropic') ||
      error.message.includes('ollama') ||
      error.message.includes('rate limit') ||
      error.message.includes('quota')
    );
  }

  private isDatabaseError(error: Error): boolean {
    return (
      error.message.includes('database') ||
      error.message.includes('sqlite') ||
      error.message.includes('constraint') ||
      error.message.includes('unique') ||
      error.message.includes('foreign key') ||
      (error.message.includes('db') && !error.message.includes('debug'))
    );
  }

  private isConfigurationError(error: Error): boolean {
    return (
      error.name === 'ConfigurationError' ||
      error.message.includes('config') ||
      error.message.includes('configuration') ||
      error.message.includes('settings') ||
      (error.message.includes('file not found') && error.message.toLowerCase().includes('config')) ||
      (error.message.includes('not found') && error.message.toLowerCase().includes('config'))
    );
  }

  private isValidationError(error: Error): boolean {
    return (
      error.name === 'ValidationError' ||
      error.message.includes('invalid') ||
      error.message.includes('required') ||
      error.message.includes('format') ||
      error.message.includes('schema') ||
      error.message.includes('validation')
    );
  }

  /**
   * Setup default error handlers for each category
   */
  private setupDefaultHandlers(): void {
    // Network errors - could trigger offline mode
    this.errorHandlers.set(ErrorCategory.NETWORK, (error) => {
      console.warn('Network error detected - consider enabling offline mode');
    });

    // Permission errors - could suggest permission fixes
    this.errorHandlers.set(ErrorCategory.PERMISSION, (error) => {
      console.warn('Permission error detected - check file and directory permissions');
    });

    // AI Service errors - could trigger fallback to local models
    this.errorHandlers.set(ErrorCategory.AI_SERVICE, (error) => {
      console.warn('AI service error detected - falling back to local search if available');
    });
  }

  /**
   * Register a custom error handler for a specific category
   */
  registerErrorHandler(category: ErrorCategory, handler: (error: CLIError) => void): void {
    this.errorHandlers.set(category, handler);
  }

  /**
   * Create a graceful exit handler
   */
  createGracefulExitHandler(): (error: CLIError) => never {
    return (error: CLIError) => {
      this.handleError(error);
      process.exit(error.exitCode);
    };
  }
}

/**
 * Global error boundary instance
 */
export const globalErrorBoundary = new ErrorBoundary();

/**
 * Decorator for wrapping command functions with error boundary
 */
export function withErrorBoundary(commandName: string, context?: ErrorContext) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const method = descriptor.value!;

    descriptor.value = (async function(this: any, ...args: any[]) {
      return await globalErrorBoundary.executeCommand(
        commandName,
        () => method.apply(this, args),
        context
      );
    }) as any;

    return descriptor;
  };
}

/**
 * Utility function to create error context
 */
export function createErrorContext(
  command: string,
  operation?: string,
  filePath?: string,
  additionalInfo?: Record<string, any>
): ErrorContext {
  return {
    command,
    operation,
    filePath,
    additionalInfo
  };
}