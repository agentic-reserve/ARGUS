/**
 * ARGUS Multi-Agent Patterns
 * 
 * Based on LangChain multi-agent patterns:
 * - Subagents: Main agent coordinates subagents as tools
 * - Handoffs: Transfer control via tool calls
 * - Skills: Load specialized context on-demand
 * - Router: Classification and dispatch
 * - Custom Workflow: Build bespoke execution flows
 */

import { z } from 'zod';
import type { ArgusAgent } from './agent.js';
import { tool } from './tools.js';

// ==================== Types ====================

export interface SubagentConfig {
  name: string;
  description: string;
  agent: ArgusAgent;
  inputSchema?: z.ZodTypeAny;
}

export interface AgentRegistry {
  [name: string]: ArgusAgent;
}

export interface Skill {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
}

export interface RouterConfig {
  routes: Array<{
    name: string;
    description: string;
    condition: (input: string) => boolean | Promise<boolean>;
    agent: ArgusAgent;
  }>;
  fallback?: ArgusAgent;
}

export type HandoffTarget = string;

export interface HandoffConfig {
  targets: Array<{
    name: string;
    description: string;
    agent: ArgusAgent;
    canReturn?: boolean;
  }>;
  currentAgent?: string;
}

export interface WorkflowNode {
  id: string;
  type: 'agent' | 'tool' | 'condition' | 'parallel';
  execute: (context: WorkflowContext) => Promise<WorkflowContext>;
  next?: string | ((context: WorkflowContext) => string | undefined);
}

export interface WorkflowContext {
  input: string;
  state: Record<string, unknown>;
  results: Record<string, unknown>;
  messages: Array<{ role: string; content: string }>;
}

export interface Workflow {
  nodes: Map<string, WorkflowNode>;
  startNode: string;
}

// ==================== Pattern 1: Subagents ====================

/**
 * Create a tool that wraps a subagent
 * Main agent calls subagent as a tool
 */
