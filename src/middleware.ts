/**
 * ARGUS Agent Middleware System
 * 
 * Inspired by LangChain middleware patterns
 * 
 * Two hook styles:
 * - Node-style: Run sequentially at execution points
 * - Wrap-style: Run around each model/tool call
 */

import { EventEmitter } from 'eventemitter3';

// ==================== Types ====================

export type JumpTarget = 'end' | 'tools' | 'model';

export interface AgentState {
  messages: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}

export interface ModelRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  instructions: string;
  tools?: unknown[];
}

export interface ModelResponse {
  content: string;
  messages: Array<{ role: string; content: string }>;
}

export interface ToolRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResponse {
  result: unknown;
  error?: Error;
}

export interface Command {
  update?: Partial<AgentState>;
  jumpTo?: JumpTarget;
  messages?: Array<{ role: string; content: string }>;
}

// ==================== Hook Types ====================

export type NodeHookResult = Command | void | undefined;
export type WrapHandler<T, R> = (request: T) => Promise<R> | R;

export interface NodeStyleHooks {
  beforeAgent?: (state: AgentState) => NodeHookResult | Promise<NodeHookResult>;
  beforeModel?: {
    canJumpTo: JumpTarget[];
    hook: (state: AgentState) => NodeHookResult | Promise<NodeHookResult>;
  };
  afterModel?: (state: AgentState, response: ModelResponse) => NodeHookResult | Promise<NodeHookResult>;
  afterAgent?: (state: AgentState) => NodeHookResult | Promise<NodeHookResult>;
}

export interface WrapStyleHooks {
  wrapModelCall?: (
    request: ModelRequest,
    handler: WrapHandler<ModelRequest, ModelResponse>
  ) => Promise<ModelResponse>;
  wrapToolCall?: (
    request: ToolRequest,
    handler: WrapHandler<ToolRequest, ToolResponse>
  ) => Promise<ToolResponse>;
}

// ==================== Middleware Definition ====================

export interface MiddlewareConfig {
  name: string;
  nodeHooks?: NodeStyleHooks;
  wrapHooks?: WrapStyleHooks;
}

export class Middleware {
  public readonly name: string;
  public readonly nodeHooks: NodeStyleHooks;
  public readonly wrapHooks: WrapStyleHooks;

  constructor(config: MiddlewareConfig) {
    this.name = config.name;
    this.nodeHooks = config.nodeHooks || {};
    this.wrapHooks = config.wrapHooks || {};
  }
}

// ==================== Middleware Factory ====================

export function createMiddleware(config: MiddlewareConfig): Middleware {
  return new Middleware(config);
}

// ==================== Built-in Middleware ====================

/**
 * Logging Middleware - Node-style
 * Logs agent execution flow
 */
export const loggingMiddleware = createMiddleware({
  name: 'LoggingMiddleware',
  nodeHooks: {
    beforeAgent: (state) => {
      console.log(`[${new Date().toISOString()}] Agent started with ${state.messages.length} messages`);
      return;
    },
    beforeModel: {
      canJumpTo: ['end'],
      hook: (state) => {
        console.log(`[Middleware] About to call model with ${state.messages.length} messages`);
        return;
      },
    },
    afterModel: (state, response) => {
      const lastMessage = response.messages[response.messages.length - 1];
      console.log(`[Middleware] Model returned: ${lastMessage?.content?.slice(0, 100)}...`);
      return;
    },
    afterAgent: (state) => {
      console.log(`[${new Date().toISOString()}] Agent completed with ${state.messages.length} messages`);
      return;
    },
  },
});

/**
 * Retry Middleware - Wrap-style
 * Retries failed model/tool calls
 */
export function createRetryMiddleware(maxRetries: number = 3): Middleware {
  return createMiddleware({
    name: `RetryMiddleware(${maxRetries})`,
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await handler(request);
          } catch (e) {
            if (attempt === maxRetries - 1) {
              throw e;
            }
            console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed: ${e}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
        throw new Error('Unreachable');
      },
      wrapToolCall: async (request, handler) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            return await handler(request);
          } catch (e) {
            if (attempt === maxRetries - 1) {
              throw e;
            }
            console.log(`[Retry] Tool call attempt ${attempt + 1}/${maxRetries} failed: ${e}`);
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
        throw new Error('Unreachable');
      },
    },
  });
}

