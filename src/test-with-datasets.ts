/**
 * ARGUS Agent Testing with Datasets
 * 
 * Test the agent using the CSV datasets:
 * - consolidated_customers.csv (60 customers)
 * - orders_bureau_transactional_system.csv (747 orders)
 * - orders_office_goods.csv (747 orders)
 */

import { loadDataset, UnifiedDataset } from './dataset-integration.js';
import { createArgusAgent, ArgusAgent } from './agent.js';
import { enterpriseTools } from './tools.js';
import { productionMiddleware } from './middleware.js';
import { createProductionContextStack } from './context-engineering.js';

// ==================== Test Configuration ====================

interface TestConfig {
  apiKey: string;
  model: string;
  useMockData?: boolean;
}

// ==================== Dataset Tests ====================

/**
 * Test 1: Load and validate dataset
 */
export async function testDatasetLoading(): Promise<{
  success: boolean;
  dataset: UnifiedDataset | null;
  errors: string[];
}> {
  const errors: string[] = [];
  
  try {
    console.log('\n📊 Test 1: Loading dataset...');
    const dataset = loadDataset();
    
    // Validate
    if (dataset.metadata.totalCustomers !== 60) {
      errors.push(`Expected 60 customers, got ${dataset.metadata.totalCustomers}`);
    }
    if (dataset.metadata.totalOrders !== 1494) {
      errors.push(`Expected 1494 orders, got ${dataset.metadata.totalOrders}`);
    }
    if (dataset.entities.length === 0) {
      errors.push('No entities loaded');
    }
    if (dataset.tasks.length === 0) {
      errors.push('No tasks loaded');
    }
    
    console.log(`  ✅ Loaded: ${dataset.metadata.totalCustomers} customers, ${dataset.metadata.totalOrders} orders`);
    console.log(`  💰 Total value: ${dataset.metadata.totalValue.toFixed(2)} USDC`);
    
    return {
      success: errors.length === 0,
      dataset,
      errors,
    };
  } catch (error) {
    errors.push(`Failed to load dataset: ${error}`);
    return { success: false, dataset: null, errors };
  }
}

/**
 * Test 2: Query entities with agent
 */
export async function testEntityQuery(
  agent: ArgusAgent,
  dataset: UnifiedDataset
): Promise<{ success: boolean; result: string; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    console.log('\n🔍 Test 2: Entity query...');
    
    const query = `Query the entity registry and summarize the ${dataset.metadata.totalCustomers} business entities by their trust levels and source systems.`;
    
    const result = await agent.sendSync(query);
    console.log(`  ✅ Result: ${result.slice(0, 100)}...`);
    
    return { success: true, result, errors };
  } catch (error) {
    errors.push(`Entity query failed: ${error}`);
    return { success: false, result: '', errors };
  }
}

/**
 * Test 3: Analyze tasks with agent
 */
export async function testTaskAnalysis(
  agent: ArgusAgent,
  dataset: UnifiedDataset
): Promise<{ success: boolean; result: string; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    console.log('\n📋 Test 3: Task analysis...');
    
    // Get priority breakdown
    const critical = dataset.metadata.priorityBreakdown.critical;
    const high = dataset.metadata.priorityBreakdown.high;
    
    const query = `Analyze ${critical} critical and ${high} high priority tasks. Provide a coordination plan for handling these urgent orders.`;
    
    const result = await agent.sendSync(query);
    console.log(`  ✅ Result: ${result.slice(0, 100)}...`);
    
    return { success: true, result, errors };
  } catch (error) {
    errors.push(`Task analysis failed: ${error}`);
    return { success: false, result: '', errors };
  }
}

/**
 * Test 4: Security audit simulation
 */
export async function testSecurityAudit(
  agent: ArgusAgent,
  dataset: UnifiedDataset
): Promise<{ success: boolean; result: string; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    console.log('\n🔒 Test 4: Security audit...');
    
    const entity = dataset.entities[0];
    const query = `Perform a security audit on entity ${entity.identity.displayName} (${entity.entityId}). Check access controls and compliance.`;
    
    const result = await agent.sendSync(query);
    console.log(`  ✅ Result: ${result.slice(0, 100)}...`);
    
    return { success: true, result, errors };
  } catch (error) {
    errors.push(`Security audit failed: ${error}`);
    return { success: false, result: '', errors };
  }
}

/**
 * Test 5: Data analysis on orders
 */
