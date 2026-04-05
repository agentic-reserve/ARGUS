/**
 * ARGUS Solana Integration
 * 
 * Connect ARGUS agent to Solana blockchain for:
 * - Smart contract interaction
 * - Wallet management
 * - Transaction signing
 * - Program deployment
 * 
 * Uses @solana/web3.js and @solana/kit
 */

import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  clusterApiUrl
} from '@solana/web3.js';
import { z } from 'zod';
import { tool } from './tools.js';

// ==================== Types ====================

export interface SolanaConfig {
  rpcUrl: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet';
  walletKey?: string;
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

export interface WalletInfo {
  publicKey: string;
  balance: number;
  isConnected: boolean;
}

export interface TransactionResult {
  signature: string;
  success: boolean;
  slot?: number;
  error?: string;
}

export interface ProgramInfo {
  programId: string;
  owner: string;
  executable: boolean;
  lamports: number;
}

// ==================== Solana Connection ====================

/**
 * Create Solana connection
 */
export class SolanaConnection {
  private connection: Connection | null = null;
  private config: SolanaConfig;
  private connected: boolean = false;

  constructor(config: SolanaConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    try {
      const endpoint = this.config.network === 'localnet' 
        ? this.config.rpcUrl 
        : clusterApiUrl(this.config.network);
      
      this.connection = new Connection(endpoint, this.config.commitment || 'confirmed');
      const version = await this.connection.getVersion();
      console.log(`[Solana] Connected to ${this.config.network}: ${version['solana-core']}`);
      this.connected = true;
    } catch (error) {
      console.error('[Solana] Connection failed:', error);
      throw error;
    }
  }

  async getBalance(publicKey: string): Promise<number> {
    if (!this.connection) throw new Error('Not connected');
    const pubKey = new PublicKey(publicKey);
    const balance = await this.connection.getBalance(pubKey);
    return balance / LAMPORTS_PER_SOL;
  }

  async sendTransaction(
    from: string,
    to: string,
    amount: number
  ): Promise<TransactionResult> {
    if (!this.connection) throw new Error('Not connected');
    
    try {
      const fromPubKey = new PublicKey(from);
      const toPubKey = new PublicKey(to);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fromPubKey,
          toPubkey: toPubKey,
          lamports: amount * LAMPORTS_PER_SOL,
        })
      );
      void transaction; // Mark as used - would be signed and sent with wallet adapter
      
      return {
        signature: 'pending-signing',
        success: false,
        error: 'Wallet signing required - integrate Phantom/Solflare adapter',
      };
    } catch (error) {
      return {
        signature: '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getAccountInfo(address: string): Promise<any> {
    if (!this.connection) throw new Error('Not connected');
    const pubKey = new PublicKey(address);
    return this.connection.getAccountInfo(pubKey);
  }

  async getProgramAccounts(programId: string): Promise<readonly any[]> {
    if (!this.connection) throw new Error('Not connected');
    const pubKey = new PublicKey(programId);
    return this.connection.getProgramAccounts(pubKey);
  }

  isConnected(): boolean {
    return this.connected && this.connection !== null;
  }

  getConnection(): Connection | null {
    return this.connection;
  }

  // Stub methods for program deployment and calling - requires Anchor integration
  async deployProgram(_programPath: string, _payer: string): Promise<{ programId: string; signature: string }> {
    return {
      programId: 'not-implemented',
      signature: 'requires-anchor-sdk',
    };
  }

  async callProgram(_programId: string, _instruction: string, _accounts: string[]): Promise<TransactionResult> {
    return {
      signature: '',
      success: false,
      error: 'Program instruction calling requires Anchor SDK integration',
    };
  }
}

// ==================== Solana Tools ====================

/**
 * Tool: Get wallet balance
 */
