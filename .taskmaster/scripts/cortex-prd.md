# Cortex: Product Requirements Document

## Overview

Cortex is a terminal-first knowledge management system designed for developers who prefer command-line workflows. The application combines traditional note-taking with modern AI capabilities, enabling users to create, organize, and interact with their notes through natural language processing. Built entirely in TypeScript, Cortex leverages the Vercel AI SDK for intelligent features and Ink for an optional terminal user interface (TUI).

This document outlines the requirements for developing Cortex, a CLI application that maintains a local-first approach while providing powerful AI-driven search and chat capabilities through automatic embedding generation.

## Product vision

### Problem statement
Developers who work primarily in terminal environments lack a sophisticated note-taking system that matches their workflow. Current solutions like Obsidian require leaving the terminal, while existing CLI tools lack modern AI capabilities for semantic search and intelligent retrieval. Additionally, maintaining synchronized embeddings for AI interactions typically requires manual processes or external services.

### Target audience
- Senior software engineers and developers who spend most of their time in terminal environments
- AI engineers working with TypeScript and React Native applications
- Technical professionals who value local-first, markdown-based knowledge management
- Power users who want programmatic access to their notes and automated workflows

### Success metrics
- User can create and access notes without leaving the terminal in under 2 seconds
- Semantic search returns relevant results with >90% accuracy for user queries
- Embedding pipeline processes new/modified notes within 5 seconds of file changes
- Chat responses draw from relevant note context with <3 second response time
- System maintains <100MB memory footprint for daemon process
- Zero data leaves the local machine unless explicitly configured for cloud AI providers

## User requirements

### User stories

#### Core note management

**US-001**: As a user, I want to create a new note from the command line so that I can quickly capture thoughts without leaving my terminal
- Acceptance criteria:
  - Command `cortex new` creates a note with timestamp-based filename
  - Command `cortex new --template daily` uses the daily note template
  - Note opens in configured editor ($EDITOR environment variable)
  - Note is saved in configured notes directory

**US-002**: As a user, I want to create daily notes automatically so that I have a consistent journaling practice
- Acceptance criteria:
  - Command `cortex new daily` creates or opens today's daily note
  - Daily note uses configured template with date variables replaced
  - Only one daily note exists per day (YYYY-MM-DD format)
  - Previous incomplete tasks are optionally carried forward

**US-003**: As a user, I want to search my notes using natural language so that I can find information without remembering exact keywords
- Acceptance criteria:
  - Command `cortex search "query"` returns relevant notes
  - Results show note title, relevance score, and snippet
  - Search uses semantic similarity via embeddings
  - Results are ranked by relevance

**US-004**: As a user, I want to edit existing notes quickly so that I can update information efficiently
- Acceptance criteria:
  - Command `cortex open <partial-name>` uses fuzzy matching
  - Opens note in configured editor
  - Supports tab completion for note names
  - Shows selection menu if multiple matches exist

#### AI integration

**US-005**: As a user, I want to chat with my notes using AI so that I can extract insights and answer questions
- Acceptance criteria:
  - Command `cortex chat "question"` queries the knowledge base
  - Response includes citations to source notes
  - Chat maintains conversation context within session
  - Supports streaming responses with `--stream` flag

**US-006**: As a user, I want automatic embedding generation so that my notes are always searchable without manual intervention
- Acceptance criteria:
  - New markdown files are automatically detected and embedded
  - Modified files trigger re-embedding within 5 seconds
  - Embedding status is visible via `cortex daemon status`
  - Failed embeddings are retried with exponential backoff

**US-007**: As a user, I want to manually trigger embedding for specific notes so that I can ensure critical notes are indexed immediately
- Acceptance criteria:
  - Command `cortex embed <file>` processes single file immediately
  - Command `cortex embed --all` reprocesses entire vault
  - Progress indicator shows embedding status
  - Errors are clearly reported with file paths

#### Terminal user interface

