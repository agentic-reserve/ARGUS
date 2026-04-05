/**
 * ARGUS MCP (Model Context Protocol) Adapter
 * 
 * Enables ARGUS agents to use tools from MCP servers
 * Compatible with @modelcontextprotocol/sdk protocol
 * 
 * Supports:
 * - HTTP/SSE transport (remote servers)
 * - stdio transport (local subprocesses)
 * - Multiple MCP servers simultaneously
 * - Tool discovery and conversion
 */

import { z } from 'zod';

// ==================== MCP Types ====================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
}

export interface MCPCallToolRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPCallToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface MCPServerConfig {
  transport: 'stdio' | 'http' | 'sse';
  // For stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For HTTP/SSE
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPClientConfig {
  [serverName: string]: MCPServerConfig;
}

// ==================== Transport Implementations ====================

abstract class MCPTransport {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract callTool(request: MCPCallToolRequest): Promise<MCPCallToolResponse>;
  abstract listTools(): Promise<MCPTool[]>;
}

/**
 * HTTP/SSE Transport for remote MCP servers
 */
class HTTPTransport extends MCPTransport {
  private url: string;
  private headers: Record<string, string>;

  constructor(config: { url: string; headers?: Record<string, string> }) {
    super();
    this.url = config.url;
    this.headers = config.headers || {};
  }

  async connect(): Promise<void> {
    // HTTP is stateless, no persistent connection needed
    const response = await fetch(this.url, { method: 'HEAD', headers: this.headers });
    if (!response.ok) {
      throw new Error(`Failed to connect to MCP server at ${this.url}: ${response.status}`);
    }
  }

  async disconnect(): Promise<void> {
    // HTTP is stateless
  }

  async callTool(request: MCPCallToolRequest): Promise<MCPCallToolResponse> {
    const response = await fetch(`${this.url}/tools/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Tool call failed: ${response.status}`);
    }

