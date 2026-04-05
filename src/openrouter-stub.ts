/**
 * OpenRouter SDK Stub
 * 
 * Temporary stub implementation until actual SDK is available
 */

import { z, ZodTypeAny } from 'zod';

export interface Tool<TInput = ZodTypeAny, TOutput = ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput> | TOutput;
}

export interface StreamableOutputItem {
  id: string;
  type: 'message' | 'function_call' | 'function_call_output' | 'reasoning';
  content?: Array<{ type: string; text?: string; reasoning_text?: string }>;
  name?: string;
  arguments?: string;
  callId?: string;
  output?: unknown;
  status?: 'in_progress' | 'completed';
}

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl?: string;
}

export class OpenRouter {
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    this.config = config;
  }

  async complete(options: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    tools?: Tool[];
    maxSteps?: number;
  }): Promise<{
    content: string;
    getItemsStream(): AsyncIterable<StreamableOutputItem>;
    getText(): Promise<string>;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  }> {
    // Stub implementation
    const content = 'This is a stub response from OpenRouter SDK';
    
    async function* generator(): AsyncGenerator<StreamableOutputItem> {
      yield { id: '1', type: 'message' as const, content: [{ type: 'output_text', text: content }] };
    }
    
    return {
      content,
      getItemsStream: () => generator(),
      getText: async () => content,
    };
  }

  async completeStream(options: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    tools?: Tool[];
  }): Promise<AsyncIterable<StreamableOutputItem>> {
    // Stub implementation
    async function* generator(): AsyncGenerator<StreamableOutputItem> {
      yield { id: '1', type: 'message' as const, content: [{ type: 'output_text', text: 'Stub streaming response' }] };
    }
    return generator();
  }
}

export function tool<TInput, TOutput>(config: {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput> | TOutput;
}): Tool<TInput, TOutput> {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    execute: config.execute,
  };
}

export function stepCountIs(n: number): { stepCount: number } {
  return { stepCount: n };
}
