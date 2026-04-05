# ARGUS Enterprise Autonomy Agent

Built with **OpenRouter SDK**, following patterns from LangChain and Ollama documentation.

## Features

- **Modular Architecture** - Standalone agent core with extensible hooks
- **Multi-Model Support** - 300+ models via OpenRouter, local via Ollama
- **Enterprise Tools** - Task coordination, security audits, entity management
- **Event-Driven** - Real-time streaming with items-based model
- **Type-Safe** - Full TypeScript with Zod validation

## Quick Start

### Installation

```bash
cd argus-agent
npm install
```

### Environment Setup

```bash
cp .env.example .env
# Edit .env with your OpenRouter API key
```

### Run Headless

```bash
npm run start:headless
```

## Architecture

```
┌─────────────────────────────────────────┐
│           Your Application              │
├─────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    │
│  │  Headless   │    │   CLI/TUI   │    │
│  │   Script    │    │  (optional) │    │
│  └──────┬──────┘    └──────┬──────┘    │
│         │                  │            │
│         └──────────────────┘            │
│                    │                    │
│         ┌───────────────────┐           │
│         │   ArgusAgent      │           │
│         │  (EventEmitter)   │           │
│         └───────────┬───────┘           │
│                     │                   │
│         ┌───────────────────┐           │
│         │   OpenRouter SDK  │           │
│         │  (300+ Models)    │           │
│         └───────────────────┘           │
└─────────────────────────────────────────┘
```

## Usage

### Basic Usage

```typescript
import { createArgusAgent, enterpriseTools } from '@argus/agent';

const agent = createArgusAgent({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'openrouter/auto',
  instructions: 'You are ARGUS, an enterprise autonomy agent.',
  tools: enterpriseTools,
});

// Send message
const response = await agent.send('Query all active IoT sensors');
console.log(response);
```

### Event Hooks

```typescript
agent.on('thinking:start', () => console.log('Processing...'));
agent.on('tool:call', (name, args) => console.log(`Using ${name}`));
agent.on('stream:delta', (delta) => process.stdout.write(delta));
agent.on('task:created', (id, desc) => console.log(`Task ${id}: ${desc}`));
```

### Enterprise Tools

| Tool | Purpose |
|------|---------|
| `coordinate_task` | Multi-agent task coordination |
| `discover_agents` | Find agents by capability |
| `query_entities` | Query enterprise entity registry |
| `security_audit` | Perform security audits |
| `analyze_data` | Data analysis and insights |
| `query_ontology` | Knowledge graph queries |

## Configuration

### Environment Variables

```bash
OPENROUTER_API_KEY=sk-or-v1-...
ARGUS_MODEL=openrouter/auto
ARGUS_MAX_STEPS=10
ARGUS_ENTERPRISE_MODE=true
```

### Agent Options

```typescript
interface AgentConfig {
  apiKey: string;              // Required: OpenRouter API key
  model?: string;              // Default: 'openrouter/auto'
  instructions?: string;       // System prompt
  tools?: Tool[];              // Available tools
  maxSteps?: number;           // Max iterations (default: 10)
  enterpriseMode?: boolean;    // Enable enterprise features
}
```

## Multi-Model Support

### OpenRouter (Cloud)

```typescript
const agent = createArgusAgent({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'anthropic/claude-3.5-sonnet',  // or 'openrouter/auto'
});
```

### Ollama (Local)

```typescript
// Configure for local Ollama
const agent = createArgusAgent({
  apiKey: 'ollama',  // Special handling for local
  model: 'llama3.1',
  // Ollama base URL configured via env
});
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message:user` | Message | User message received |
| `message:assistant` | Message | Assistant response |
| `item:update` | StreamableOutputItem | Streaming item |
| `stream:start` | - | Streaming began |
| `stream:delta` | (delta, full) | New text chunk |
| `stream:end` | fullText | Streaming complete |
| `tool:call` | (name, args) | Tool invocation |
| `tool:result` | (name, result) | Tool completed |
| `task:created` | (id, desc) | New task created |
| `task:completed` | (id, result) | Task finished |
| `thinking:start/end` | - | Processing state |

## LangSmith Studio

Visualize and debug your ARGUS agent in real-time with LangSmith Studio.

### Setup

1. **Get LangSmith API Key**
   - Sign up at [smith.langchain.com](https://smith.langchain.com)
   - Create API key at [Settings](https://smith.langchain.com/settings)

2. **Configure Environment**
   ```bash
   # .env
   LANGSMITH_API_KEY=lsv2_pt_...
   LANGSMITH_TRACING=true
   LANGSMITH_PROJECT=argus-enterprise
   ```

3. **Start Studio**
   ```bash
   npm run studio
   ```

4. **Open Studio UI**
   - Navigate to: `https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024`
   - Or use tunnel for Safari: `npm run studio:tunnel`

### Studio Features

- **Step-by-step visualization** - See prompts, tool calls, and outputs
- **Real-time debugging** - Inspect intermediate states
- **Hot-reloading** - Changes reflect immediately
- **Thread management** - Resume conversations from any step

## License

MIT License - See LICENSE file
