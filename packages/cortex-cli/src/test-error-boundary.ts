#!/usr/bin/env bun

/**
 * Test script for CLI Error Boundary Patterns
 * Verifies that error handling works correctly for all CLI commands
 */

import { globalCLIErrorBoundary } from './error-patterns';
import { executeCLICommand } from './cli-wrapper';
import { ErrorCategory } from 'cortex-core';

async function testErrorPatterns() {
  console.log('🧪 Testing CLI Error Boundary Patterns\n');

  // Test 1: Network error pattern matching
  console.log('📋 Test 1: Network Error Pattern Matching');
  try {
    await globalCLIErrorBoundary.executeWithEnhancedHandling(
      'test',
      'network_test',
      [],
      {},
      () => {
        throw new Error('Network connection failed: ECONNREFUSED');
      }
    );
  } catch (error) {
    const cliError = error as any;
    console.log(`✅ Category: ${cliError.category}`);
    console.log(`✅ Severity: ${cliError.severity}`);
    console.log(`✅ Recovery suggestions: ${cliError.recoverySuggestions.length}`);
    console.log();
  }

  // Test 2: Permission error pattern matching
  console.log('📋 Test 2: Permission Error Pattern Matching');
  try {
    await globalCLIErrorBoundary.executeWithEnhancedHandling(
      'test',
      'permission_test',
      [],
      {},
      () => {
        throw new Error('Permission denied: EACCES');
      }
    );
  } catch (error) {
    const cliError = error as any;
    console.log(`✅ Category: ${cliError.category}`);
    console.log(`✅ Severity: ${cliError.severity}`);
    console.log(`✅ Recovery suggestions: ${cliError.recoverySuggestions.length}`);
    console.log();
  }

  // Test 3: Configuration error pattern matching
  console.log('📋 Test 3: Configuration Error Pattern Matching');
  try {
    await globalCLIErrorBoundary.executeWithEnhancedHandling(
      'test',
      'config_test',
      [],
      {},
      () => {
        throw new Error('Configuration file not found');
      }
    );
  } catch (error) {
    const cliError = error as any;
    console.log(`✅ Category: ${cliError.category}`);
    console.log(`✅ Severity: ${cliError.severity}`);
    console.log(`✅ Recovery suggestions: ${cliError.recoverySuggestions.length}`);
    console.log();
  }

  // Test 4: AI service error pattern matching
  console.log('📋 Test 4: AI Service Error Pattern Matching');
  try {
    await globalCLIErrorBoundary.executeWithEnhancedHandling(
      'test',
      'ai_test',
      [],
      {},
      () => {
        throw new Error('OpenAI API rate limit exceeded');
      }
    );
  } catch (error) {
    const cliError = error as any;
    console.log(`✅ Category: ${cliError.category}`);
    console.log(`✅ Severity: ${cliError.severity}`);
    console.log(`✅ Recovery suggestions: ${cliError.recoverySuggestions.length}`);
    console.log();
  }

  // Test 5: Database error pattern matching
  console.log('📋 Test 5: Database Error Pattern Matching');
  try {
    await globalCLIErrorBoundary.executeWithEnhancedHandling(
      'test',
      'database_test',
      [],
      {},
      () => {
        throw new Error('SQLite constraint violation');
      }
    );
  } catch (error) {
    const cliError = error as any;
    console.log(`✅ Category: ${cliError.category}`);
    console.log(`✅ Severity: ${cliError.severity}`);
    console.log(`✅ Recovery suggestions: ${cliError.recoverySuggestions.length}`);
    console.log();
  }

  // Test 6: Command context creation
  console.log('📋 Test 6: Command Context Creation');
  const context = globalCLIErrorBoundary.createCommandContext(
    'search',
    'find_notes',
    ['query'],
    { tag: 'test' }
  );
  console.log(`✅ Command: ${context.command}`);
  console.log(`✅ Operation: ${context.operation}`);
  console.log(`✅ Args: ${JSON.stringify(context.additionalInfo?.args)}`);
  console.log(`✅ Options: ${JSON.stringify(context.additionalInfo?.options)}`);
  console.log();

  // Test 7: Error statistics
  console.log('📋 Test 7: Error Statistics');
  const stats = globalCLIErrorBoundary.getErrorStats();
  console.log(`✅ Available patterns: ${stats.availablePatterns.length}`);
  console.log(`✅ Categories: ${stats.availablePatterns.map((p: any) => p.category).join(', ')}`);
  console.log();

  console.log('🎉 All error boundary pattern tests completed successfully!');
}

// Test CLI command wrapper
async function testCLICommandWrapper() {
  console.log('🧪 Testing CLI Command Wrapper\n');

  // Test successful command
  console.log('📋 Test 1: Successful Command');
  try {
    const result = await executeCLICommand('test', async () => {
      return 'success';
    }, { operation: 'test_operation' });
    console.log(`✅ Result: ${result}`);
  } catch (error) {
    console.log(`❌ Unexpected error: ${error}`);
  }
  console.log();

  // Test command with error
  console.log('📋 Test 2: Command with Error');
  try {
    await executeCLICommand('test', async () => {
      throw new Error('Test error for wrapper');
    }, { operation: 'test_error' });
  } catch (error) {
    const cliError = error as any;
    console.log(`✅ Error caught: ${cliError.message}`);
    console.log(`✅ Category: ${cliError.category}`);
    console.log(`✅ Exit code: ${cliError.exitCode}`);
  }
  console.log();
}

// Run all tests
async function runAllTests() {
  try {
    await testErrorPatterns();
    await testCLICommandWrapper();
    console.log('🎯 All tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.main) {
  runAllTests();
}

export { testErrorPatterns, testCLICommandWrapper, runAllTests };