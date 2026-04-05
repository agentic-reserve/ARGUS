/**
 * ARGUS Supabase Integration
 * 
 * Database connection for:
 * - Entity storage and retrieval
 * - Task persistence
 * - Agent state management
 * - Analytics and logging
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { tool } from './tools.js';

// ==================== Types ====================

export interface SupabaseConfig {
  url: string;
  key: string;
}

export interface EntityRecord {
  id: string;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TaskRecord {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assigned_agent?: string;
  result?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ==================== Supabase Connection ====================

export class SupabaseConnection {
  private client: SupabaseClient | null = null;
  private config: SupabaseConfig;
  private connected: boolean = false;

  constructor(config: SupabaseConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      this.client = createClient(this.config.url, this.config.key);
      
      // Test connection
      const { error } = await this.client.from('entities').select('count', { count: 'exact', head: true });
      
      if (error && error.code !== '42P01') { // 42P01 = table doesn't exist, which is OK
        throw error;
      }
      
      this.connected = true;
      console.log(`[Supabase] Connected to ${this.config.url}`);
    } catch (error) {
      console.error('[Supabase] Connection failed:', error);
      throw error;
    }
  }

  async createEntity(type: string, data: Record<string, unknown>): Promise<EntityRecord> {
    if (!this.client) throw new Error('Not connected');
    
    const { data: result, error } = await this.client
      .from('entities')
      .insert({ type, data })
      .select()
      .single();
    
    if (error) throw error;
    return result;
  }

  async getEntity(id: string): Promise<EntityRecord | null> {
    if (!this.client) throw new Error('Not connected');
    
    const { data, error } = await this.client
      .from('entities')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) return null;
    return data;
  }

  async queryEntities(type?: string, _filters?: Record<string, unknown>): Promise<EntityRecord[]> {
    if (!this.client) throw new Error('Not connected');
    
    let query = this.client.from('entities').select('*');
    
    if (type) {
      query = query.eq('type', type);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  }

  async createTask(description: string, priority: TaskRecord['priority'] = 'medium'): Promise<TaskRecord> {
    if (!this.client) throw new Error('Not connected');
    
    const { data, error } = await this.client
      .from('tasks')
      .insert({ description, priority, status: 'pending' })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async updateTaskStatus(id: string, status: TaskRecord['status'], result?: Record<string, unknown>): Promise<void> {
    if (!this.client) throw new Error('Not connected');
    
    const update: Partial<TaskRecord> = { status };
    if (result) update.result = result;
    
    const { error } = await this.client
      .from('tasks')
      .update(update)
      .eq('id', id);
    
    if (error) throw error;
  }

  async getTasks(status?: TaskRecord['status']): Promise<TaskRecord[]> {
    if (!this.client) throw new Error('Not connected');
    
    let query = this.client.from('tasks').select('*');
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  }

  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  getClient(): SupabaseClient | null {
    return this.client;
  }
}

// ==================== Supabase Tools ====================

export function createQueryEntitiesTool(connection: SupabaseConnection) {
  return tool({
    name: 'query_entities',
    description: 'Query entities from the database',
    inputSchema: z.object({
      type: z.string().optional().describe('Entity type to filter by'),
    }),
    execute: async ({ type }: { type?: string }) => {
      const entities = await connection.queryEntities(type);
      return {
        count: entities.length,
        entities,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

export function createCreateEntityTool(connection: SupabaseConnection) {
  return tool({
    name: 'create_entity',
    description: 'Create a new entity in the database',
    inputSchema: z.object({
      type: z.string().describe('Entity type'),
      data: z.record(z.any()).describe('Entity data'),
    }),
    execute: async ({ type, data }: { type: string; data: Record<string, unknown> }) => {
      const entity = await connection.createEntity(type, data);
      return {
        success: true,
        entity,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

export function createCreateTaskTool(connection: SupabaseConnection) {
  return tool({
    name: 'create_task',
    description: 'Create a new task in the database',
    inputSchema: z.object({
      description: z.string().describe('Task description'),
      priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Task priority (defaults to medium)'),
    }),
    execute: async ({ description, priority }: { description: string; priority?: TaskRecord['priority'] }) => {
      const task = await connection.createTask(description, priority || 'medium');
      return {
        success: true,
        task,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

export function createGetTasksTool(connection: SupabaseConnection) {
  return tool({
    name: 'get_tasks',
    description: 'Get tasks from the database',
    inputSchema: z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
    }),
    execute: async ({ status }: { status?: TaskRecord['status'] }) => {
      const tasks = await connection.getTasks(status);
      return {
        count: tasks.length,
        tasks,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

// ==================== Supabase Manager ====================

export class SupabaseManager {
  private connection: SupabaseConnection;
  private tools: ReturnType<typeof this.createTools>;

  constructor(config: SupabaseConfig) {
    this.connection = new SupabaseConnection(config);
    this.tools = this.createTools();
  }

  private createTools() {
    return {
      queryEntities: createQueryEntitiesTool(this.connection),
      createEntity: createCreateEntityTool(this.connection),
      createTask: createCreateTaskTool(this.connection),
      getTasks: createGetTasksTool(this.connection),
    };
  }

  async initialize(): Promise<void> {
    await this.connection.connect();
  }

  getTools() {
    return Object.values(this.tools);
  }

  getConnection(): SupabaseConnection {
    return this.connection;
  }
}

export function createSupabaseManager(config: SupabaseConfig): SupabaseManager {
  return new SupabaseManager(config);
}

// ==================== Example Usage ====================

export async function exampleSupabaseIntegration(): Promise<void> {
  const manager = createSupabaseManager({
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
  });

  await manager.initialize();

  const tools = manager.getTools();
  console.log('[Supabase] Tools registered:', tools.length);
  console.log('[Supabase] Connected:', manager.getConnection().isConnected());
}
