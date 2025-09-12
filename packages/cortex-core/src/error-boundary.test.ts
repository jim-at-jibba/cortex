import { test, expect, describe, beforeEach } from 'bun:test';
import { 
  ErrorBoundary, 
  ErrorCategory, 
  ErrorSeverity, 
  globalErrorBoundary,
  createErrorContext 
} from './error-boundary';

describe('ErrorBoundary', () => {
  let errorBoundary: ErrorBoundary;
  let consoleOutput: string[] = [];

  beforeEach(() => {
    errorBoundary = new ErrorBoundary();
    consoleOutput = [];
    
    // Mock console.error to capture output
    const originalError = console.error;
    console.error = (...args) => {
      consoleOutput.push(args.join(' '));
      originalError(...args);
    };
  });

  describe('Error Categorization', () => {
    test('should categorize network errors correctly', async () => {
      const networkError = new Error('ECONNREFUSED: Connection refused');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw networkError;
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.NETWORK);
        expect(cliError.severity).toBe(ErrorSeverity.MEDIUM);
        expect(cliError.recoverySuggestions.length).toBeGreaterThan(0);
      }
    });

    test('should categorize permission errors correctly', async () => {
      const permissionError = new Error('EACCES: permission denied');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw permissionError;
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.PERMISSION);
        expect(cliError.severity).toBe(ErrorSeverity.HIGH);
      }
    });

    test('should categorize file system errors correctly', async () => {
      const fsError = new Error('ENOENT: no such file or directory');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw fsError;
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.FILE_SYSTEM);
        expect(cliError.severity).toBe(ErrorSeverity.MEDIUM);
      }
    });

    test('should categorize AI service errors correctly', async () => {
      const aiError = new Error('OpenAI API rate limit exceeded');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw aiError;
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.AI_SERVICE);
        expect(cliError.severity).toBe(ErrorSeverity.MEDIUM);
      }
    });

    test('should categorize database errors correctly', async () => {
      const dbError = new Error('SQLite constraint violation');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw dbError;
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.DATABASE);
        expect(cliError.severity).toBe(ErrorSeverity.HIGH);
      }
    });

    test('should categorize validation errors correctly', async () => {
      const validationError = new Error('Invalid input format');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw validationError;
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.VALIDATION);
        expect(cliError.severity).toBe(ErrorSeverity.LOW);
      }
    });

    test('should categorize unknown errors correctly', async () => {
      const unknownError = new Error('Something unexpected happened');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw unknownError;
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.UNKNOWN);
        expect(cliError.severity).toBe(ErrorSeverity.MEDIUM);
      }
    });

    test('should handle non-Error objects', async () => {
      try {
        await errorBoundary.executeCommand('test', () => {
          throw 'String error';
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.UNKNOWN);
        expect(cliError.message).toBe('String error');
      }
    });
  });

  describe('Recovery Suggestions', () => {
    test('should provide network error recovery suggestions', async () => {
      const networkError = new Error('Network connection failed');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw networkError;
        });
      } catch (error) {
        const cliError = error as any;
        const suggestions = cliError.recoverySuggestions;
        
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some((s: any) => s.description.includes('internet connection'))).toBe(true);
        expect(suggestions.some((s: any) => s.description.includes('API keys'))).toBe(true);
      }
    });

    test('should provide permission error recovery suggestions', async () => {
      const permissionError = new Error('Permission denied');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw permissionError;
        });
      } catch (error) {
        const cliError = error as any;
        const suggestions = cliError.recoverySuggestions;
        
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some((s: any) => s.description.includes('permissions'))).toBe(true);
      }
    });

    test('should provide configuration error recovery suggestions', async () => {
      const configError = new Error('config file not found');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw configError;
        });
      } catch (error) {
        const cliError = error as any;
        const suggestions = cliError.recoverySuggestions;
        
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions.some((s: any) => s.command?.includes('config --show'))).toBe(true);
      }
    });
  });

  describe('Exit Codes', () => {
    test('should assign correct exit codes based on severity', async () => {
      const testCases = [
        { 
          error: new Error('Invalid input format'), 
          expectedSeverity: ErrorSeverity.LOW, 
          expectedExitCode: 1,
          message: 'Invalid input format'
        },
        { 
          error: new Error('Network connection failed'), 
          expectedSeverity: ErrorSeverity.MEDIUM, 
          expectedExitCode: 2,
          message: 'Network connection failed'
        },
        { 
          error: new Error('EACCES: permission denied'), 
          expectedSeverity: ErrorSeverity.HIGH, 
          expectedExitCode: 3,
          message: 'EACCES: permission denied'
        },
        { 
          error: new Error('Critical database failure'), 
          expectedSeverity: ErrorSeverity.HIGH, 
          expectedExitCode: 3,
          message: 'Critical database failure'
        },
      ];

      for (const testCase of testCases) {
        try {
          await errorBoundary.executeCommand('test', () => {
            throw testCase.error;
          });
        } catch (error) {
          const cliError = error as any;
          expect(cliError.exitCode).toBe(testCase.expectedExitCode);
        }
      }
    });
  });

  describe('Context Handling', () => {
    test('should include context in error', async () => {
      const context = createErrorContext('test-command', 'test-operation', '/test/path', { extra: 'info' });
      
      try {
        await errorBoundary.executeCommand('test-command', () => {
          throw new Error('Test error');
        }, context);
      } catch (error) {
        const cliError = error as any;
        expect(cliError.context).toEqual(context);
      }
    });

    test('should display context in error output', async () => {
      const context = createErrorContext('test-command', 'test-operation', '/test/path');
      
      try {
        await errorBoundary.executeCommand('test-command', () => {
          throw new Error('Test error');
        }, context);
      } catch (error) {
        const output = consoleOutput.join(' ');
        expect(output).toContain('Context:');
        expect(output).toContain('command: test-command');
        expect(output).toContain('operation: test-operation');
        expect(output).toContain('filePath: /test/path');
      }
    });
  });

  describe('Debug Mode', () => {
    test('should show debug information when enabled', async () => {
      errorBoundary.setDebugMode(true);
      const originalError = new Error('Original error message');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw originalError;
        });
      } catch (error) {
        const output = consoleOutput.join(' ');
        expect(output).toContain('Debug information:');
        expect(output).toContain('Error type: Error');
      }
    });

    test('should not show debug information when disabled', async () => {
      errorBoundary.setDebugMode(false);
      const originalError = new Error('Original error message');
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw originalError;
        });
      } catch (error) {
        const output = consoleOutput.join(' ');
        expect(output).not.toContain('Debug information:');
      }
    });
  });

  describe('Synchronous Execution', () => {
    test('should handle synchronous commands', () => {
      try {
        errorBoundary.executeCommandSync('test', () => {
          throw new Error('Sync error');
        });
      } catch (error) {
        const cliError = error as any;
        expect(cliError.category).toBe(ErrorCategory.UNKNOWN);
        expect(cliError.message).toBe('Sync error');
      }
    });
  });

  describe('Custom Error Handlers', () => {
    test('should call custom error handlers', async () => {
      let handlerCalled = false;
      let receivedError: any = null;
      
      errorBoundary.registerErrorHandler(ErrorCategory.NETWORK, (error) => {
        handlerCalled = true;
        receivedError = error;
      });
      
      try {
        await errorBoundary.executeCommand('test', () => {
          throw new Error('Network connection failed');
        });
      } catch (error) {
        expect(handlerCalled).toBe(true);
        expect(receivedError).toBeDefined();
        expect(receivedError.category).toBe(ErrorCategory.NETWORK);
      }
    });
  });

  describe('Graceful Exit', () => {
    test('should create graceful exit handler', () => {
      const exitHandler = errorBoundary.createGracefulExitHandler();
      expect(typeof exitHandler).toBe('function');
      
      // Note: We can't actually test the process.exit call without exiting the test
      // But we can verify the handler is created
    });
  });
});

describe('Utility Functions', () => {
  test('should create error context correctly', () => {
    const context = createErrorContext('test-command', 'test-op', '/test/file', { key: 'value' });
    
    expect(context.command).toBe('test-command');
    expect(context.operation).toBe('test-op');
    expect(context.filePath).toBe('/test/file');
    expect(context.additionalInfo).toEqual({ key: 'value' });
  });
});

describe('Global Error Boundary', () => {
  test('should provide global error boundary instance', () => {
    expect(globalErrorBoundary).toBeInstanceOf(ErrorBoundary);
  });

  test('should handle errors with global instance', async () => {
    try {
      await globalErrorBoundary.executeCommand('test', () => {
        throw new Error('Global test error');
      });
    } catch (error) {
      const cliError = error as any;
      expect(cliError.message).toBe('Global test error');
    }
  });
});

// Note: Decorator testing is complex and requires specific TypeScript configuration
// The decorator functionality is tested implicitly through the CLI integration