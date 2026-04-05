/**
 * ARGUS Context Engineering
 * 
 * Based on LangChain context engineering patterns:
 * - Model Context (system prompts, messages, tools, models)
 * - Tool Context (read/write to state/store/runtime)
 * - Life-cycle Context (summarization, guardrails)
 */

import { createMiddleware, Middleware, Command } from './middleware.js';

// ==================== Types ====================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface AgentState {
  messages: Message[];
  [key: string]: unknown;
}

export interface RuntimeContext {
  userId?: string;
  userRole?: string;
  environment?: string;
  apiKey?: string;
  [key: string]: unknown;
}

export interface Store {
  get: (key: string[]) => Promise<{ value: unknown } | null>;
  put: (key: string[], value: unknown) => Promise<void>;
}

export interface ToolRuntime {
  state: AgentState;
  context: RuntimeContext;
  store?: Store;
}

// ==================== Dynamic System Prompt ====================

export type SystemPromptProvider = (
  state: AgentState,
  runtime: { context: RuntimeContext; store?: Store }
) => string | Promise<string>;

/**
 * Create middleware for dynamic system prompts
 * Changes based on state, store, or runtime context
 */
export function createDynamicSystemPromptMiddleware(
  provider: SystemPromptProvider
): Middleware {
  return createMiddleware({
    name: 'DynamicSystemPrompt',
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        const prompt = await provider(
          { messages: request.messages },
          { context: (request as any).runtime?.context || {}, store: (request as any).runtime?.store }
        );
        
        return handler({
          ...request,
          instructions: prompt,
        });
      },
    },
  });
}

// ==================== Message Management ====================

export interface MessageWindowConfig {
  maxMessages: number;
  keepSystem?: boolean;
  keepRecent?: number;
}

export interface TokenLimitConfig {
  maxTokens: number;
  approxCharsPerToken?: number;
}

/**
 * Trim messages to fit within a window
 * Keeps system message and most recent messages
 */
export function trimMessages(
  messages: Message[],
  config: MessageWindowConfig
): Message[] {
  const { maxMessages, keepSystem = true, keepRecent = 10 } = config;
  
  if (messages.length <= maxMessages) return messages;
  
  const result: Message[] = [];
  
  // Keep system message if present
  if (keepSystem && messages[0]?.role === 'system') {
    result.push(messages[0]);
  }
  
  // Keep most recent messages
  const recentMessages = messages.slice(-keepRecent);
  result.push(...recentMessages);
  
  return result;
}

/**
 * Estimate token count from characters
 * Rough approximation: 1 token ≈ 4 characters
 */
export function estimateTokens(text: string, charsPerToken = 4): number {
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Trim messages based on token limit
 */
export function trimByTokenLimit(
  messages: Message[],
  config: TokenLimitConfig
): Message[] {
  const { maxTokens, approxCharsPerToken = 4 } = config;
  
  let totalTokens = 0;
  const result: Message[] = [];
  
  // Process from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content, approxCharsPerToken);
    
    if (totalTokens + tokens <= maxTokens || msg.role === 'system') {
      result.unshift(msg);
      totalTokens += tokens;
    } else {
      break;
    }
  }
  
  return result;
}

/**
 * Message window middleware
 * Transient context update (per-call)
 */
export function createMessageWindowMiddleware(config: MessageWindowConfig): Middleware {
  return createMiddleware({
    name: `MessageWindow(${config.maxMessages})`,
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        const trimmed = trimMessages(request.messages, config);
        return handler({ ...request, messages: trimmed });
      },
    },
  });
}

/**
 * Token limit middleware
 * Transient context update
 */
export function createTokenLimitMiddleware(config: TokenLimitConfig): Middleware {
  return createMiddleware({
    name: `TokenLimit(${config.maxTokens})`,
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        const trimmed = trimByTokenLimit(request.messages, config);
        return handler({ ...request, messages: trimmed });
      },
    },
  });
}

// ==================== Summarization ====================

export interface SummarizationConfig {
  trigger: { messages?: number; tokens?: number };
  keepRecent: number;
  summaryModel?: string;
  summaryPrompt?: string;
}

/**
 * Summarize older messages when threshold reached
 * Persistent update - modifies state permanently
 */
export function createSummarizationMiddleware(config: SummarizationConfig): Middleware {
  const { trigger, keepRecent } = config;
  
  return createMiddleware({
    name: 'SummarizationMiddleware',
    nodeHooks: {
      beforeModel: {
        canJumpTo: [],
        hook: async (state) => {
          const shouldSummarize = 
            (trigger.messages && state.messages.length > trigger.messages + keepRecent) ||
            (trigger.tokens && estimateTokens(state.messages.map(m => m.content).join('')) > trigger.tokens);
          
          if (!shouldSummarize) return;
          
          // Identify messages to summarize (old ones, not system or recent)
          const systemMsg = state.messages[0]?.role === 'system' ? [state.messages[0]] : [];
          const recentMessages = state.messages.slice(-keepRecent);
          const toSummarize = state.messages.slice(systemMsg.length, -keepRecent);
          
          if (toSummarize.length === 0) return;
          
          // Create summary (in production, would call LLM)
          const summaryContent = `[Summary of ${toSummarize.length} previous messages covering: ${toSummarize.map(m => m.role).join(', ')}]`;
          
          const summaryMessage: Message = {
            role: 'system',
            content: `Previous conversation summary: ${summaryContent}`,
          };
          
          // Persistent update via Command
          return {
            update: {
              messages: [...systemMsg, summaryMessage, ...recentMessages],
            },
          };
        },
      },
    },
  });
}

// ==================== Tool Selection ====================

export type ToolFilter = (
  tools: unknown[],
  state: AgentState,
  runtime: { context: RuntimeContext }
) => unknown[];