/**
 * Rate Limiting Middleware - Node-style
 * Limits number of model calls
 */
export function createRateLimitMiddleware(maxCalls: number = 10): Middleware {
  let callCount = 0;
  
  return createMiddleware({
    name: `RateLimitMiddleware(${maxCalls})`,
    nodeHooks: {
      beforeModel: {
        canJumpTo: ['end'],
        hook: (state) => {
          callCount++;
          if (callCount > maxCalls) {
            console.log(`[RateLimit] Maximum calls (${maxCalls}) reached`);
            return {
              jumpTo: 'end',
              messages: [
                ...state.messages,
                { role: 'assistant', content: 'Rate limit reached. Please try again later.' }
              ]
            };
          }
          return;
        },
      },
    },
  });
}

/**
 * Message Limit Middleware - Node-style
 * Limits conversation length
 */
export function createMessageLimitMiddleware(maxMessages: number = 50): Middleware {
  return createMiddleware({
    name: `MessageLimitMiddleware(${maxMessages})`,
    nodeHooks: {
      beforeModel: {
        canJumpTo: ['end'],
        hook: (state) => {
          if (state.messages.length >= maxMessages) {
            return {
              jumpTo: 'end',
              messages: [
                ...state.messages,
                { role: 'assistant', content: 'Conversation limit reached.' }
              ]
            };
          }
          return;
        },
      },
    },
  });
}

/**
 * Cost Tracking Middleware - Wrap-style
 * Tracks token usage and estimated cost
 */
export function createCostTrackingMiddleware(): Middleware {
  let totalTokens = 0;
  let totalCalls = 0;
  
  return createMiddleware({
    name: 'CostTrackingMiddleware',
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        const estimatedTokens = request.messages.reduce((sum, m) => sum + m.content.length / 4, 0);
        
        const startTime = Date.now();
        const response = await handler(request);
        const duration = Date.now() - startTime;
        
        totalCalls++;
        totalTokens += Math.floor(estimatedTokens);
        
        console.log(`[Cost] Call #${totalCalls}: ~${Math.floor(estimatedTokens)} tokens, ${duration}ms`);
        console.log(`[Cost] Total: ${totalTokens} tokens across ${totalCalls} calls`);
        
        return response;
      },
    },
  });
}

/**
 * Tool Monitoring Middleware - Wrap-style
 * Monitors tool execution
 */
export const toolMonitoringMiddleware = createMiddleware({
  name: 'ToolMonitoringMiddleware',
  wrapHooks: {
    wrapToolCall: async (request, handler) => {
      console.log(`[Tool] Executing: ${request.name}`);
      console.log(`[Tool] Arguments: ${JSON.stringify(request.args)}`);
      
      try {
        const startTime = Date.now();
        const result = await handler(request);
        const duration = Date.now() - startTime;
        
        console.log(`[Tool] ✓ ${request.name} completed in ${duration}ms`);
        return result;
      } catch (e) {
        console.log(`[Tool] ✗ ${request.name} failed: ${e}`);
        throw e;
      }
    },
  },
});

/**
 * Blocked Content Middleware - Node-style
 * Blocks requests containing blocked content
 */
export function createBlockedContentMiddleware(blockedWords: string[]): Middleware {
  return createMiddleware({
    name: 'BlockedContentMiddleware',
    nodeHooks: {
      beforeModel: {
        canJumpTo: ['end'],
        hook: (state) => {
          const lastMessage = state.messages[state.messages.length - 1];
          const content = lastMessage?.content?.toLowerCase() || '';
          
          for (const word of blockedWords) {
            if (content.includes(word.toLowerCase())) {
              console.log(`[Blocked] Content blocked: contains "${word}"`);
              return {
                jumpTo: 'end',
                messages: [
                  ...state.messages,
                  { role: 'assistant', content: 'I cannot respond to that request.' }
                ]
              };
            }
          }
          return;
        },
      },
    },
  });
}

/**
 * Dynamic Context Middleware - Wrap-style
 * Injects dynamic context into system message
 */
export function createDynamicContextMiddleware(contextProvider: () => string): Middleware {
  return createMiddleware({
    name: 'DynamicContextMiddleware',
    wrapHooks: {
      wrapModelCall: async (request, handler) => {
        const context = contextProvider();
        const modifiedRequest = {
          ...request,
          instructions: `${request.instructions}\n\nAdditional Context: ${context}`
        };
        return handler(modifiedRequest);
      },
    },
  });
}

