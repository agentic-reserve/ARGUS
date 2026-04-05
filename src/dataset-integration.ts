/**
 * ARGUS Dataset Integration Pipeline
 * 
 * Integrates mock datasets from CSV files:
 * - consolidated_customers.csv (60 records)
 * - orders_bureau_transactional_system.csv (747 records)
 * - orders_office_goods.csv (747 records)
 * 
 * Outputs:
 * - ARGUS entities (customers as Business entities)
 * - ARGUS tasks (orders as coordination tasks)
 * - Analytics data
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== Types ====================

export interface ConsolidatedCustomer {
  officegoods_customer_id: string;
  bureau_customer_id: string;
  consolidated_customer_id: string;
  customer_name: string;
}

export interface BureauOrder {
  order_id: string;
  customer_id: string;
  status: 'open' | 'closed' | 'assigned';
  assignee: string;
  quantity: number;
  item_name: string;
  unit_price: number;
  order_due_date: string;
  days_until_due: number;
}

export interface OfficeGoodsOrder {
  dueDateTime: string;
  orderId: string;
  customer_id: string;
  orderPlacementDate: string;
  status: 'assigned' | 'closed' | 'open';
  assignee: string;
  quantity: number;
  item_name: string;
  unit_price: number;
  days_until_due: number;
}

export interface UnifiedOrder {
  orderId: string;
  source: 'bureau' | 'office_goods';
  consolidatedCustomerId: string;
  customerName: string;
  status: string;
  assignee: string | null;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  dueDate: string;
  daysUntilDue: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

// ==================== CSV Parser ====================

function parseCSV(content: string): string[][] {
  const lines = content.trim().split('\n');
  return lines.map(line => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function csvToObjects<T>(content: string, mapper: (row: string[], headers: string[]) => T): T[] {
  const rows = parseCSV(content);
  if (rows.length < 2) return [];
  
  const headers = rows[0];
  return rows.slice(1).map(row => mapper(row, headers));
}

// ==================== Data Loaders ====================

export function loadConsolidatedCustomers(csvPath: string): ConsolidatedCustomer[] {
  const content = fs.readFileSync(csvPath, 'utf-8');
  return csvToObjects(content, (row, headers) => ({
    officegoods_customer_id: row[0] || '',
    bureau_customer_id: row[1] || '',
    consolidated_customer_id: row[2] || '',
    customer_name: row[3] || '',
  }));
}

export function loadBureauOrders(csvPath: string): BureauOrder[] {
  const content = fs.readFileSync(csvPath, 'utf-8');
  return csvToObjects(content, (row, headers) => ({
    order_id: row[0] || '',
    customer_id: row[1] || '',
    status: row[2] as BureauOrder['status'],
    assignee: row[3] || '',
    quantity: parseInt(row[4]) || 0,
    item_name: row[5] || '',
    unit_price: parseInt(row[6]) || 0,
    order_due_date: row[7] || '',
    days_until_due: parseInt(row[8]) || 0,
  }));
}

export function loadOfficeGoodsOrders(csvPath: string): OfficeGoodsOrder[] {
  const content = fs.readFileSync(csvPath, 'utf-8');
  return csvToObjects(content, (row, headers) => ({
    dueDateTime: row[0] || '',
    orderId: row[1] || '',
    customer_id: row[2] || '',
    orderPlacementDate: row[3] || '',
    status: row[4] as OfficeGoodsOrder['status'],
    assignee: row[5] || '',
    quantity: parseInt(row[6]) || 0,
    item_name: row[7] || '',
    unit_price: parseInt(row[8]) || 0,
    days_until_due: parseInt(row[9]) || 0,
  }));
}

// ==================== Entity Mapping ====================

export interface BusinessEntity {
  entityId: string;
  entityType: 'Business';
  trustLevel: 'Partner' | 'Vendor' | 'Internal';
  identity: {
    displayName: string;
    identifier: string;
    department: string;
    owner: string;
  };
  metadata: {
    sourceSystems: string[];
    bureauId?: string;
    officeGoodsId?: string;
  };
}

export function mapCustomersToEntities(customers: ConsolidatedCustomer[]): BusinessEntity[] {
  return customers.map((customer, index) => ({
    entityId: `ent-business-${String(index + 1).padStart(3, '0')}`,
    entityType: 'Business' as const,
    trustLevel: 'Partner' as const,
    identity: {
      displayName: customer.customer_name,
      identifier: customer.consolidated_customer_id,
      department: 'External',
      owner: 'system',
    },
    metadata: {
      sourceSystems: [
        customer.bureau_customer_id ? 'bureau' : null,
        customer.officegoods_customer_id ? 'office_goods' : null,
      ].filter(Boolean) as string[],
      bureauId: customer.bureau_customer_id || undefined,
      officeGoodsId: customer.officegoods_customer_id || undefined,
    },
  }));
}

// ==================== Task Conversion ====================

export interface CoordinationTask {
  taskId: string;
  intent: {
    category: 'Coordinate' | 'Fulfill' | 'Process';
    type: string;
  };
  parameters: {
    priority: 'low' | 'medium' | 'high' | 'critical';
    orderDetails: {
      itemName: string;
      quantity: number;
      unitPrice: number;
      totalValue: number;
    };
    customerId: string;
    sourceSystem: 'bureau' | 'office_goods';
  };
  constraints: {
    requiredCapabilities: string[];
    deadline?: string;
    maxLatency?: number;
  };
  status: 'Pending' | 'InProgress' | 'Completed' | 'Assigned';
  assignedTo: string | null;
  createdAt: string;
  funding?: {
    currency: string;
    amount: string;
  };
}

function calculatePriority(daysUntilDue: number, status: string): CoordinationTask['parameters']['priority'] {
  if (daysUntilDue < 0) return 'critical';
  if (daysUntilDue <= 3) return 'high';
  if (daysUntilDue <= 7) return 'medium';
  return 'low';
}

export function convertBureauOrdersToTasks(orders: BureauOrder[], customerMap: Map<string, ConsolidatedCustomer>): CoordinationTask[] {
  return orders.map((order, index) => {
    const customer = customerMap.get(order.customer_id);
    const priority = calculatePriority(order.days_until_due, order.status);
    
    return {
      taskId: `task-bureau-${String(index + 1).padStart(4, '0')}`,
      intent: {
        category: 'Fulfill',
        type: 'Order Processing',
      },
      parameters: {
        priority,
        orderDetails: {
          itemName: order.item_name,
          quantity: order.quantity,
          unitPrice: order.unit_price,
          totalValue: order.quantity * order.unit_price,
        },
        customerId: customer?.consolidated_customer_id || order.customer_id,
        sourceSystem: 'bureau',
      },
      constraints: {
        requiredCapabilities: ['order_fulfillment', 'inventory_check'],
        deadline: order.order_due_date,
        maxLatency: order.days_until_due > 0 ? order.days_until_due * 24 * 60 * 60 * 1000 : 0,
      },
      status: order.status === 'closed' ? 'Completed' : 
              order.status === 'assigned' ? 'Assigned' : 'Pending',
      assignedTo: order.assignee || null,
      createdAt: new Date().toISOString(),
      funding: {
        currency: 'USDC',
        amount: (order.quantity * order.unit_price * 0.01).toFixed(2),
      },
    };
  });
}

export function convertOfficeGoodsOrdersToTasks(orders: OfficeGoodsOrder[], customerMap: Map<string, ConsolidatedCustomer>): CoordinationTask[] {
  return orders.map((order, index) => {
    const customer = customerMap.get(order.customer_id);
    const priority = calculatePriority(order.days_until_due, order.status);
    
    return {
      taskId: `task-office-${String(index + 1).padStart(4, '0')}`,
      intent: {
        category: 'Fulfill',
        type: 'Order Processing',
      },
      parameters: {
        priority,
        orderDetails: {
          itemName: order.item_name,
          quantity: order.quantity,
          unitPrice: order.unit_price,
          totalValue: order.quantity * order.unit_price,
        },
        customerId: customer?.consolidated_customer_id || order.customer_id,
        sourceSystem: 'office_goods',
      },
      constraints: {
        requiredCapabilities: ['order_fulfillment', 'inventory_check'],
        deadline: order.dueDateTime,
        maxLatency: order.days_until_due > 0 ? order.days_until_due * 24 * 60 * 60 * 1000 : 0,
      },
      status: order.status === 'closed' ? 'Completed' : 
              order.status === 'assigned' ? 'Assigned' : 'Pending',
      assignedTo: order.assignee || null,
      createdAt: order.orderPlacementDate,
      funding: {
        currency: 'USDC',
        amount: (order.quantity * order.unit_price * 0.01).toFixed(2),
      },
    };
  });
}

// ==================== Unified Dataset ====================

export interface UnifiedDataset {
  entities: BusinessEntity[];
  tasks: CoordinationTask[];
  metadata: {
    totalCustomers: number;
    totalOrders: number;
    totalValue: number;
    systemBreakdown: {
      bureau: { count: number; value: number };
      officeGoods: { count: number; value: number };
    };
    priorityBreakdown: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  };
}

export function createUnifiedDataset(
  customers: ConsolidatedCustomer[],
  bureauOrders: BureauOrder[],
  officeGoodsOrders: OfficeGoodsOrder[]
): UnifiedDataset {
  // Create customer lookup map
  const customerMap = new Map<string, ConsolidatedCustomer>();
  for (const customer of customers) {
    if (customer.bureau_customer_id) {
      customerMap.set(customer.bureau_customer_id, customer);
    }
    if (customer.officegoods_customer_id) {
      customerMap.set(customer.officegoods_customer_id, customer);
    }
  }

  // Map to entities and tasks
  const entities = mapCustomersToEntities(customers);
  const bureauTasks = convertBureauOrdersToTasks(bureauOrders, customerMap);
  const officeTasks = convertOfficeGoodsOrdersToTasks(officeGoodsOrders, customerMap);
  const allTasks = [...bureauTasks, ...officeTasks];

  // Calculate metadata
  const totalValue = allTasks.reduce((sum, task) => sum + parseFloat(task.funding?.amount || '0'), 0);
  
  const priorityBreakdown = {
    critical: allTasks.filter(t => t.parameters.priority === 'critical').length,
    high: allTasks.filter(t => t.parameters.priority === 'high').length,
    medium: allTasks.filter(t => t.parameters.priority === 'medium').length,
    low: allTasks.filter(t => t.parameters.priority === 'low').length,
  };

  const bureauValue = bureauTasks.reduce((sum, t) => sum + parseFloat(t.funding?.amount || '0'), 0);
  const officeValue = officeTasks.reduce((sum, t) => sum + parseFloat(t.funding?.amount || '0'), 0);

  return {
    entities,
    tasks: allTasks,
    metadata: {
      totalCustomers: customers.length,
      totalOrders: allTasks.length,
      totalValue,
      systemBreakdown: {
        bureau: { count: bureauOrders.length, value: bureauValue },
        officeGoods: { count: officeGoodsOrders.length, value: officeValue },
      },
      priorityBreakdown,
    },
  };
}

// ==================== Export Functions ====================

export function exportToJSON(dataset: UnifiedDataset, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2), 'utf-8');
}

export function exportEntitiesToCSV(entities: BusinessEntity[], outputPath: string): void {
  const headers = 'entity_id,entity_type,trust_level,display_name,identifier,department,source_systems\n';
  const rows = entities.map(e => 
    `${e.entityId},${e.entityType},${e.trustLevel},"${e.identity.displayName}",${e.identity.identifier},${e.identity.department},"${e.metadata.sourceSystems.join(',')}"`
  ).join('\n');
  fs.writeFileSync(outputPath, headers + rows, 'utf-8');
}

export function exportTasksToCSV(tasks: CoordinationTask[], outputPath: string): void {
  const headers = 'task_id,intent_category,intent_type,priority,customer_id,source_system,item_name,quantity,total_value,status,assigned_to,funding_amount\n';
  const rows = tasks.map(t => 
    `${t.taskId},${t.intent.category},${t.intent.type},${t.parameters.priority},${t.parameters.customerId},${t.parameters.sourceSystem},"${t.parameters.orderDetails.itemName}",${t.parameters.orderDetails.quantity},${t.parameters.orderDetails.totalValue},${t.status},${t.assignedTo || ''},${t.funding?.amount || 0}`
  ).join('\n');
  fs.writeFileSync(outputPath, headers + rows, 'utf-8');
}

// ==================== Main Loader ====================

export function loadDataset(basePath: string = '/Users/macbook/colo/dataset/csv'): UnifiedDataset {
  const customers = loadConsolidatedCustomers(path.join(basePath, 'consolidated_customers.csv'));
  const bureauOrders = loadBureauOrders(path.join(basePath, 'orders_bureau_transactional_system.csv'));
  const officeGoodsOrders = loadOfficeGoodsOrders(path.join(basePath, 'orders_office_goods.csv'));
  
  return createUnifiedDataset(customers, bureauOrders, officeGoodsOrders);
}

// CLI usage
if (require.main === module) {
  const dataset = loadDataset();
  
  console.log('📊 ARGUS Dataset Integration');
  console.log('============================');
  console.log(`Entities (Customers): ${dataset.metadata.totalCustomers}`);
  console.log(`Tasks (Orders): ${dataset.metadata.totalOrders}`);
  console.log(`Total Value: ${dataset.metadata.totalValue.toFixed(2)} USDC`);
  console.log('');
  console.log('System Breakdown:');
  console.log(`  Bureau: ${dataset.metadata.systemBreakdown.bureau.count} orders (${dataset.metadata.systemBreakdown.bureau.value.toFixed(2)} USDC)`);
  console.log(`  Office Goods: ${dataset.metadata.systemBreakdown.officeGoods.count} orders (${dataset.metadata.systemBreakdown.officeGoods.value.toFixed(2)} USDC)`);
  console.log('');
  console.log('Priority Breakdown:');
  console.log(`  Critical: ${dataset.metadata.priorityBreakdown.critical}`);
  console.log(`  High: ${dataset.metadata.priorityBreakdown.high}`);
  console.log(`  Medium: ${dataset.metadata.priorityBreakdown.medium}`);
  console.log(`  Low: ${dataset.metadata.priorityBreakdown.low}`);
  
  // Export to JSON
  exportToJSON(dataset, '/Users/macbook/colo/dataset/data/argus-unified-dataset.json');
  exportEntitiesToCSV(dataset.entities, '/Users/macbook/colo/dataset/csv/argus_entities_from_data.csv');
  exportTasksToCSV(dataset.tasks, '/Users/macbook/colo/dataset/csv/argus_tasks_from_data.csv');
  
  console.log('');
  console.log('✅ Exported to:');
  console.log('  - data/argus-unified-dataset.json');
  console.log('  - csv/argus_entities_from_data.csv');
  console.log('  - csv/argus_tasks_from_data.csv');
}
