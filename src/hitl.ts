/**
 * ARGUS Human-in-the-Loop (HITL) Middleware
 * 
 * Based on LangChain HITL patterns:
 * - Interrupt tool calls requiring human approval
 * - Support approve/edit/reject decisions
 * - Checkpoint/resume functionality
 * - Configurable policies per tool
 */

import { createMiddleware, Middleware, Command } from './middleware.js';

// ==================== Types ====================

export type HITLDecisionType = 'approve' | 'edit' | 'reject';

export interface HITLDecision {
  type: HITLDecisionType;
  editedAction?: {
    name: string;
    args: Record<string, unknown>;
  };
  message?: string;
}

export interface HITLActionRequest {
  name: string;
  arguments: Record<string, unknown>;
  description: string;
}

export interface HITLReviewConfig {
  actionName: string;
  allowedDecisions: HITLDecisionType[];
  description?: string;
}

export interface HITLRequest {
  actionRequests: HITLActionRequest[];
  reviewConfigs: HITLReviewConfig[];
}

export interface HITLInterrupt {
  type: 'hitl';
  request: HITLRequest;
  timestamp: string;
  threadId: string;
}

export interface HITLToolConfig {
  allowedDecisions: HITLDecisionType[];
  description?: string;
}

export type HITLPolicy = boolean | HITLToolConfig;

export interface HITLConfig {
  interruptOn: Record<string, HITLPolicy>;
  descriptionPrefix?: string;
  onInterrupt?: (interrupt: HITLInterrupt) => void;
}

export interface Checkpoint {
  threadId: string;
  state: {
    messages: unknown[];
    pendingToolCalls?: HITLActionRequest[];
  };
  timestamp: string;
}

// ==================== Checkpointer ====================

export abstract class Checkpointer {
  abstract save(threadId: string, state: unknown): Promise<void>;
  abstract load(threadId: string): Promise<unknown | null>;
  abstract delete(threadId: string): Promise<void>;
  abstract list(): Promise<string[]>;
}

/**
 * In-memory checkpointer for testing/prototyping
 */
export class InMemoryCheckpointer extends Checkpointer {
  private checkpoints: Map<string, unknown> = new Map();

  async save(threadId: string, state: unknown): Promise<void> {
    this.checkpoints.set(threadId, JSON.parse(JSON.stringify(state)));
  }

  async load(threadId: string): Promise<unknown | null> {
    const state = this.checkpoints.get(threadId);
    return state ? JSON.parse(JSON.stringify(state)) : null;
  }

  async delete(threadId: string): Promise<void> {
    this.checkpoints.delete(threadId);
  }

  async list(): Promise<string[]> {
    return Array.from(this.checkpoints.keys());
  }
}

// ==================== HITL Middleware ====================

/**
 * Human-in-the-Loop middleware
 * Interrupts tool calls for human approval based on policy
 */
