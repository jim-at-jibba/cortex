# Cortex Agent Guidelines

## Commands
- Build: `bun run build`
- Test: `bun test` (single file: `bun test packages/cortex-core/src/ai-service.test.ts`)
- Dev: `bun run dev`
- Clean: `bun run clean`

## Code Style
- Use Bun runtime, not Node.js/npm
- TypeScript strict mode with ESNext target
- Import style: `import { X } from 'module'` (named imports preferred)
- Error handling: Use ErrorBoundary system from error-boundary.js
- Naming: PascalCase for classes, camelCase for variables/functions
- File structure: Monorepo with packages/, use path aliases in tsconfig.json

## Architecture
- Monorepo with packages: cortex-cli, cortex-core, cortex-daemon, cortex-tui, cortex-templates
- Use path aliases from tsconfig.json (e.g., "cortex-core": ["./packages/cortex-core/src"])
- Core exports: NoteManager, DatabaseManager, AIProviderManager, SemanticSearchService
- Error handling: Export ErrorBoundary system for robust error management
- Testing: Use bun test with recursive option, individual files with bun test <path>

## Task Master
- Use CLI commands directly instead of MCP (MCP hangs frequently)
- Run `task-master <command>` for all task operations