export function createSubagentTool(config: SubagentConfig) {
  return tool({
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema || z.object({ query: z.string() }),
    execute: async (input: Record<string, unknown>) => {
      const query = input.query as string;
      
      // Clear history for stateless subagent
      config.agent.clearHistory();
      
      // Invoke subagent
      const result = await config.agent.sendSync(query);
      
      return {
        result,
        from: config.name,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

/**
 * Single dispatch tool for multiple subagents
 * Uses convention-based invocation
 */
export function createDispatchTool(registry: AgentRegistry) {
  return tool({
    name: 'dispatch',
    description: `Launch a specialized subagent.

Available agents:
${Object.entries(registry).map(([name, agent]) => `- ${name}`).join('\n')}`,
    inputSchema: z.object({
      agentName: z.string().describe('Name of agent to invoke'),
      task: z.string().describe('Task description for the subagent'),
    }),
    execute: async ({ agentName, task }: { agentName: string; task: string }) => {
      const subagent = registry[agentName];
      if (!subagent) {
        throw new Error(`Unknown agent: ${agentName}`);
      }
      
      // Clear and invoke
      subagent.clearHistory();
      const result = await subagent.sendSync(task);
      
      return {
        result,
        agent: agentName,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

/**
 * Async subagent execution (background job pattern)
 */
export function createAsyncSubagentTool(config: SubagentConfig) {
  const jobs = new Map<string, { status: string; result?: string }>();
  
  return {
    startTool: tool({
      name: `${config.name}_start`,
      description: `Start ${config.name} as a background job`,
      inputSchema: z.object({ task: z.string() }),
      execute: async ({ task }: { task: string }) => {
        const jobId = `${config.name}-${Date.now()}`;
        jobs.set(jobId, { status: 'running' });
        
        // Start async
        Promise.resolve().then(async () => {
          config.agent.clearHistory();
          const result = await config.agent.sendSync(task);
          jobs.set(jobId, { status: 'completed', result });
        });
        
        return { jobId, status: 'started' };
      },
    }),
    
    statusTool: tool({
      name: `${config.name}_status`,
      description: `Check status of ${config.name} job`,
      inputSchema: z.object({ jobId: z.string() }),
      execute: async ({ jobId }: { jobId: string }) => {
        const job = jobs.get(jobId);
        return job || { status: 'unknown' };
      },
    }),
    
    resultTool: tool({
      name: `${config.name}_result`,
      description: `Get result of completed ${config.name} job`,
      inputSchema: z.object({ jobId: z.string() }),
      execute: async ({ jobId }: { jobId: string }) => {
        const job = jobs.get(jobId);
        if (!job || job.status !== 'completed') {
          throw new Error('Job not completed or not found');
        }
        jobs.delete(jobId);
        return { result: job.result };
      },
    }),
  };
}

// ==================== Pattern 2: Handoffs ====================

/**
 * Handoff state management
 */
class HandoffState {
  private currentAgent: string | null = null;
  private history: Array<{ from: string; to: string; timestamp: string }> = [];
  
  transfer(from: string, to: string): void {
    this.currentAgent = to;
    this.history.push({ from, to, timestamp: new Date().toISOString() });
  }
  
  getCurrentAgent(): string | null {
    return this.currentAgent;
  }
  
  getHistory(): Array<{ from: string; to: string; timestamp: string }> {
    return [...this.history];
  }
  
  reset(): void {
    this.currentAgent = null;
    this.history = [];
  }
}

/**
 * Create handoff tools for agent transfer
 */
export function createHandoffTools(config: HandoffConfig) {
  const state = new HandoffState();
  const registry = new Map(config.targets.map(t => [t.name, t]));
  
  const handoffTool = tool({
    name: 'transfer_to_agent',
    description: `Transfer control to another agent.

Available: ${config.targets.map(t => t.name).join(', ')}`,
    inputSchema: z.object({
      targetAgent: z.string().describe('Agent to transfer to'),
      context: z.string().optional().describe('Context to pass to the new agent'),
    }),
    execute: async ({ targetAgent, context }: { targetAgent: string; context?: string }) => {
      const target = registry.get(targetAgent);
      if (!target) {
        throw new Error(`Unknown agent: ${targetAgent}`);
      }
      
      const fromAgent = state.getCurrentAgent() || 'user';
      state.transfer(fromAgent, targetAgent);
      
      // Activate target agent
      target.agent.clearHistory();
      if (context) {
        await target.agent.sendSync(context);
      }
      
      return {
        transferred: true,
        to: targetAgent,
        canReturn: target.canReturn ?? true,
        message: `Control transferred to ${targetAgent}`,
      };
    },
  });
  
  const returnTool = tool({
    name: 'return_to_previous',
    description: 'Return control to the previous agent',
    inputSchema: z.object({
      summary: z.string().optional().describe('Summary to pass back'),
    }),
    execute: async ({ summary }: { summary?: string }) => {
      const history = state.getHistory();
      const lastTransfer = history[history.length - 1];
      
      if (!lastTransfer) {
        throw new Error('No previous agent to return to');
      }
      
      state.transfer(lastTransfer.to, lastTransfer.from);
      
      return {
        returned: true,
        to: lastTransfer.from,
        summary,
      };
    },
  });
  
  const currentAgentTool = tool({
    name: 'get_current_agent',
    description: 'Get the name of the currently active agent',
    inputSchema: z.object({}),
    execute: async () => {
      return { currentAgent: state.getCurrentAgent() };
    },
  });
  
  return {
    tools: [handoffTool, returnTool, currentAgentTool],
    state,
    getActiveAgent: () => {
      const name = state.getCurrentAgent();
      return name ? registry.get(name)?.agent : null;
    },
  };
}

// ==================== Pattern 3: Skills ====================

/**
 * Skill loader - loads specialized context on-demand
 */
export class SkillLoader {
  private skills: Map<string, Skill> = new Map();
  private loadedSkills: Set<string> = new Set();
  
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }
  
  async load(skillName: string, agent: ArgusAgent): Promise<boolean> {
    const skill = this.skills.get(skillName);
    if (!skill) return false;
    
    // Update system prompt with skill context
    const currentInstructions = (agent as any).config?.instructions || '';
    const newInstructions = `${currentInstructions}\n\n## ${skill.name}\n${skill.description}\n\n${skill.prompt}`;
    
    agent.setInstructions(newInstructions);
    this.loadedSkills.add(skillName);
    
    return true;
  }
  
  isLoaded(skillName: string): boolean {
    return this.loadedSkills.has(skillName);
  }
  
  getLoadedSkills(): string[] {
    return Array.from(this.loadedSkills);
  }
  
  listAvailable(): string[] {
    return Array.from(this.skills.keys());
  }
}

/**
 * Create skill loading tools
 */
export function createSkillTools(loader: SkillLoader) {
  const loadSkillTool = tool({
    name: 'load_skill',
    description: 'Load a specialized skill/context',
    inputSchema: z.object({
      skillName: z.string().describe('Name of skill to load'),
    }),
    execute: async ({ skillName }: { skillName: string }, { agent }: { agent: ArgusAgent }) => {
      const success = await loader.load(skillName, agent);
      return {
        loaded: success,
        skill: skillName,
        available: loader.listAvailable(),
      };
    },
  });
  
  const listSkillsTool = tool({
    name: 'list_skills',
    description: 'List available skills',
    inputSchema: z.object({}),
    execute: async () => {
      return {
        available: loader.listAvailable(),
        loaded: loader.getLoadedSkills(),
      };
    },
  });
  
  return { loadSkillTool, listSkillsTool };
}

// ==================== Pattern 4: Router ====================

/**
 * Router - classify and dispatch to specialized agents
 */
export class Router {
  private config: RouterConfig;
  
  constructor(config: RouterConfig) {
    this.config = config;
  }
  
  async route(input: string): Promise<{ agent: ArgusAgent; route: string }> {
    // Check each route condition
    for (const route of this.config.routes) {
      const matches = await route.condition(input);
      if (matches) {
        return { agent: route.agent, route: route.name };
      }
    }
    
    // Fallback
    if (this.config.fallback) {
      return { agent: this.config.fallback, route: 'fallback' };
    }
    
    throw new Error('No route matched input');
  }
  
  async routeAndExecute(input: string): Promise<string> {
    const { agent, route } = await this.route(input);
    
    agent.clearHistory();
    const result = await agent.sendSync(input);
    
    return `[${route}] ${result}`;
  }
}

/**
 * Create router classification tool
 */
export function createRouterTool(router: Router) {
  return tool({
    name: 'classify_and_route',
    description: 'Classify input and route to appropriate agent',
    inputSchema: z.object({
      input: z.string().describe('Input to classify'),
    }),
    execute: async ({ input }: { input: string }) => {
      const result = await router.routeAndExecute(input);
      return { result };
    },
  });
}

// ==================== Pattern 5: Custom Workflow ====================

/**
 * Workflow executor
 */
export class WorkflowExecutor {
  private workflow: Workflow;
  
  constructor(workflow: Workflow) {
    this.workflow = workflow;
  }
  
  async execute(initialInput: string): Promise<WorkflowContext> {
    let context: WorkflowContext = {
      input: initialInput,
      state: {},
      results: {},
      messages: [{ role: 'user', content: initialInput }],
    };
    
    let currentNodeId = this.workflow.startNode;
    const visited = new Set<string>();
    
    while (currentNodeId) {
      if (visited.has(currentNodeId)) {
        throw new Error(`Cycle detected at node: ${currentNodeId}`);
      }
      visited.add(currentNodeId);
      
      const node = this.workflow.nodes.get(currentNodeId);
      if (!node) {
        throw new Error(`Node not found: ${currentNodeId}`);
      }
      
      // Execute node
      context = await node.execute(context);
      context.results[currentNodeId] = context.state;
      
      // Determine next node
      if (node.next) {
        if (typeof node.next === 'string') {
          currentNodeId = node.next;
        } else {
          currentNodeId = node.next(context) || '';
        }
      } else {
        currentNodeId = '';
      }
    }
    
    return context;
  }
}

/**
 * Create a workflow node for agent execution
 */
export function createAgentNode(
  id: string,
  agent: ArgusAgent,
  next?: string | ((context: WorkflowContext) => string | undefined)
): WorkflowNode {
  return {
    id,
    type: 'agent',
    execute: async (context) => {
      agent.clearHistory();
      const result = await agent.sendSync(context.input);
      
      return {
        ...context,
        state: { ...context.state, [id]: result },
        messages: [...context.messages, { role: 'assistant', content: result }],
      };
    },
    next,
  };
}

/**
 * Create a parallel execution node
 */
export function createParallelNode(
  id: string,
  agents: ArgusAgent[],
  next?: string | ((context: WorkflowContext) => string | undefined)
): WorkflowNode {
  return {
    id,
    type: 'parallel',
    execute: async (context) => {
      // Execute all agents in parallel
      const results = await Promise.all(
        agents.map(async (agent, index) => {
          agent.clearHistory();
          const result = await agent.sendSync(context.input);
          return { index, result };
        })
      );
      
      const combined = results.map(r => `[Agent ${r.index}] ${r.result}`).join('\n\n');
      
      return {
        ...context,
        state: { ...context.state, [id]: combined },
        messages: [...context.messages, { role: 'assistant', content: combined }],
      };
    },
    next,
  };
}

// ==================== Performance Comparison ====================

/**
 * Compare multi-agent patterns for a task
 */
export function comparePatterns(task: string): Record<string, { calls: number; bestFor: string[] }> {
  return {
    subagents: {
      calls: 4,
      bestFor: ['distributed development', 'parallel execution', 'multi-domain'],
    },
    handoffs: {
      calls: 3,
      bestFor: ['repeat requests', 'direct user interaction', 'sequential tasks'],
    },
    skills: {
      calls: 3,
      bestFor: ['simple focused tasks', 'repeat requests', 'context isolation'],
    },
    router: {
      calls: 3,
      bestFor: ['single requests', 'parallel execution', 'multi-domain'],
    },
    custom: {
      calls: 'varies',
      bestFor: ['bespoke workflows', 'complex orchestration', 'mixed patterns'],
    },
  };
}

// ==================== Usage Examples ====================

export async function exampleSubagents(): Promise<void> {
  // Create specialized agents
  const researchAgent = {} as ArgusAgent;
  const writerAgent = {} as ArgusAgent;
  
  // Wrap as tools
  const researchTool = createSubagentTool({
    name: 'research',
    description: 'Research a topic and return findings',
    agent: researchAgent,
  });
  
  const writerTool = createSubagentTool({
    name: 'writer',
    description: 'Write content based on research',
    agent: writerAgent,
  });
  
  console.log('Subagents configured:', researchTool.name, writerTool.name);
}

export async function exampleHandoffs(): Promise<void> {
  const { tools, getActiveAgent } = createHandoffTools({
    targets: [
      { name: 'billing', description: 'Billing support', agent: {} as ArgusAgent },
      { name: 'technical', description: 'Technical support', agent: {} as ArgusAgent },
    ],
  });
  
  console.log('Handoffs configured:', tools.length, 'tools');
}

export async function exampleSkills(): Promise<void> {
  const loader = new SkillLoader();
  
  loader.register({
    name: 'coding',
    description: 'Software development assistance',
    prompt: 'You are an expert software developer...',
  });
  
  const { loadSkillTool, listSkillsTool } = createSkillTools(loader);
  console.log('Skills configured:', loader.listAvailable());
}

export async function exampleRouter(): Promise<void> {
  const router = new Router({
    routes: [
      {
        name: 'coding',
        description: 'Programming questions',
        condition: (input) => input.includes('code') || input.includes('programming'),
        agent: {} as ArgusAgent,
      },
      {
        name: 'writing',
        description: 'Writing assistance',
        condition: (input) => input.includes('write') || input.includes('essay'),
        agent: {} as ArgusAgent,
      },
    ],
  });
  
  console.log('Router configured:', router);
}
