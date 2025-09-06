# Cortex

> AI-powered note-taking and knowledge management CLI built with Bun and TypeScript

Cortex is a modern, intelligent note-taking system that combines the speed of local file operations with the power of AI embeddings and semantic search. Built as a monorepo with TypeScript and Bun, it provides a comprehensive CLI for managing notes, templates, and AI-powered workflows.

## ✨ Features

- **📝 Smart Note Management** - Create, edit, and organize notes with powerful templates
- **🔍 Semantic Search** - AI-powered search using vector embeddings 
- **💬 AI Chat Integration** - RAG-based chat with your notes using multiple AI providers
- **🔄 Background Daemon** - Automatic embedding generation and file watching
- **🖥️ Terminal UI** - Beautiful terminal interface with vim-style navigation
- **📋 Template System** - Dynamic templates with variable substitution
- **🔗 Git Integration** - Automatic version control and sync capabilities
- **⚡ Performance** - Built with Bun for maximum speed and efficiency

## 🏗️ Architecture

Cortex is built as a monorepo with the following packages:

- **`cortex-cli`** - Command-line interface with all user commands
- **`cortex-core`** - Shared utilities, types, and business logic
- **`cortex-daemon`** - Background service for file watching and embeddings
- **`cortex-tui`** - Terminal user interface built with Ink
- **`cortex-templates`** - Template engine and management system

## 🚀 Installation

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- Node.js >= 18.0.0 (for compatibility)

### Install Dependencies

```bash
bun install
```

### Development Setup

```bash
# Install all workspace dependencies
bun install-all

# Build all packages
bun run build

# Run in development mode
bun run dev
```

## 📖 Usage

### Basic Commands

```bash
# Create a new note
bun run cortex new "My New Note"

# Open an existing note
bun run cortex open

# Search through notes
bun run cortex search "query"

# Start AI chat session
bun run cortex chat

# Launch terminal UI
bun run cortex tui

# Manage configuration
bun run cortex config --show
```

### Configuration Management

```bash
# View current configuration
bun run cortex config --show

# Get specific setting
bun run cortex config --get aiProvider

# Set configuration value
bun run cortex config --set aiProvider=anthropic

# Set API keys
bun run cortex config --set apiKeys.openai=sk-...
bun run cortex config --set apiKeys.anthropic=sk-ant-...
```

### AI Provider Setup

Cortex supports multiple AI providers. Configure your preferred provider:

**OpenAI:**
```bash
export OPENAI_API_KEY="sk-..."
bun run cortex config --set aiProvider=openai
bun run cortex config --set embeddingModel=text-embedding-ada-002
bun run cortex config --set chatModel=gpt-4
```

**Anthropic:**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
bun run cortex config --set aiProvider=anthropic
bun run cortex config --set chatModel=claude-3-sonnet-20241022
```

**Local (Ollama):**
```bash
bun run cortex config --set aiProvider=ollama
bun run cortex config --set embeddingModel=nomic-embed-text
bun run cortex config --set chatModel=llama3
```

### Template System

```bash
# List available templates
bun run cortex templates list

# Create a new template
bun run cortex templates create

# Use template variables
echo "# {{title}}

Date: {{date}}
Time: {{time}}

## Notes

" > ~/.cortex/templates/daily.md
```

### Daemon Management

```bash
# Start background daemon
bun run cortex daemon start

# Check daemon status
bun run cortex daemon status

# Stop daemon
bun run cortex daemon stop
```

### Git Integration

```bash
# Sync notes with git
bun run cortex sync

# Enable auto-commit
bun run cortex config --set autoCommit=true
```

## 🔧 Configuration

Cortex stores its configuration in `~/.cortex/config.json`. Default structure:

```json
{
  "notesPath": "~/.cortex/notes",
  "templatesPath": "~/.cortex/templates", 
  "databasePath": "~/.cortex/cortex.db",
  "aiProvider": "openai",
  "embeddingModel": "text-embedding-ada-002",
  "chatModel": "gpt-4",
  "apiKeys": {
    "openai": "sk-...",
    "anthropic": "sk-ant-..."
  },
  "autoCommit": true,
  "daemon": {
    "enabled": true,
    "port": 3001
  }
}
```

## 🛠️ Development

### Project Structure

```
cortex/
├── packages/
│   ├── cortex-cli/         # CLI interface
│   ├── cortex-core/        # Core functionality
│   ├── cortex-daemon/      # Background service  
│   ├── cortex-tui/         # Terminal UI
│   └── cortex-templates/   # Template system
├── .taskmaster/            # Task management
├── AGENTS.md              # Agent integration guide
└── README.md              # This file
```

### Available Scripts

```bash
# Development
bun run dev                 # Run CLI in development mode
bun run build              # Build all packages
bun run test               # Run tests
bun run clean              # Clean build artifacts

