/**
 * ARGUS Agent - Ollama Integration
 * 
 * Local model support via Ollama API
 * Compatible with OpenRouter SDK patterns
 */

import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import type { Tool } from '@openrouter/sdk';

// Ollama API types
interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
  };
}

interface OllamaResponse {
  message: OllamaMessage;
  done: boolean;
}

// Agent configuration
interface OllamaAgentConfig {
  baseUrl: string;
  model: string;
  instructions?: string;
  tools?: Tool<z.ZodTypeAny, z.ZodTypeAny>[];
  temperature?: number;
}

// Agent events
interface OllamaAgentEvents {
  'message:user': (message: OllamaMessage) => void;
  'message:assistant': (message: OllamaMessage) => void;
  'stream:delta': (delta: string, accumulated: string) => void;
  'stream:end': () => void;
  'tool:call': (name: string, args: unknown) => void;
  'tool:result': (name: string, result: unknown) => void;
  'thinking:start': () => void;
  'thinking:end': () => void;
  'error': (error: Error) => void;
}

export class OllamaAgent extends EventEmitter<OllamaAgentEvents> {
  private config: Required<OllamaAgentConfig>;
  private messages: OllamaMessage[] = [];

  constructor(config: OllamaAgentConfig) {
    super();
    this.config = {
      baseUrl: config.baseUrl || 'http://localhost:11434',
      model: config.model,
      instructions: config.instructions || 'You are a helpful assistant.',
      tools: config.tools || [],
      temperature: config.temperature || 0.7,
    };
  }

  async send(content: string): Promise<string> {
    const userMessage: OllamaMessage = { role: 'user', content };
    this.messages.push(userMessage);
    this.emit('message:user', userMessage);
    this.emit('thinking:start');

    try {
      const request: OllamaRequest = {
        model: this.config.model,
        messages: [
          { role: 'system', content: this.config.instructions },
          ...this.messages,
        ],
        stream: true,
        options: {
          temperature: this.config.temperature,
        },
      };

      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      let fullText = '';
      this.emit('stream:delta', '', '');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const data: OllamaResponse = JSON.parse(line);
            if (data.message?.content) {
              const delta = data.message.content;
              fullText += delta;
              this.emit('stream:delta', delta, fullText);
            }
            if (data.done) {
              this.emit('stream:end');
            }
          } catch {
            // Ignore parse errors for incomplete chunks
          }
        }
      }

      const assistantMessage: OllamaMessage = { role: 'assistant', content: fullText };
      this.messages.push(assistantMessage);
      this.emit('message:assistant', assistantMessage);
      this.emit('thinking:end');

      return fullText;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      this.emit('thinking:end');
      throw error;
    }
  }

  async sendSync(content: string): Promise<string> {
    const userMessage: OllamaMessage = { role: 'user', content };
    this.messages.push(userMessage);

    try {
      const request: OllamaRequest = {
        model: this.config.model,
        messages: [
          { role: 'system', content: this.config.instructions },
          ...this.messages,
        ],
        stream: false,
        options: {
          temperature: this.config.temperature,
        },
      };

      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data: OllamaResponse = await response.json();
      const fullText = data.message.content;

      const assistantMessage: OllamaMessage = { role: 'assistant', content: fullText };
      this.messages.push(assistantMessage);
      this.emit('message:assistant', assistantMessage);

      return fullText;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      throw error;
    }
  }

  getMessages(): OllamaMessage[] {
    return [...this.messages];
  }

  clearHistory(): void {
    this.messages = [];
  }
}

// Factory function
export function createOllamaAgent(config: Partial<OllamaAgentConfig> & { model: string }): OllamaAgent {
  return new OllamaAgent({
    baseUrl: config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: config.model,
    instructions: config.instructions,
    tools: config.tools,
    temperature: config.temperature,
  });
}

// List available models
export async function listOllamaModels(baseUrl = 'http://localhost:11434'): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }
    const data = await response.json();
    return data.models?.map((m: { name: string }) => m.name) || [];
  } catch (error) {
    console.error('Error listing Ollama models:', error);
    return [];
  }
}
