#!/usr/bin/env ts-node
/**
 * Scenario A - Small Sanity Test (MOCK MODE - No Database Required)
 * Demonstrates progress indicators and metrics without DB
 */

import { calculateCostMetrics, formatMetrics, exportMetrics } from './shared/metrics';
import * as path from 'path';
import * as fs from 'fs';

interface MockResult {
  config: {
    name: string;
    auctions: number;
    players: number;
    bids: number;
    solPrice: number;
  };
  startTime: number;
  endTime: number;
  duration: number;
  metrics: ReturnType<typeof calculateCostMetrics>;
  txCount: number;
  passed: boolean;
}

async function simulateWork(name: string, total: number, delay: number = 10): Promise<void> {
  process.stdout.write(`\n📝 ${name}...\n`);
  for (let i = 0; i < total; i++) {
    await new Promise(resolve => setTimeout(resolve, delay));
    const percent = Math.floor((i + 1) / total * 100);
    process.stdout.write(`\r   Progress: ${i + 1}/${total} (${percent}%)`);
  }
  console.log(`\n   ✅ Completed ${total} ${name}`);
}

async function main() {
  const startTime = Date.now();
  
  const config = {
    name: 'Small Sanity (Mock)',
    auctions: 1000,
    players: 5000,
    bids: 20000,
    solPrice: 126
  };
  
  console.log(`\n🚀 Starting scenario: ${config.name}`);
  console.log(`   Auctions: ${config.auctions.toLocaleString()}`);
  console.log(`   Players: ${config.players.toLocaleString()}`);
  console.log(`   Bids: ${config.bids.toLocaleString()}\n`);
  
  // Simulate creating auctions
  await simulateWork('Creating auctions', config.auctions, 5);
  
  // Simulate creating players
  await simulateWork('Creating players', config.players, 2);
  
  // Simulate bids
  await simulateWork('Simulating bids', config.bids, 1);
  
  // Simulate settlement
  await simulateWork('Settling auctions', config.auctions, 3);
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  // Calculate metrics
  const metrics = calculateCostMetrics(
    config.auctions,
    config.players,
    config.bids,
    config.solPrice
  );
  
  console.log('\n📊 Scenario Results:');
  console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(`   Transactions: ${metrics.merkleTxCount.toLocaleString()}`);
  console.log(`   Cost (Merkle): $${metrics.merkleCostUsd.toFixed(2)}`);
  console.log(`   Cost per auction: $${metrics.costPerAuctionMerkle.toFixed(6)}`);
  
  console.log('\n' + formatMetrics(metrics));
  
  // Export results
  const logsDir = path.resolve(__dirname, '../../logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  const result: MockResult = {
    config,
    startTime,
    endTime,
    duration,
    metrics,
    txCount: metrics.merkleTxCount,
    passed: true
  };
  
  const filepath = path.join(logsDir, 'stress_scenario_small_mock.json');
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  
  console.log(`\n💾 Results exported to ${filepath}`);
  console.log('\n✅ Scenario completed successfully!');
  console.log('\n💡 To run with real database:');
  console.log('   1. Start PostgreSQL');
  console.log('   2. Create database: CREATE DATABASE phantomgrid_test;');
  console.log('   3. Run migrations');
  console.log('   4. Run: npm run stress:small');
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});