// ==================== Middleware Executor ====================

export class MiddlewareExecutor {
  private middlewares: Middleware[];
  private state: AgentState;

  constructor(middlewares: Middleware[], initialState: AgentState) {
    this.middlewares = middlewares;
    this.state = initialState;
  }

  // Execute beforeAgent hooks
  async executeBeforeAgent(): Promise<Command | undefined> {
    for (const mw of this.middlewares) {
      if (mw.nodeHooks.beforeAgent) {
        const result = await mw.nodeHooks.beforeAgent(this.state);
        if (result) {
          this.applyCommand(result);
          if (result.jumpTo) return result;
        }
      }
    }
    return undefined;
  }

  // Execute beforeModel hooks
  async executeBeforeModel(): Promise<Command | undefined> {
    for (const mw of this.middlewares) {
      if (mw.nodeHooks.beforeModel) {
        const result = await mw.nodeHooks.beforeModel.hook(this.state);
        if (result) {
          this.applyCommand(result);
          if (result.jumpTo && mw.nodeHooks.beforeModel.canJumpTo.includes(result.jumpTo)) {
            return result;
          }
        }
      }
    }
    return undefined;
  }

  // Execute afterModel hooks (reverse order)
  async executeAfterModel(response: ModelResponse): Promise<Command | undefined> {
    for (const mw of [...this.middlewares].reverse()) {
      if (mw.nodeHooks.afterModel) {
        const result = await mw.nodeHooks.afterModel(this.state, response);
        if (result) {
          this.applyCommand(result);
        }
      }
    }
    return undefined;
  }

  // Execute afterAgent hooks (reverse order)
  async executeAfterAgent(): Promise<void> {
    for (const mw of [...this.middlewares].reverse()) {
      if (mw.nodeHooks.afterAgent) {
        const result = await mw.nodeHooks.afterAgent(this.state);
        if (result) {
          this.applyCommand(result);
        }
      }
    }
  }

  // Execute wrapModelCall (nested, first wraps all others)
  async executeModelCall(
    request: ModelRequest,
    modelHandler: WrapHandler<ModelRequest, ModelResponse>
  ): Promise<ModelResponse> {
    // Build nested handler chain
    const handlers = [...this.middlewares]
      .reverse()
      .filter(mw => mw.wrapHooks.wrapModelCall)
      .map(mw => mw.wrapHooks.wrapModelCall!);

    if (handlers.length === 0) {
      return modelHandler(request);
    }

    // Chain handlers
    let currentHandler = modelHandler;
    for (const wrapHook of handlers) {
      const nextHandler = currentHandler;
      currentHandler = (req: ModelRequest) => wrapHook(req, nextHandler);
    }

    return currentHandler(request);
  }

  // Execute wrapToolCall (nested)
  async executeToolCall(
    request: ToolRequest,
    toolHandler: WrapHandler<ToolRequest, ToolResponse>
  ): Promise<ToolResponse> {
    const handlers = [...this.middlewares]
      .reverse()
      .filter(mw => mw.wrapHooks.wrapToolCall)
      .map(mw => mw.wrapHooks.wrapToolCall!);

    if (handlers.length === 0) {
      return toolHandler(request);
    }

    let currentHandler = toolHandler;
    for (const wrapHook of handlers) {
      const nextHandler = currentHandler;
      currentHandler = (req: ToolRequest) => wrapHook(req, nextHandler);
    }

    return currentHandler(request);
  }

  // Apply command updates to state
  private applyCommand(command: Command): void {
    if (command.update) {
      this.state = { ...this.state, ...command.update };
    }
    if (command.messages) {
      this.state.messages = [...this.state.messages, ...command.messages];
    }
  }

  getState(): AgentState {
    return this.state;
  }
}

// ==================== Pre-built Middleware Collections ====================

export const defaultMiddleware = [
  loggingMiddleware,
  toolMonitoringMiddleware,
];

export const productionMiddleware = [
  loggingMiddleware,
  createRetryMiddleware(3),
  createRateLimitMiddleware(50),
  createMessageLimitMiddleware(100),
  toolMonitoringMiddleware,
  createCostTrackingMiddleware(),
];

export const debugMiddleware = [
  loggingMiddleware,
  toolMonitoringMiddleware,
  createCostTrackingMiddleware(),
];