# Individual packages
bun run --filter='cortex-cli' dev
bun run --filter='cortex-core' build
bun run --filter='cortex-tui' test
```

### Building for Production

```bash
# Build all packages
bun run build

# The CLI will be available at:
# packages/cortex-cli/dist/index.js
```

### Running Tests

```bash
# Run all tests
bun test --recursive

# Run tests for specific package  
cd packages/cortex-core && bun test

# Watch mode
bun test --watch
```

## 🔌 AI Integration

Cortex integrates with multiple AI providers through the Vercel AI SDK:

- **OpenAI** - GPT models and embeddings
- **Anthropic** - Claude models  
- **Ollama** - Local models
- **Custom providers** - Extensible architecture

### Embedding Generation

Notes are automatically converted to vector embeddings for semantic search:

1. **File watching** - Daemon monitors note changes
2. **Text extraction** - Content and frontmatter parsed
3. **Embedding generation** - AI provider creates vectors
4. **Database storage** - SQLite with vector extensions
5. **Search indexing** - Fast similarity search

### RAG Chat System

Chat with your notes using retrieval-augmented generation:

1. **Query processing** - User query converted to embedding
2. **Similarity search** - Find relevant note passages
3. **Context retrieval** - Extract relevant content
4. **Response generation** - AI generates response with citations
5. **Source linking** - References back to original notes

## 📁 File Organization

### Notes Structure

```
~/.cortex/notes/
├── daily/
│   ├── 2024-01-01.md
│   └── 2024-01-02.md
├── projects/
│   ├── project-a.md
│   └── project-b.md
└── research/
    └── ai-notes.md
```

### Frontmatter Support

```yaml
---
title: "My Note"
tags: ["project", "important"]
created: 2024-01-01
updated: 2024-01-02
status: "draft"
---

# Note Content

Your note content here...
```

### Template Variables

Available variables in templates:

- `{{title}}` - Note title
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{time}}` - Current time (HH:MM)
- `{{timestamp}}` - Full timestamp
- `{{author}}` - System user
- Custom variables via frontmatter

## 🎨 Terminal UI

The TUI provides a rich terminal interface:

- **Three-pane layout** - Files, preview, and chat/search
- **Vim-style navigation** - j/k movement, h/l switching
- **Keyboard shortcuts** - Ctrl+F (search), Ctrl+A (chat)
- **Syntax highlighting** - Markdown rendering
- **Real-time search** - Live results as you type
- **Streaming chat** - Real-time AI responses

### TUI Controls

- `j/k` - Navigate up/down
- `h/l` - Switch between panes  
- `Ctrl+F` - Focus search
- `Ctrl+A` - Focus chat
- `Enter` - Open selected item
- `Esc` - Exit mode
- `?` - Show help

## 🤖 Task Master Integration

This project uses [Task Master AI](https://github.com/taskmaster-ai/taskmaster) for development workflow:

```bash
# View tasks
task-master list

# Work on next task
task-master next

# Update progress
task-master update-subtask --id=1.1 --prompt="progress notes"
```

See `AGENTS.md` for detailed integration guide.

## 🧪 Testing

Comprehensive test suite covers:

- **Unit tests** - Core functionality and utilities
- **Integration tests** - CLI commands and workflows  
- **E2E tests** - Complete user scenarios
- **Performance tests** - Large note collections
- **AI mocking** - Offline testing capabilities

## 📚 Related Projects

- [Task Master AI](https://github.com/taskmaster-ai/taskmaster) - Development workflow
- [Bun](https://bun.sh) - JavaScript runtime
- [Ink](https://github.com/vadimdemedes/ink) - Terminal UI framework
- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [Vercel AI SDK](https://sdk.vercel.ai) - AI integration

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following the existing patterns
4. Add tests for new functionality  
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Bun](https://bun.sh) for incredible performance
- Inspired by tools like Obsidian, Notion, and Roam Research
- AI integration powered by the Vercel AI SDK
- Task management using Task Master AI
