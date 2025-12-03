/**
 * Base scenario runner with common functionality
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { runAllInvariants, InvariantCheckResult } from './invariants';
import { calculateCostMetrics, CostMetrics } from './metrics';

export interface ScenarioConfig {
  name: string;
  auctions: number;
  players: number;
  bids: number;
  solPrice: number;
  cluster: 'localnet' | 'devnet' | 'mainnet-beta';
  concurrency?: number;
}

export interface ScenarioResult {
  config: ScenarioConfig;
  startTime: number;
  endTime: number;
  duration: number;
  metrics: CostMetrics;
  invariants: InvariantCheckResult[];
  txCount: number;
  errors: string[];
  passed: boolean;
}

export class ScenarioRunner {
  protected connection: Connection;
  protected program: Program;
  protected db: Pool;
  protected wallet: Wallet;
  private results: ScenarioResult;
  
  constructor(
    connection: Connection,
    program: Program,
    db: Pool,
    wallet: Wallet
  ) {
    this.connection = connection;
    this.program = program;
    this.db = db;
    this.wallet = wallet;
  }
  
  async runScenario(config: ScenarioConfig): Promise<ScenarioResult> {
    console.log(`\n🚀 Starting scenario: ${config.name}`);
    console.log(`   Auctions: ${config.auctions.toLocaleString()}`);
    console.log(`   Players: ${config.players.toLocaleString()}`);
    console.log(`   Bids: ${config.bids.toLocaleString()}\n`);
    
    const startTime = Date.now();
    const errors: string[] = [];
    
    try {
      // Calculate metrics
      const metrics = calculateCostMetrics(
        config.auctions,
        config.players,
        config.bids,
        config.solPrice
      );
      
      // Run scenario-specific logic (to be implemented by subclasses)
      const txCount = await this.executeScenario(config);
      
      // Run invariant checks
      console.log('\n🔍 Running invariant checks...');
      const gameId = await this.getGameId(); // Implement based on your setup
      const invariants = await runAllInvariants(
        this.db,
        gameId,
        100, // protocolBps - adjust based on your config
        50   // gameFeeBps - adjust based on your config
      );
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      const allInvariantsPassed = invariants.every(i => i.passed);
      
      this.results = {
        config,
        startTime,
        endTime,
        duration,
        metrics,
        invariants,
        txCount,
        errors,
        passed: allInvariantsPassed && errors.length === 0
      };
      
      // Print results
      this.printResults();
      
      // Export results
      await this.exportResults();
      
      return this.results;
    } catch (error: any) {
      errors.push(error.message || String(error));
      const endTime = Date.now();
      
      this.results = {
        config,
        startTime,
        endTime,
        duration: endTime - startTime,
        metrics: calculateCostMetrics(config.auctions, config.players, config.bids, config.solPrice),
        invariants: [],
        txCount: 0,
        errors,
        passed: false
      };
      
      throw error;
    }
  }
  
  protected async executeScenario(config: ScenarioConfig): Promise<number> {
    // Override in subclasses
    throw new Error('executeScenario must be implemented by subclass');
  }
  
  protected async getGameId(): Promise<string | number> {
    // Override based on your game setup
    const result = await this.db.query('SELECT id FROM games ORDER BY created_at DESC LIMIT 1');
    return result.rows[0]?.id || '1';
  }
  
  private printResults(): void {
    console.log('\n📊 Scenario Results:');
    console.log(`   Duration: ${(this.results.duration / 1000).toFixed(2)}s`);
    console.log(`   Transactions: ${this.results.txCount.toLocaleString()}`);
    console.log(`   Cost (Merkle): $${this.results.metrics.merkleCostUsd.toFixed(2)}`);
    console.log(`   Cost per auction: $${this.results.metrics.costPerAuctionMerkle.toFixed(6)}`);
    
    console.log('\n🔍 Invariant Checks:');
    this.results.invariants.forEach(check => {
      const icon = check.passed ? '✅' : '❌';
      console.log(`   ${icon} ${check.name}: ${check.message}`);
      if (!check.passed && check.details) {
        console.log(`      Details: ${JSON.stringify(check.details).slice(0, 200)}...`);
      }
    });
    
    if (this.results.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.results.errors.forEach(err => console.log(`   - ${err}`));
    }
    
    const icon = this.results.passed ? '✅' : '❌';
    console.log(`\n${icon} Scenario ${this.results.passed ? 'PASSED' : 'FAILED'}`);
  }
  
  private async exportResults(): Promise<void> {
    const logsDir = path.resolve(__dirname, '../../../logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const filename = `stress_${this.results.config.name.toLowerCase().replace(/\s+/g, '_')}.json`;
    const filepath = path.join(logsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(this.results, null, 2));
    console.log(`\n💾 Results exported to ${filepath}`);
  }
}