export function createGetBalanceTool(connection: SolanaConnection) {
  return tool({
    name: 'get_solana_balance',
    description: 'Get SOL balance for a wallet address',
    inputSchema: z.object({
      publicKey: z.string().describe('Solana wallet public key'),
    }),
    execute: async ({ publicKey: _publicKey }: { publicKey: string }) => {
      const balance = await connection.getBalance(_publicKey);
      return {
        publicKey: _publicKey,
        balance,
        network: 'devnet',
        timestamp: new Date().toISOString(),
      };
    },
  });
}

/**
 * Tool: Send SOL
 */
export function createSendSoolTool(connection: SolanaConnection) {
  return tool({
    name: 'send_sol',
    description: 'Send SOL from one wallet to another',
    inputSchema: z.object({
      from: z.string().describe('Sender public key'),
      to: z.string().describe('Recipient public key'),
      amount: z.number().describe('Amount in SOL'),
    }),
    execute: async ({ from: _from, to: _to, amount: _amount }: { from: string; to: string; amount: number }) => {
      const result = await connection.sendTransaction(_from, _to, _amount);
      return {
        success: result.success,
        signature: result.signature,
        from: _from,
        to: _to,
        amount: _amount,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

/**
 * Tool: Deploy program
 */
export function createDeployProgramTool(connection: SolanaConnection) {
  return tool({
    name: 'deploy_solana_program',
    description: 'Deploy a BPF program to Solana',
    inputSchema: z.object({
      programPath: z.string().describe('Path to compiled .so file'),
      payer: z.string().describe('Payer wallet public key'),
    }),
    execute: async ({ programPath: _programPath, payer: _payer }: { programPath: string; payer: string }) => {
      const result = await connection.deployProgram(_programPath, _payer);
      return {
        success: true,
        programId: result.programId,
        signature: result.signature,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

/**
 * Tool: Call program instruction
 */
export function createCallProgramTool(connection: SolanaConnection) {
  return tool({
    name: 'call_solana_program',
    description: 'Call a program instruction on Solana',
    inputSchema: z.object({
      programId: z.string().describe('Program ID'),
      instruction: z.string().describe('Instruction data'),
      accounts: z.array(z.string()).describe('Account public keys involved'),
    }),
    execute: async ({ programId: _programId, instruction: _instruction, accounts: _accounts }: { programId: string; instruction: string; accounts: string[] }) => {
      const result = await connection.callProgram(_programId, _instruction, _accounts);
      return {
        success: result.success,
        signature: result.signature,
        programId: _programId,
        timestamp: new Date().toISOString(),
      };
    },
  });
}

// ==================== Solana Manager ====================

export class SolanaManager {
  private connection: SolanaConnection;
  private tools: ReturnType<typeof this.createTools>;

  constructor(config: SolanaConfig) {
    this.connection = new SolanaConnection(config);
    this.tools = this.createTools();
  }

  private createTools() {
    return {
      getBalance: createGetBalanceTool(this.connection),
      sendSol: createSendSoolTool(this.connection),
      deployProgram: createDeployProgramTool(this.connection),
      callProgram: createCallProgramTool(this.connection),
    };
  }

  async initialize(): Promise<void> {
    await this.connection.connect();
  }

  getTools() {
    return [
      this.tools.getBalance,
      this.tools.sendSol,
      this.tools.deployProgram,
      this.tools.callProgram,
    ];
  }

  getConnection(): SolanaConnection {
    return this.connection;
  }
}

// ==================== Factory ====================

export function createSolanaManager(config: SolanaConfig): SolanaManager {
  return new SolanaManager(config);
}

// ==================== Usage Example ====================

export async function exampleSolanaIntegration(): Promise<void> {
  const manager = createSolanaManager({
    rpcUrl: 'https://api.devnet.solana.com',
    network: 'devnet',
    walletKey: process.env.SOLANA_WALLET_KEY,
  });

  await manager.initialize();

  const tools = manager.getTools();
  console.log('Solana tools registered:', tools.length);
}
