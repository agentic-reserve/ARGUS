/**
 * ARGUS Agent with Ollama Local Models
 * 
 * Run with local models (no API key required):
 * - qwen3-coder:30b (18GB) - Best coding
 * - qwen2.5-coder:7b (4.7GB) - Fast coding
 * - ARES-SYS/ARES-UNRESTRICTED:latest (8.9GB) - Uncensored
 * 
 * Usage: ts-node ollama-example.ts
 */

import { createOllamaAgent, listOllamaModels } from './ollama-adapter.js';
import { enterpriseTools } from './tools.js';

async function main() {
  // Check available models
  console.log('🔍 Checking Ollama models...\n');
  const models = await listOllamaModels();
  
  if (models.length === 0) {
    console.error('❌ No Ollama models found. Run: ollama pull qwen2.5-coder:7b');
    process.exit(1);
  }

  console.log('✅ Available models:');
  models.forEach(m => console.log(`   - ${m}`));
  console.log();

  // Select model (prioritize smaller one for testing)
  const preferredModel = models.find(m => m.includes('qwen2.5-coder:7b')) ||
                        models.find(m => m.includes('qwen3-coder')) ||
                        models[0];

  console.log(`🤖 Using model: ${preferredModel}\n`);

  // Create agent with local model
  const agent = createOllamaAgent({
    model: preferredModel,
    baseUrl: 'http://localhost:11434',
    instructions: `You are ARGUS, an Enterprise Autonomy Agent running on local Ollama.

You help with:
- Code analysis and generation
- Task coordination planning
- Entity management strategies
- Security audit planning

Provide concise, actionable responses.`,
    temperature: 0.7,
  });

  // Event handlers
  agent.on('thinking:start', () => console.log('🤔 Thinking...\n'));
  
  agent.on('stream:delta', (delta) => {
    process.stdout.write(delta);
  });

  agent.on('stream:end', () => {
    console.log('\n');
  });

  agent.on('error', (err) => {
    console.error(`❌ Error: ${err.message}`);
  });

  // Interactive mode
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🌐 ARGUS Local Agent (Ollama)\n');
  console.log('Type your message (Ctrl+C to exit):\n');
  console.log('Examples:');
  console.log('  - "Create a task coordination plan for data sync"');
  console.log('  - "Analyze this code structure"');
  console.log('  - "Design security audit workflow"\n');

  const prompt = () => {
    rl.question('You: ', async (input) => {
      if (!input.trim()) {
        prompt();
        return;
      }

      try {
        await agent.send(input);
      } catch {
        // Error handled by event
      }
      prompt();
    });
  };

  prompt();
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  process.exit(0);
});

main().catch(console.error);
