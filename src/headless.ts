/**
 * ARGUS Agent - Headless Usage Example
 * 
 * Run without UI: `npm run start:headless`
 * 
 * Demonstrates:
 * - Event-driven agent interactions
 * - Tool execution
 * - Enterprise task coordination
 */

import { createArgusAgent } from './agent.js';
import { enterpriseTools } from './tools.js';
import chalk from 'chalk';
import ora from 'ora';

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    console.error(chalk.red('❌ Error: OPENROUTER_API_KEY environment variable required'));
    console.log(chalk.gray('Get your key at: https://openrouter.ai/settings/keys'));
    process.exit(1);
  }

  // Create agent with enterprise configuration
  const agent = createArgusAgent({
    apiKey,
    model: 'openrouter/auto',
    instructions: `You are ARGUS, an Enterprise Autonomy Agent.

Your capabilities include:
- Coordinating tasks across agent mesh
- Querying enterprise entities and assets
- Performing security audits
- Analyzing data and generating insights
- Managing access controls

Always respond professionally and provide actionable insights.`,
    tools: enterpriseTools,
    maxSteps: 10,
    enterpriseMode: true,
  });

  // Track thinking state
  let spinner: ora.Ora | null = null;

  // Hook into agent events
  agent.on('thinking:start', () => {
    spinner = ora(chalk.blue('ARGUS is thinking...')).start();
  });

  agent.on('thinking:end', () => {
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
  });

  agent.on('tool:call', (name, args) => {
    console.log(chalk.cyan(`\n🔧 Using tool: ${name}`));
    console.log(chalk.gray(JSON.stringify(args, null, 2)));
  });

  agent.on('tool:result', (name, result) => {
    console.log(chalk.green(`✅ Tool result: ${name}`));
  });

  agent.on('stream:start', () => {
    process.stdout.write(chalk.blue('\nARGUS: '));
  });

  agent.on('stream:delta', (delta) => {
    process.stdout.write(chalk.white(delta));
  });

  agent.on('stream:end', () => {
    console.log('\n');
  });

  agent.on('reasoning:update', (text) => {
    console.log(chalk.gray(`\n💭 ${text}`));
  });

  agent.on('task:created', (taskId, description) => {
    console.log(chalk.yellow(`\n📋 Task created: ${taskId}`));
    console.log(chalk.gray(`   ${description}`));
  });

  agent.on('error', (err) => {
    if (spinner) spinner.stop();
    console.error(chalk.red(`\n❌ Error: ${err.message}`));
  });

  // Welcome message
  console.log(chalk.bold.green('\n🌐 ARGUS Enterprise Agent\n'));
  console.log(chalk.gray('Type your message or command (Ctrl+C to exit):\n'));
  console.log(chalk.gray('Example commands:'));
  console.log(chalk.gray('  - "Query all active IoT sensors"'));
  console.log(chalk.gray('  - "Coordinate analysis task with agent-analytics-api"'));
  console.log(chalk.gray('  - "Audit security for ent-server-001"'));
  console.log(chalk.gray('  - "Analyze trends in production data"\n'));

  // Interactive loop
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(chalk.bold('You: '), async (input) => {
      if (!input.trim()) {
        prompt();
        return;
      }

      try {
        await agent.send(input);
      } catch (err) {
        // Error already handled by event listener
      }

      prompt();
    });
  };

  prompt();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.gray('\n\nShutting down ARGUS...'));
  process.exit(0);
});

main().catch(console.error);
