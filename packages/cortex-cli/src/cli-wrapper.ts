/**
 * CLI Command Wrapper with Error Boundary
 * Provides standardized error handling for all CLI commands
 */

import { 
  ErrorBoundary, 
  createErrorContext 
} from 'cortex-core';
import type { CLIError } from 'cortex-core';
import { globalCLIErrorBoundary } from './error-patterns';

/**
 * Global error boundary instance for CLI
 */
const cliErrorBoundary = globalCLIErrorBoundary;

/**
 * Execute a CLI command with comprehensive error handling
 */
export async function executeCLICommand<T>(
  commandName: string,
  operation: () => Promise<T>,
  context?: {
    operation?: string;
    filePath?: string;
    additionalInfo?: Record<string, any>;
  }
): Promise<T> {
  const errorContext = createErrorContext(
    commandName,
    context?.operation,
    context?.filePath,
    context?.additionalInfo
  );

  try {
    return await cliErrorBoundary.executeCommand(commandName, operation, errorContext);
  } catch (error) {
    const cliError = error as CLIError;
    
    // Exit with appropriate error code
    process.exit(cliError.exitCode);
  }
}

/**
 * Execute a synchronous CLI command with error handling
 */
export function executeCLICommandSync<T>(
  commandName: string,
  operation: () => T,
  context?: {
    operation?: string;
    filePath?: string;
    additionalInfo?: Record<string, any>;
  }
): T {
  const errorContext = createErrorContext(
    commandName,
    context?.operation,
    context?.filePath,
    context?.additionalInfo
  );

  try {
    return cliErrorBoundary.executeCommandSync(commandName, operation, errorContext);
  } catch (error) {
    const cliError = error as CLIError;
    
    // Exit with appropriate error code
    process.exit(cliError.exitCode);
  }
}

/**
 * Create a command wrapper function for a specific command
 */
export function createCommandWrapper(commandName: string) {
  return {
    /**
     * Wrap an async command execution
     */
    async wrap<T>(
      operation: () => Promise<T>,
      context?: {
        operation?: string;
        filePath?: string;
        additionalInfo?: Record<string, any>;
      }
    ): Promise<T> {
      return executeCLICommand(commandName, operation, context);
    },

    /**
     * Wrap a sync command execution
     */
    wrapSync<T>(
      operation: () => T,
      context?: {
        operation?: string;
        filePath?: string;
        additionalInfo?: Record<string, any>;
      }
    ): T {
      return executeCLICommandSync(commandName, operation, context);
    }
  };
}

/**
 * Pre-defined command wrappers for common CLI commands
 */
export const commandWrappers = {
  new: createCommandWrapper('new'),
  open: createCommandWrapper('open'),
  search: createCommandWrapper('search'),
  chat: createCommandWrapper('chat'),
  embed: createCommandWrapper('embed'),
  daemon: createCommandWrapper('daemon'),
  tui: createCommandWrapper('tui'),
  sync: createCommandWrapper('sync'),
  config: createCommandWrapper('config'),
  template: createCommandWrapper('template')
};

/**
 * Handle uncaught exceptions and unhandled rejections
 */
export function setupGlobalErrorHandlers(): void {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:');
    
    try {
      const cliError = cliErrorBoundary.normalizeError(error, 'global');
      cliErrorBoundary.handleError(cliError);
    } catch (handlingError) {
      console.error('💥 Fatal error while handling uncaught exception:', handlingError);
      console.error('Original error:', error);
    }
    
    process.exit(4); // Critical error exit code
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled Promise Rejection:');
    
    try {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      const cliError = cliErrorBoundary.normalizeError(error, 'global');
      cliErrorBoundary.handleError(cliError);
    } catch (handlingError) {
      console.error('💥 Fatal error while handling unhandled rejection:', handlingError);
      console.error('Original reason:', reason);
    }
    
    process.exit(4); // Critical error exit code
  });
}

/**
 * Enable or disable debug mode
 */
export function setDebugMode(enabled: boolean): void {
  cliErrorBoundary.setDebugMode(enabled);
}

/**
 * Get the current error boundary instance (for advanced usage)
 */
export function getErrorBoundary(): ErrorBoundary {
  return cliErrorBoundary;
}

/**
 * Get enhanced error statistics and patterns
 */
export function getErrorStats(): Record<string, any> {
  return (cliErrorBoundary as any).getErrorStats();
}

/**
 * Create enhanced CLI error context with command-specific information
 */
export function createCLIErrorContext(
  command: string,
  operation?: string,
  args: string[] = [],
  options: Record<string, any> = {}
) {
  return (cliErrorBoundary as any).createCommandContext(command, operation, args, options);
}