/**
 * Dynamic tool selection middleware
 * Filters available tools based on state/context
 */
export function createToolSelectionMiddleware(filter: ToolFilter): Middleware {
  return createMiddleware({
    name: 'ToolSelectionMiddleware',
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        const filtered = filter(
          request.tools || [],
          { messages: request.messages },
          { context: (request as any).runtime?.context || {} }
        );
        return handler({ ...request, tools: filtered });
      },
    },
  });
}

// ==================== Model Selection ====================

export interface ModelSelectionConfig {
  default: string;
  rules: Array<{
    condition: (state: AgentState, context: RuntimeContext) => boolean;
    model: string;
  }>;
}

/**
 * Dynamic model selection middleware
 * Chooses model based on conversation state
 */
export function createModelSelectionMiddleware(config: ModelSelectionConfig): Middleware {
  return createMiddleware({
    name: 'ModelSelectionMiddleware',
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        const state = { messages: request.messages };
        const context = (request as any).runtime?.context || {};
        
        // Find matching rule
        let selectedModel = config.default;
        for (const rule of config.rules) {
          if (rule.condition(state, context)) {
            selectedModel = rule.model;
            break;
          }
        }
        
        return handler({ ...request, model: selectedModel });
      },
    },
  });
}

// ==================== Response Format ====================

export interface ResponseFormatConfig {
  formats: Record<string, unknown>;
  selector: (state: AgentState, context: RuntimeContext) => string;
}

/**
 * Dynamic response format selection
 */
export function createResponseFormatMiddleware(config: ResponseFormatConfig): Middleware {
  return createMiddleware({
    name: 'ResponseFormatMiddleware',
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        const state = { messages: request.messages };
        const context = (request as any).runtime?.context || {};
        
        const formatKey = config.selector(state, context);
        const format = config.formats[formatKey];
        
        if (format) {
          return handler({ ...request, responseFormat: format });
        }
        return handler(request);
      },
    },
  });
}

// ==================== Tool Context Utilities ====================

/**
 * Read from state in tool
 */
export function readFromState<T>(runtime: ToolRuntime, key: string): T | undefined {
  return runtime.state[key] as T | undefined;
}

/**
 * Read from runtime context in tool
 */
export function readFromContext<T>(runtime: ToolRuntime, key: string): T | undefined {
  return runtime.context[key] as T | undefined;
}

/**
 * Read from store in tool
 */
export async function readFromStore<T>(
  runtime: ToolRuntime,
  key: string[]
): Promise<T | undefined> {
  if (!runtime.store) return undefined;
  const result = await runtime.store.get(key);
  return result?.value as T | undefined;
}

/**
 * Write to state (returns Command for persistent update)
 */
export function writeToState(update: Record<string, unknown>): Command {
  return { update };
}

/**
 * Write to store in tool
 */
export async function writeToStore(
  runtime: ToolRuntime,
  key: string[],
  value: unknown
): Promise<void> {
  if (!runtime.store) return;
  await runtime.store.put(key, value);
}

// ==================== Context Engineering Presets ====================

/**
 * Production-ready context engineering stack
 */
export function createProductionContextStack(config: {
  maxMessages?: number;
  maxTokens?: number;
  summarization?: SummarizationConfig;
}): Middleware[] {
  const middlewares: Middleware[] = [];
  
  // Message window management
  if (config.maxMessages) {
    middlewares.push(createMessageWindowMiddleware({
      maxMessages: config.maxMessages,
      keepSystem: true,
      keepRecent: Math.min(10, config.maxMessages / 2),
    }));
  }
  
  // Token limit
  if (config.maxTokens) {
    middlewares.push(createTokenLimitMiddleware({
      maxTokens: config.maxTokens,
    }));
  }
  
  // Summarization
  if (config.summarization) {
    middlewares.push(createSummarizationMiddleware(config.summarization));
  }
  
  return middlewares;
}

/**
 * Cost-optimized context stack
 * Uses cheaper models for simple tasks
 */
export function createCostOptimizedStack(modelMap: {
  complex: string;
  standard: string;
  efficient: string;
}): Middleware[] {
  return [
    createModelSelectionMiddleware({
      default: modelMap.standard,
      rules: [
        {
          condition: (state) => state.messages.length > 20,
          model: modelMap.complex,
        },
        {
          condition: (state) => state.messages.length < 5,
          model: modelMap.efficient,
        },
      ],
    }),
    createMessageWindowMiddleware({ maxMessages: 50 }),
  ];
}

/**
 * Security-focused context stack
 * Blocks sensitive content, enforces compliance
 */
export function createSecurityContextStack(blockedWords: string[]): Middleware[] {
  return [
    createDynamicSystemPromptMiddleware((state, runtime) => {
      const userRole = runtime.context.userRole;
      const env = runtime.context.environment;
      
      let base = 'You are a secure enterprise assistant.';
      
      if (userRole === 'admin') {
        base += '\nYou have admin privileges.';
      } else {
        base += '\nYou have limited access. Do not expose sensitive data.';
      }
      
      if (env === 'production') {
        base += '\nBe extra careful with any data modifications.';
      }
      
      return base;
    }),
    createMiddleware({
      name: 'BlockedContentMiddleware',
      nodeHooks: {
        beforeModel: {
          canJumpTo: ['end'],
          hook: (state) => {
            const lastMsg = state.messages[state.messages.length - 1]?.content?.toLowerCase() || '';
            for (const word of blockedWords) {
              if (lastMsg.includes(word.toLowerCase())) {
                return {
                  jumpTo: 'end',
                  messages: [
                    ...state.messages,
                    { role: 'assistant', content: 'I cannot respond to that request.' },
                  ],
                };
              }
            }
            return;
          },
        },
      },
    }),
  ];
}