export function createHumanInTheLoopMiddleware(
  config: HITLConfig,
  checkpointer: Checkpointer = new InMemoryCheckpointer()
): Middleware {
  const pendingInterrupts: Map<string, HITLInterrupt> = new Map();

  return createMiddleware({
    name: 'HumanInTheLoopMiddleware',
    nodeHooks: {
      beforeAgent: async (state) => {
        // Check for resumed execution with decisions
        const threadId = (state as any).__threadId || 'default';
        const pendingDecision = (state as any).__hitlDecision as HITLDecision[] | undefined;
        
        if (pendingDecision) {
          // Load checkpoint and apply decisions
          const checkpoint = await checkpointer.load(threadId);
          if (checkpoint) {
            // Clear the decision from state
            delete (state as any).__hitlDecision;
            return {
              update: {
                messages: [...state.messages, { role: 'system', content: '[HITL] Resuming with human decisions' }],
              },
            };
          }
        }
        return;
      },
    },
    wrapHooks: {
      wrapToolCall: async (request, handler) => {
        const toolName = request.name;
        const policy = config.interruptOn[toolName];

        // Check if this tool requires HITL
        if (!policy) {
          // No HITL required, execute directly
          return handler(request);
        }

        // Build HITL config
        const toolConfig: HITLToolConfig = typeof policy === 'boolean' 
          ? { allowedDecisions: ['approve', 'edit', 'reject'] }
          : policy;

        const threadId = `hitl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        // Build interrupt request
        const actionRequest: HITLActionRequest = {
          name: toolName,
          arguments: request.args,
          description: buildDescription(config, toolConfig, toolName, request.args),
        };

        const interrupt: HITLInterrupt = {
          type: 'hitl',
          request: {
            actionRequests: [actionRequest],
            reviewConfigs: [{
              actionName: toolName,
              allowedDecisions: toolConfig.allowedDecisions,
              description: toolConfig.description,
            }],
          },
          timestamp: new Date().toISOString(),
          threadId,
        };

        // Save checkpoint
        await checkpointer.save(threadId, {
          messages: [], // Would include conversation state
          pendingToolCalls: [actionRequest],
        });

        // Store interrupt for retrieval
        pendingInterrupts.set(threadId, interrupt);

        // Trigger interrupt callback
        if (config.onInterrupt) {
          config.onInterrupt(interrupt);
        }

        // Return interrupt response
        return {
          result: {
            __interrupt__: interrupt,
            __threadId__: threadId,
            status: 'pending_human_decision',
          },
          error: new Error(`HITL: Tool '${toolName}' requires human approval. Thread ID: ${threadId}`),
        };
      },
    },
  });
}

/**
 * Build human-readable description for interrupt
 */
function buildDescription(
  config: HITLConfig,
  toolConfig: HITLToolConfig,
  toolName: string,
  args: Record<string, unknown>
): string {
  const prefix = toolConfig.description || config.descriptionPrefix || 'Tool execution pending approval';
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  
  return `${prefix}\n\nTool: ${toolName}\nArgs: {${argsStr}}`;
}

// ==================== Decision Handlers ====================

/**
 * Approve a tool call - execute as-is
 */
export async function approveToolCall(
  threadId: string,
  checkpointer: Checkpointer,
  onExecute: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
): Promise<unknown> {
  const checkpoint = await checkpointer.load(threadId) as Checkpoint | null;
  if (!checkpoint) {
    throw new Error(`No checkpoint found for thread: ${threadId}`);
  }

  const pendingCall = checkpoint.state.pendingToolCalls?.[0];
  if (!pendingCall) {
    throw new Error(`No pending tool call for thread: ${threadId}`);
  }

  // Execute the tool
  const result = await onExecute(pendingCall.name, pendingCall.arguments);

  // Clean up checkpoint
  await checkpointer.delete(threadId);

  return result;
}

/**
 * Edit a tool call before execution
 */
export async function editToolCall(
  threadId: string,
  checkpointer: Checkpointer,
  editedAction: { name: string; args: Record<string, unknown> },
  onExecute: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
): Promise<unknown> {
  const checkpoint = await checkpointer.load(threadId) as Checkpoint | null;
  if (!checkpoint) {
    throw new Error(`No checkpoint found for thread: ${threadId}`);
  }

  // Execute with edited action
  const result = await onExecute(editedAction.name, editedAction.args);

  // Clean up checkpoint
  await checkpointer.delete(threadId);

  return result;
}

/**
 * Reject a tool call - return feedback instead
 */
export async function rejectToolCall(
  threadId: string,
  checkpointer: Checkpointer,
  message: string
): Promise<{ rejected: true; feedback: string }> {
  const checkpoint = await checkpointer.load(threadId) as Checkpoint | null;
  if (!checkpoint) {
    throw new Error(`No checkpoint found for thread: ${threadId}`);
  }

  // Clean up checkpoint
  await checkpointer.delete(threadId);

  return {
    rejected: true,
    feedback: message,
  };
}

// ==================== HITL Manager ====================

export class HITLManager {
  private checkpointer: Checkpointer;
  private pendingDecisions: Map<string, HITLDecision[]> = new Map();

  constructor(checkpointer?: Checkpointer) {
    this.checkpointer = checkpointer || new InMemoryCheckpointer();
  }

  /**
   * Create HITL middleware with this manager
   */
  createMiddleware(config: Omit<HITLConfig, 'onInterrupt'>): Middleware {
    return createHumanInTheLoopMiddleware(
      {
        ...config,
        onInterrupt: (interrupt) => {
          console.log(`[HITL] Interrupt raised: ${interrupt.threadId}`);
          // Store for later resolution
          this.pendingDecisions.set(interrupt.threadId, []);
        },
      },
      this.checkpointer
    );
  }

  /**
   * Get pending HITL interrupts
   */
  getPendingInterrupts(): Array<{ threadId: string; timestamp: string }> {
    return Array.from(this.pendingDecisions.entries()).map(([threadId]) => ({
      threadId,
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * Approve a pending tool call
   */
  async approve(threadId: string, onExecute: (name: string, args: unknown) => Promise<unknown>): Promise<unknown> {
    const result = await approveToolCall(threadId, this.checkpointer, onExecute);
    this.pendingDecisions.delete(threadId);
    return result;
  }

  /**
   * Edit and execute a pending tool call
   */
  async edit(
    threadId: string,
    editedAction: { name: string; args: Record<string, unknown> },
    onExecute: (name: string, args: unknown) => Promise<unknown>
  ): Promise<unknown> {
    const result = await editToolCall(threadId, this.checkpointer, editedAction, onExecute);
    this.pendingDecisions.delete(threadId);
    return result;
  }

  /**
   * Reject a pending tool call
   */
  async reject(threadId: string, message: string): Promise<{ rejected: true; feedback: string }> {
    const result = await rejectToolCall(threadId, this.checkpointer, message);
    this.pendingDecisions.delete(threadId);
    return result;
  }

  /**
   * Resume agent with decision
   */
  async resume(threadId: string, decision: HITLDecision): Promise<void> {
    this.pendingDecisions.set(threadId, [decision]);
    
    // Update checkpoint with decision
    const checkpoint = await this.checkpointer.load(threadId) as Checkpoint | null;
    if (checkpoint) {
      checkpoint.state.pendingToolCalls = [];
      await this.checkpointer.save(threadId, checkpoint.state);
    }
  }
}

// ==================== Pre-built Policies ====================

/**
 * Require approval for all write operations
 */
export const writeOperationsPolicy: Record<string, HITLPolicy> = {
  coordinate_task: { allowedDecisions: ['approve', 'reject'], description: 'Task coordination requires approval' },
  security_audit: { allowedDecisions: ['approve', 'edit', 'reject'], description: 'Security operations require oversight' },
  manage_access: { allowedDecisions: ['approve', 'reject'], description: 'Access control changes require approval' },
};

/**
 * Require approval only for high-risk operations
 */
export const highRiskPolicy: Record<string, HITLPolicy> = {
  security_audit: { allowedDecisions: ['approve', 'reject'], description: '🚨 Security audit - DBA approval required' },
  manage_access: { allowedDecisions: ['approve', 'reject'], description: '🔒 Access control - Admin approval required' },
};

/**
 * Allow all operations without HITL
 */
export const noApprovalPolicy: Record<string, HITLPolicy> = {
  // All tools allowed without approval
};

// ==================== Usage Example ====================

export async function exampleUsage(): Promise<void> {
  // Create HITL manager with persistent checkpointer
  const manager = new HITLManager(new InMemoryCheckpointer());

  // Create HITL middleware
  const hitlMiddleware = manager.createMiddleware({
    interruptOn: {
      // Critical operations require approval
      coordinate_task: { allowedDecisions: ['approve', 'edit', 'reject'] },
      security_audit: { allowedDecisions: ['approve', 'reject'], description: '🚨 Security audit requires approval' },
      
      // Some operations can be edited
      data_analysis: { allowedDecisions: ['approve', 'edit', 'reject'] },
      
      // Safe operations - no approval needed
      get_current_time: false,
      calculate: false,
    },
    descriptionPrefix: 'ARGUS Enterprise - Human approval required',
  });

  // In agent workflow:
  // 1. Agent runs with HITL middleware
  // 2. When critical tool is called, execution interrupts
  // 3. Human reviews and decides
  // 4. Execution resumes with decision

  console.log('HITL Middleware configured');
  console.log('Pending interrupts:', manager.getPendingInterrupts());
}