    return response.json();
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await fetch(`${this.url}/tools/list`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to list tools: ${response.status}`);
    }

    const data = await response.json();
    return data.tools || [];
  }
}

/**
 * stdio Transport for local subprocess MCP servers
 */
class StdioTransport extends MCPTransport {
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private process?: any; // Node.js ChildProcess

  constructor(config: { command: string; args?: string[]; env?: Record<string, string> }) {
    super();
    this.command = config.command;
    this.args = config.args || [];
    this.env = { ...process.env, ...config.env } as Record<string, string>;
  }

  async connect(): Promise<void> {
    // Dynamic import for Node.js child_process
    const { spawn } = await import('child_process');
    
    this.process = spawn(this.command, this.args, {
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return new Promise((resolve, reject) => {
      this.process!.on('error', reject);
      this.process!.on('spawn', resolve);
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
  }

  async callTool(request: MCPCallToolRequest): Promise<MCPCallToolResponse> {
    if (!this.process) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const messageHandler = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          cleanup();
          resolve(response);
        } catch (e) {
          // Not a valid JSON response, ignore
        }
      };

      const errorHandler = (data: Buffer) => {
        console.error(`MCP server error: ${data.toString()}`);
      };

      const cleanup = () => {
        this.process!.stdout.off('data', messageHandler);
        this.process!.stderr.off('data', errorHandler);
      };

      this.process!.stdout.on('data', messageHandler);
      this.process!.stderr.on('data', errorHandler);

      // Send request
      this.process!.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: request,
        id: Date.now(),
      }) + '\n');

      // Timeout
      setTimeout(() => {
        cleanup();
        reject(new Error('Tool call timeout'));
      }, 30000);
    });
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.process) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const messageHandler = (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.result?.tools) {
            cleanup();
            resolve(response.result.tools);
          }
        } catch (e) {
          // Not a valid JSON response
        }
      };

      const cleanup = () => {
        this.process!.stdout.off('data', messageHandler);
      };

      this.process!.stdout.on('data', messageHandler);

      // Send request
      this.process!.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: Date.now(),
      }) + '\n');

      setTimeout(() => {
        cleanup();
        reject(new Error('List tools timeout'));
      }, 10000);
    });
  }
}

// ==================== MCP Server Connection ====================

class MCPServerConnection {
  public readonly name: string;
  private transport: MCPTransport;
  private tools: MCPTool[] = [];

  constructor(name: string, config: MCPServerConfig) {
    this.name = name;
    
    switch (config.transport) {
      case 'http':
      case 'sse':
        if (!config.url) {
          throw new Error(`URL required for HTTP transport`);
        }
        this.transport = new HTTPTransport({
          url: config.url,
          headers: config.headers,
        });
        break;
      
      case 'stdio':
        if (!config.command) {
          throw new Error(`Command required for stdio transport`);
        }
        this.transport = new StdioTransport({
          command: config.command,
          args: config.args,
          env: config.env,
        });
        break;
      
      default:
        throw new Error(`Unknown transport: ${config.transport}`);
    }
  }

  async connect(): Promise<void> {
    await this.transport.connect();
    this.tools = await this.transport.listTools();
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }

  async callTool(request: MCPCallToolRequest): Promise<MCPCallToolResponse> {
    return this.transport.callTool(request);
  }

  getTools(): MCPTool[] {
    return this.tools;
  }
}

// ==================== Multi-Server MCP Client ====================

export class MultiServerMCPClient {
  private servers: Map<string, MCPServerConnection> = new Map();
  private config: MCPClientConfig;

  constructor(config: MCPClientConfig) {
    this.config = config;
  }

  /**
   * Connect to all configured MCP servers
   */
  async connect(): Promise<void> {
    for (const [name, serverConfig] of Object.entries(this.config)) {
      const connection = new MCPServerConnection(name, serverConfig);
      
      try {
        await connection.connect();
        this.servers.set(name, connection);
        console.log(`[MCP] Connected to server: ${name}`);
      } catch (error) {
        console.error(`[MCP] Failed to connect to server ${name}:`, error);
        throw error;
      }
    }
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnect(): Promise<void> {
    for (const [name, connection] of this.servers) {
      try {
        await connection.disconnect();
        console.log(`[MCP] Disconnected from server: ${name}`);
      } catch (error) {
        console.error(`[MCP] Error disconnecting from ${name}:`, error);
      }
    }
    this.servers.clear();
  }

  /**
   * Get all tools from all connected servers
   */
  async getTools(): Promise<Array<MCPTool & { serverName: string }>> {
    const allTools: Array<MCPTool & { serverName: string }> = [];
    
    for (const [serverName, connection] of this.servers) {
      const tools = connection.getTools().map(tool => ({
        ...tool,
        serverName,
      }));
      allTools.push(...tools);
    }
    
    return allTools;
  }

  /**
   * Call a tool by name
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPCallToolResponse> {
    const connection = this.servers.get(serverName);
    if (!connection) {
      throw new Error(`Server not found: ${serverName}`);
    }

    return connection.callTool({
      name: toolName,
      arguments: args,
    });
  }

  /**
   * Get specific server connection
   */
  getServer(name: string): MCPServerConnection | undefined {
    return this.servers.get(name);
  }

  /**
   * List connected servers
   */
  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }
}

// ==================== Tool Conversion ====================

/**
 * Convert MCP tool to ARGUS tool format
 */
export function convertMCPToolToArgus(
  mcpTool: MCPTool,
  serverName: string,
  client: MultiServerMCPClient
) {
  return {
    name: mcpTool.name,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    execute: async (args: Record<string, unknown>) => {
      const response = await client.callTool(serverName, mcpTool.name, args);
      
      if (response.isError) {
        throw new Error(response.content[0]?.text || 'Tool execution failed');
      }
      
      // Try to parse JSON response
      const text = response.content[0]?.text || '';
      try {
        return JSON.parse(text);
      } catch {
        return { result: text };
      }
    },
  };
}

// ==================== Factory Function ====================

export async function createMCPClient(config: MCPClientConfig): Promise<MultiServerMCPClient> {
  const client = new MultiServerMCPClient(config);
  await client.connect();
  return client;
}

// ==================== Example MCP Server ====================

/**
 * Example: Create an MCP server for ARGUS enterprise tools
 */
export async function createARGUSMCPServer(): Promise<void> {
  const serverConfig = {
    name: 'argus-enterprise-server',
    version: '1.0.0',
    tools: [
      {
        name: 'coordinate_task',
        description: 'Coordinate a task with other agents in the enterprise mesh',
        inputSchema: {
          type: 'object',
          properties: {
            taskType: { type: 'string', enum: ['analysis', 'execution', 'monitoring'] },
            targetAgents: { type: 'array', items: { type: 'string' } },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          },
          required: ['taskType', 'targetAgents'],
        },
      },
      {
        name: 'query_entities',
        description: 'Query the enterprise entity registry',
        inputSchema: {
          type: 'object',
          properties: {
            entityType: { type: 'string' },
            trustLevel: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      },
      {
        name: 'security_audit',
        description: 'Perform a security audit on an entity',
        inputSchema: {
          type: 'object',
          properties: {
            targetId: { type: 'string' },
            auditType: { type: 'string', enum: ['access', 'compliance', 'vulnerability'] },
          },
          required: ['targetId'],
        },
      },
    ],
  };

  // This would be implemented using @modelcontextprotocol/sdk Server class
  // For actual implementation, see the MCP SDK documentation
  console.log('ARGUS MCP Server configuration:', serverConfig);
}

// ==================== Usage Example ====================

export async function exampleUsage(): Promise<void> {
  // Create client connecting to multiple MCP servers
  const client = new MultiServerMCPClient({
    // Local math server via stdio
    math: {
      transport: 'stdio',
      command: 'node',
      args: ['/path/to/math_server.js'],
    },
    // Remote weather server via HTTP
    weather: {
      transport: 'http',
      url: 'http://localhost:8000/mcp',
    },
    // Enterprise ARGUS server
    argus: {
      transport: 'http',
      url: 'http://localhost:3000/mcp',
      headers: {
        'Authorization': 'Bearer token',
      },
    },
  });

  try {
    await client.connect();
    
    // Get all tools
    const tools = await client.getTools();
    console.log(`Loaded ${tools.length} tools from MCP servers`);
    
    // Use tools in ARGUS agent
    // const argusTools = tools.map(t => convertMCPToolToArgus(t, t.serverName, client));
    
    // Call a specific tool
    const result = await client.callTool('math', 'add', { a: 3, b: 5 });
    console.log('Math result:', result);
    
  } finally {
    await client.disconnect();
  }
}