**US-008**: As a user, I want to browse my notes in a TUI so that I can navigate visually when needed
- Acceptance criteria:
  - Command `cortex tui` launches interactive interface
  - Left pane shows note list with keyboard navigation
  - Right pane shows note preview with syntax highlighting
  - Supports vim-style keybindings (j/k for navigation)

**US-009**: As a user, I want to chat with AI in the TUI so that I can have extended conversations without multiple commands
- Acceptance criteria:
  - Ctrl+A switches to chat mode
  - Chat history is displayed with role indicators
  - Streaming responses show typing indicator
  - Can copy responses to clipboard

**US-010**: As a user, I want to search interactively in the TUI so that I can refine queries and see results in real-time
- Acceptance criteria:
  - Ctrl+F activates search mode
  - Results update as user types (debounced)
  - Can navigate results with arrow keys
  - Enter opens selected note for viewing

#### System management

**US-011**: As a user, I want to manage the background daemon so that I can control resource usage
- Acceptance criteria:
  - Command `cortex daemon start` launches background service
  - Command `cortex daemon stop` terminates service gracefully
  - Command `cortex daemon status` shows queue size and health
  - Daemon auto-starts when needed if configured

**US-012**: As a user, I want to configure Cortex settings so that I can customize behavior to my preferences
- Acceptance criteria:
  - Configuration file at `~/.cortexrc` in JSON format
  - Supports environment variables for API keys
  - Can specify notes directory, model preferences
  - Validates configuration on load

**US-013**: As a user, I want secure access to my notes so that sensitive information remains private
- Acceptance criteria:
  - API keys are never logged or displayed
  - Local embeddings storage is only accessible by user
  - Option to use local LLM for complete privacy
  - No telemetry or external requests without explicit configuration

#### Template management

**US-014**: As a user, I want to create custom templates so that I can standardize different types of notes
- Acceptance criteria:
  - Templates stored in configurable directory
  - Support variable substitution ({{date}}, {{time}}, etc.)
  - Command `cortex new --template meeting` uses meeting template
  - Can list available templates with `cortex templates list`

**US-015**: As a user, I want to manage note metadata through frontmatter so that I can organize and categorize effectively
- Acceptance criteria:
  - YAML frontmatter is parsed and indexed
  - Can search/filter by tags, dates, custom fields
  - Frontmatter variables available in templates
  - Metadata preserved during edits

#### Git integration

**US-016**: As a user, I want automatic git commits so that my notes are version controlled
- Acceptance criteria:
  - Optional auto-commit on file changes
  - Command `cortex sync` performs manual git operations
  - Commit messages include timestamp and changed files
  - Can configure remote repository for backup

#### Error handling and edge cases

**US-017**: As a user, I want graceful handling of API failures so that the system remains usable offline
- Acceptance criteria:
  - Falls back to local search when embeddings unavailable
  - Queues embedding requests during API outages
  - Clear error messages indicate degraded functionality
  - Can switch to local models as fallback

**US-018**: As a user, I want to handle large note collections efficiently so that performance doesn't degrade over time
- Acceptance criteria:
  - Supports 10,000+ notes without performance impact
  - Embedding database uses efficient indexing
  - Search returns results in <500ms for large vaults
  - Memory usage remains stable during long sessions

**US-019**: As a user, I want to recover from daemon crashes so that embedding pipeline doesn't require manual intervention
- Acceptance criteria:
  - Daemon automatically restarts on crash
  - Failed embeddings are persisted and retried
  - Crash logs are saved for debugging
  - Health checks detect and resolve deadlocks

## Functional requirements

### Core features

#### Note management system
- Create, read, update, and delete markdown notes
- Support for frontmatter metadata (YAML)
- Automatic filename generation with timestamps
- Fuzzy file search and navigation
- Template system with variable substitution
- Daily note automation with customizable templates
- Bidirectional linking support using [[wiki-links]]