export async function testDataAnalysis(
  agent: ArgusAgent,
  dataset: UnifiedDataset
): Promise<{ success: boolean; result: string; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    console.log('\n📈 Test 5: Data analysis...');
    
    const query = `Analyze the order data: ${dataset.metadata.systemBreakdown.bureau.count} bureau orders and ${dataset.metadata.systemBreakdown.officeGoods.count} office goods orders. Calculate total value and identify trends.`;
    
    const result = await agent.sendSync(query);
    console.log(`  ✅ Result: ${result.slice(0, 100)}...`);
    
    return { success: true, result, errors };
  } catch (error) {
    errors.push(`Data analysis failed: ${error}`);
    return { success: false, result: '', errors };
  }
}

// ==================== Main Test Runner ====================

export async function runAllTests(config: TestConfig): Promise<{
  passed: number;
  failed: number;
  results: Record<string, { success: boolean; errors: string[] }>;
}> {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║     ARGUS Agent Testing with Datasets             ║');
  console.log('╚════════════════════════════════════════════════════╝');
  
  const results: Record<string, { success: boolean; errors: string[] }> = {};
  let passed = 0;
  let failed = 0;
  
  // Test 1: Dataset loading
  const datasetTest = await testDatasetLoading();
  results['datasetLoading'] = { success: datasetTest.success, errors: datasetTest.errors };
  if (datasetTest.success) passed++; else failed++;
  
  if (!datasetTest.dataset) {
    console.log('\n❌ Cannot proceed without dataset');
    return { passed, failed, results };
  }
  
  // Initialize agent
  console.log('\n🤖 Initializing ARGUS agent...');
  const agent = createArgusAgent({
    apiKey: config.apiKey,
    model: config.model,
    tools: enterpriseTools,
    instructions: `You are ARGUS, an Enterprise Autonomy Agent.

You have access to enterprise tools for:
- Task coordination
- Entity management
- Security auditing
- Data analysis

Use these tools to process the loaded dataset of ${datasetTest.dataset.metadata.totalCustomers} customers and ${datasetTest.dataset.metadata.totalOrders} orders.

Provide concise, actionable responses with specific metrics and insights.`,
    maxSteps: 10,
  });
  
  // Add middleware for testing
  productionMiddleware.forEach(mw => {
    // In real implementation, would add to agent
    console.log(`  📦 Middleware: ${mw.name}`);
  });
  
  // Test 2: Entity query
  const entityTest = await testEntityQuery(agent, datasetTest.dataset);
  results['entityQuery'] = { success: entityTest.success, errors: entityTest.errors };
  if (entityTest.success) passed++; else failed++;
  
  // Test 3: Task analysis
  const taskTest = await testTaskAnalysis(agent, datasetTest.dataset);
  results['taskAnalysis'] = { success: taskTest.success, errors: taskTest.errors };
  if (taskTest.success) passed++; else failed++;
  
  // Test 4: Security audit
  const securityTest = await testSecurityAudit(agent, datasetTest.dataset);
  results['securityAudit'] = { success: securityTest.success, errors: securityTest.errors };
  if (securityTest.success) passed++; else failed++;
  
  // Test 5: Data analysis
  const dataTest = await testDataAnalysis(agent, datasetTest.dataset);
  results['dataAnalysis'] = { success: dataTest.success, errors: dataTest.errors };
  if (dataTest.success) passed++; else failed++;
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║                 Test Summary                        ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📊 Total:  ${passed + failed}`);
  
  if (failed > 0) {
    console.log('\n❌ Errors:');
    Object.entries(results).forEach(([name, result]) => {
      if (!result.success) {
        console.log(`  - ${name}:`);
        result.errors.forEach(e => console.log(`    ${e}`));
      }
    });
  }
  
  return { passed, failed, results };
}

// ==================== CLI Entry Point ====================

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY || 'sk-test-key';
  const model = process.env.ARGUS_MODEL || 'openrouter/auto';
  
  if (!apiKey || apiKey === 'sk-test-key') {
    console.warn('\n⚠️  No OPENROUTER_API_KEY found. Using mock mode.');
  }
  
  const config: TestConfig = {
    apiKey,
    model,
    useMockData: apiKey === 'sk-test-key',
  };
  
  try {
    const results = await runAllTests(config);
    
    if (results.failed === 0) {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    } else {
      console.log(`\n⚠️  ${results.failed} test(s) failed`);
      process.exit(1);
    }
  } catch (error) {
    console.error('\n💥 Test runner failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export default runAllTests;
