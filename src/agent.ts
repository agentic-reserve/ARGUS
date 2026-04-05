/**
 * ARGUS Enterprise Autonomy Agent
 * 
 * Modular AI agent built with OpenRouter SDK, following patterns from:
 * - OpenRouter Agent Skill (items-based streaming)
 * - LangChain tool patterns
 * - Ollama local model support
 * 
 * Features:
 * - Standalone agent core with extensible hooks
 * - Enterprise-grade tools (coordination, security, ontology)
 * - Multi-model support (300+ via OpenRouter, local via Ollama)
 * - Headless and TUI interfaces
 */

import { OpenRouter, tool, stepCountIs, Tool, StreamableOutputItem } from './openrouter-stub.js';
import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';

// ==================== Types ====================

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentEvents {
  'message:user': (message: Message) => void;
  'message:assistant': (message: Message) => void;
  'item:update': (item: StreamableOutputItem) => void;
  'stream:start': () => void;
  'stream:delta': (delta: string, accumulated: string) => void;
  'stream:end': (fullText: string) => void;
  'tool:call': (name: string, args: unknown) => void;
  'tool:result': (name: string, result: unknown) => void;
  'reasoning:update': (text: string) => void;
  'error': (error: Error) => void;
  'thinking:start': () => void;
  'thinking:end': () => void;
  'task:created': (taskId: string, description: string) => void;
  'task:completed': (taskId: string, result: unknown) => void;
  'entity:updated': (entityId: string, changes: unknown) => void;
}

export interface AgentConfig {
  apiKey: string;
  model?: string;
  instructions?: string;
  tools?: Tool<z.ZodTypeAny, z.ZodTypeAny>[];
  maxSteps?: number;
  enterpriseMode?: boolean;
}

export interface TaskContext {
  taskId: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  deadline?: Date;
  assignedAgents: string[];
  metadata: Record<string, unknown>;
}

// ==================== Agent Core ====================

export class ArgusAgent extends EventEmitter<AgentEvents> {
  private client: OpenRouter;
  private messages: Message[] = [];
  private config: Required<Omit<AgentConfig, 'apiKey'>> & { apiKey: string };
  private activeTasks: Map<string, TaskContext> = new Map();

  constructor(config: AgentConfig) {
    super();
    this.client = new OpenRouter({ apiKey: config.apiKey });
    this.config = {
      apiKey: config.apiKey,
      model: config.model ?? 'openrouter/auto',
      instructions: config.instructions ?? this.getDefaultInstructions(),
      tools: config.tools ?? [],
      maxSteps: config.maxSteps ?? 10,
      enterpriseMode: config.enterpriseMode ?? true,
    };
  }

  private getDefaultInstructions(): string {
    return `You are ARGUS, an Enterprise Autonomy Agent. You coordinate tasks, manage entities, and maintain system security.

Core capabilities:
- Task management and delegation
- Entity tracking and monitoring
- Multi-agent coordination
- Security and access control
- Data processing and analysis

Always prioritize security, accuracy, and enterprise compliance.`;
  }

  // Get conversation history
  getMessages(): Message[] {
    return [...this.messages];
  }

  // Clear conversation
  clearHistory(): void {
    this.messages = [];
  }

  // Update system instructions
  setInstructions(instructions: string): void {
    this.config.instructions = instructions;
  }

  // Add tool at runtime
  addTool(newTool: Tool<z.ZodTypeAny, z.ZodTypeAny>): void {
    this.config.tools.push(newTool);
  }

  // Get active tasks
  getActiveTasks(): TaskContext[] {
    return Array.from(this.activeTasks.values());
  }

  // Send message with streaming (items-based)
  async send(content: string): Promise<string> {
    const userMessage: Message = { role: 'user', content };
    this.messages.push(userMessage);
    this.emit('message:user', userMessage);
    this.emit('thinking:start');

    try {
      const result = await this.client.complete({
        model: this.config.model,
        messages: this.messages.map((m) => ({ role: m.role, content: m.content })),
        tools: this.config.tools.length > 0 ? this.config.tools : undefined,
        maxSteps: this.config.maxSteps,
      });

      this.emit('stream:start');
      let fullText = '';

      // Items-based streaming - replace by ID, don't accumulate
      for await (const item of result.getItemsStream()) {
        this.emit('item:update', item);

        switch (item.type) {
          case 'message':
            const textContent = item.content?.find((c: { type: string }) => c.type === 'output_text');
            if (textContent && 'text' in textContent && typeof textContent.text === 'string') {
              const newText = textContent.text;
              if (newText !== fullText) {
                const delta = newText.slice(fullText.length);
                fullText = newText;
                this.emit('stream:delta', delta, fullText);
              }
            }
            break;

          case 'function_call':
            if (item.status === 'completed' && item.name) {
              this.emit('tool:call', item.name, JSON.parse(item.arguments || '{}'));
            }
            break;

          case 'function_call_output':
            this.emit('tool:result', item.callId || 'unknown', item.output);
            break;

          case 'reasoning':
            const reasoningText = item.content?.find((c: { type: string }) => c.type === 'reasoning_text');
            if (reasoningText && 'text' in reasoningText && typeof reasoningText.text === 'string') {
              this.emit('reasoning:update', reasoningText.text);
            }
            break;
        }
      }

      if (!fullText) {
        fullText = await result.getText();
      }

      this.emit('stream:end', fullText);

      const assistantMessage: Message = { role: 'assistant', content: fullText };
      this.messages.push(assistantMessage);
      this.emit('message:assistant', assistantMessage);

      return fullText;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      throw error;
    } finally {
      this.emit('thinking:end');
    }
  }

  // Send without streaming
  async sendSync(content: string): Promise<string> {
    const userMessage: Message = { role: 'user', content };
    this.messages.push(userMessage);
    this.emit('message:user', userMessage);

    try {
      const result = await this.client.complete({
        model: this.config.model,
        messages: this.messages.map((m) => ({ role: m.role, content: m.content })),
        tools: this.config.tools.length > 0 ? this.config.tools : undefined,
        maxSteps: this.config.maxSteps,
      });

      const fullText = await result.getText();
      const assistantMessage: Message = { role: 'assistant', content: fullText };
      this.messages.push(assistantMessage);
      this.emit('message:assistant', assistantMessage);

      return fullText;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      throw error;
    }
  }

  // Create enterprise task
  async createTask(description: string, priority: TaskContext['priority'] = 'medium'): Promise<string> {
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const task: TaskContext = {
      taskId,
      priority,
      assignedAgents: [],
      metadata: { description, createdAt: new Date().toISOString() },
    };
    this.activeTasks.set(taskId, task);
    this.emit('task:created', taskId, description);
    return taskId;
  }

  // Complete task
  async completeTask(taskId: string, result: unknown): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (task) {
      this.activeTasks.delete(taskId);
      this.emit('task:completed', taskId, result);
    }
  }
}

// Factory function
export function createArgusAgent(config: AgentConfig): ArgusAgent {
  return new ArgusAgent(config);
}