#### AI-powered features
- Semantic search using vector embeddings
- Natural language chat interface with RAG (Retrieval Augmented Generation)
- Automatic embedding generation for all markdown files
- Support for multiple AI providers (OpenAI, Anthropic, local models)
- Streaming responses for better user experience
- Context-aware responses with source citations

#### Background processing
- Daemon process for continuous embedding updates
- File system watching for automatic detection of changes
- Queue management for embedding requests
- Batch processing for efficiency
- Automatic retry with exponential backoff for failures
- Dead letter queue for persistent failures

#### Terminal user interface (TUI)
- Three-pane layout (file browser, preview, chat/search)
- Vim-style keyboard navigation
- Syntax highlighting for markdown preview
- Real-time search with result highlighting
- Interactive chat interface with history
- Status bar with keyboard shortcuts

### System architecture

#### Component structure
- **cortex-cli**: Command-line interface and entry point
- **cortex-core**: Business logic, note management, embedding service
- **cortex-daemon**: Background service for embedding pipeline
- **cortex-tui**: Terminal user interface built with Ink
- **cortex-templates**: Default templates and template engine

#### Data storage
- File system for markdown notes (source of truth)
- SQLite database for metadata and embeddings
- JSON configuration file for user preferences
- Git repository for version control (optional)

#### API integrations
- Vercel AI SDK for LLM interactions
- OpenAI API for embeddings and chat
- Anthropic API as alternative provider
- Ollama for local model support

## Non-functional requirements

### Performance requirements
- Command execution time <100ms for basic operations
- Search results returned in <500ms for vaults up to 10,000 notes
- Embedding generation <1 second per note
- TUI renders at 60fps minimum
- Daemon memory usage <100MB baseline
- Support for note files up to 1MB each

### Security requirements
- API keys stored securely using environment variables or encrypted config
- No external network requests without explicit user configuration
- Local-only mode available for sensitive data
- File permissions respect system user settings
- No logging of sensitive information
- SQL injection prevention in database queries

### Reliability requirements
- Daemon process recovers from crashes automatically
- Partial failures don't block entire system
- Graceful degradation when AI services unavailable
- Data integrity maintained during concurrent operations
- Automatic backup before destructive operations
- Transaction support for database operations

### Usability requirements
- Single binary installation via npm/yarn
- Zero configuration for basic usage
- Helpful error messages with recovery suggestions
- Built-in help system with examples
- Tab completion for commands and arguments
- Cross-platform support (macOS, Linux, Windows WSL)

### Scalability requirements
- Support for 100,000+ notes
- Incremental indexing for large vaults
- Pagination for search results
- Lazy loading in TUI for large directories
- Efficient vector similarity search
- Configurable cache sizes

## Technical specifications

### Technology stack
- **Language**: TypeScript 5.x
- **Runtime**: Node.js 20.x LTS
- **Package manager**: npm/yarn/pnpm
- **Build tool**: esbuild or tsx
- **Testing**: Vitest for unit tests, Playwright for E2E

### Key dependencies
- **CLI framework**: Commander.js
- **TUI framework**: Ink 5.x
- **AI SDK**: Vercel AI SDK
- **Database**: better-sqlite3
- **File watching**: Chokidar
- **Markdown parsing**: Marked + gray-matter
- **Vector operations**: Hnswlib-node or sqlite-vss
- **Process management**: PM2 (optional)

### System requirements
- Node.js 20.x or higher
- 500MB disk space for application and dependencies
- 4GB RAM recommended for optimal performance
- Unix-like operating system (macOS, Linux) or Windows WSL
- Terminal with UTF-8 support
- Git (optional, for sync features)

### API specifications

#### CLI commands
```bash
cortex new [--template <name>]
cortex open <query>
cortex search <query> [--limit <n>]
cortex chat <message> [--stream]
cortex embed [<file>] [--all]
cortex daemon [start|stop|status|logs]
cortex tui
cortex sync
cortex config [get|set] <key> [<value>]
cortex templates [list|create|edit] <name>
```

