import { test, expect } from 'bun:test';

test('FileExplorer component exists', async () => {
  // Simple smoke test to ensure the component can be imported
  const { FileExplorer } = await import('./FileExplorer.tsx');
  expect(FileExplorer).toBeDefined();
  expect(typeof FileExplorer).toBe('function');
});