#### Configuration schema
```typescript
interface CortexConfig {
  version: string;
  paths: {
    notes: string;
    templates: string;
    database: string;
  };
  ai: {
    provider: 'openai' | 'anthropic' | 'local';
    apiKey?: string;
    embedModel: string;
    chatModel: string;
    temperature?: number;
  };
  daemon: {
    autoStart: boolean;
    watchInterval: number;
    batchSize: number;
  };
  git?: {
    autoCommit: boolean;
    remote?: string;
  };
  editor?: string;
}
```

## Constraints and limitations

### Technical constraints
- Requires Node.js environment (no standalone binary initially)
- Terminal must support ANSI escape codes for TUI
- Windows support limited to WSL environment
- Maximum file size for efficient processing: 1MB per note
- Vector dimension limited by embedding model (1536 for OpenAI)

### Functional limitations
- No real-time collaboration features
- No mobile or web interface
- Limited to markdown format for notes
- No built-in encryption (relies on filesystem encryption)
- No image or binary file embedding
- English-optimized (multilingual depends on model choice)

### Resource limitations
- API rate limits depend on provider tier
- Local embedding models require additional setup
- Large vaults (>10,000 notes) may require initial indexing time
- Streaming responses require stable internet for cloud providers

## Dependencies and integrations

### External services
- OpenAI API for embeddings and chat (optional)
- Anthropic API as alternative provider (optional)
- GitHub/GitLab for remote backup (optional)
- Ollama for local model serving (optional)

### System dependencies
- File system access for note storage
- Network access for AI API calls
- Process management for daemon
- Git binary for version control features

### Third-party libraries
- All npm packages must have compatible licenses (MIT, Apache 2.0, BSD)
- Security audit required for dependencies
- Regular updates for security patches
- Lockfile committed for reproducible builds

## Timeline and milestones

### Phase 1: Core functionality (Weeks 1-2)
- Basic CLI structure with Commander.js
- Note creation and editing
- File system operations
- Template engine
- Configuration management

### Phase 2: AI integration (Weeks 3-4)
- Embedding service implementation
- Vector database setup
- Semantic search functionality
- Basic chat interface
- Vercel AI SDK integration

### Phase 3: Daemon development (Week 5)
- Background service architecture
- File watching implementation
- Queue management
- Health monitoring
- Auto-recovery mechanisms

### Phase 4: TUI implementation (Weeks 6-7)
- Ink application structure
- Three-pane layout
- Interactive search
- Chat interface
- Keyboard navigation

### Phase 5: Polish and optimization (Week 8)
- Performance optimization
- Error handling improvements
- Documentation
- Testing suite
- Installation scripts

## Risk assessment

### Technical risks
- **Embedding costs**: Mitigation - Support local models, implement caching
- **Performance degradation**: Mitigation - Incremental indexing, efficient data structures
- **Daemon stability**: Mitigation - Comprehensive error handling, health checks
- **API availability**: Mitigation - Offline fallback, multiple provider support

### User adoption risks
- **Learning curve**: Mitigation - Comprehensive documentation, intuitive commands
- **Migration friction**: Mitigation - Obsidian compatibility, import tools
- **Platform limitations**: Mitigation - Clear system requirements, WSL support

### Security risks
- **API key exposure**: Mitigation - Secure storage, environment variables
- **Data privacy**: Mitigation - Local-first approach, optional cloud features
- **Injection attacks**: Mitigation - Input sanitization, parameterized queries

## Success criteria

### Launch criteria
- All user stories implemented and tested
- Documentation complete with examples
- Performance benchmarks met
- Security audit passed
- Cross-platform testing completed

### Adoption metrics
- Successful installation and setup in <5 minutes
- First note created within 1 minute of installation
- 80% of users successfully use AI features
- <1% crash rate in daemon process
- Positive user feedback on developer forums

### Quality metrics
- >90% code coverage for core modules
- <10 critical bugs in first month
- Response time SLA met for 99% of operations
- Memory usage within specified limits
- Successful handling of 10,000+ note vaults
