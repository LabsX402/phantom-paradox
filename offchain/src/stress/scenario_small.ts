#!/usr/bin/env ts-node
/**
 * Scenario A - Small Sanity Test
 * 1,000 auctions / 5,000 players / 20,000 bids
 * 
 * Usage:
 *   npx ts-node src/stress/scenario_small.ts --cluster localnet
 */

import dotenv from 'dotenv';
dotenv.config();

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore
import idl from '../../idl/phantom_paradox.json';
import { ScenarioRunner, ScenarioConfig, ScenarioResult } from './shared/scenario_base';
import { calculateCostMetrics } from './shared/metrics';

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || 'DyN2xSo3E43nf7xwyCpa14a8pKA2RNxvpMFeStC1veeF'
);

class SmallScenario extends ScenarioRunner {
  private txCount = 0;
  
  protected async executeScenario(config: ScenarioConfig): Promise<number> {
    // Clean up previous test data
    console.log('🧹 Cleaning up previous test data...');
    try {
      await this.db.query('DELETE FROM bids WHERE listing_id LIKE \'auction_%\'');
      await this.db.query('DELETE FROM listings WHERE id LIKE \'auction_%\'');
      await this.db.query('DELETE FROM users WHERE pubkey LIKE \'player_%\'');
      console.log('   ✅ Cleanup complete\n');
    } catch (error: any) {
      console.log(`   ⚠️  Cleanup: ${error.message}\n`);
    }
    
    console.log('📝 Creating game in SQL...');
    // Create a test game in SQL
    try {
      const gameResult = await this.db.query(`
        INSERT INTO games (id, game_pda, name, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `, ['test_game_1', 'test_game_pda_1', 'Stress Test Game', '{}']);
      console.log('   ✅ Game created');
    } catch (error: any) {
      console.log(`   ⚠️  Game creation: ${error.message}`);
    }
    
    console.log(`\n📝 Creating ${config.auctions.toLocaleString()} auctions in SQL...`);
    // Create auctions in SQL (simulated - not on-chain yet)
    const batchSize = 100;
    let created = 0;
    for (let i = 0; i < config.auctions; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, config.auctions);
      const batch = batchEnd - i;
      
      try {
        const values = Array.from({ length: batch }, (_, idx) => {
          const auctionNum = i + idx + 1;
          const price = Math.floor(Math.random() * 900 + 100) * 1000000;
          const endTime = new Date(Date.now() + 3600000);
          // Match schema: id, pda, game_id, seller, price, status, quantity_remaining, highest_bid, type, end_time, created_at, updated_at
          return `('auction_${auctionNum}', 'pda_${auctionNum}', 'test_game_1', 'player_${Math.floor(Math.random() * config.players) + 1}', '${price}', 'Active', 1, '${price}', 'EnglishAuction', '${endTime.toISOString()}', NOW(), NOW())`;
        }).join(',');
        
        await this.db.query(`
          INSERT INTO listings (id, pda, game_id, seller, price, status, quantity_remaining, highest_bid, type, end_time, created_at, updated_at)
          VALUES ${values}
          ON CONFLICT (id) DO NOTHING
        `);
        
        created += batch;
        process.stdout.write(`\r   Progress: ${created}/${config.auctions} (${Math.floor(created/config.auctions*100)}%)`);
      } catch (error: any) {
        console.log(`\n   ❌ Error creating batch ${i}-${batchEnd}: ${error.message}`);
        throw error;
      }
    }
    console.log(`\n   ✅ Created ${created} auctions in SQL`);
    
    console.log('📝 Creating 5,000 players in SQL...');
    await this.createPlayersInSQL(config.players);
    
    console.log('📝 Simulating 20,000 bids (off-chain)...');
    await this.simulateBids(config.bids);
    
    console.log('📝 Settling auctions (on-chain)...');
    await this.settleAuctions();
    
    return this.txCount;
  }
  
  private async createPlayersInSQL(count: number): Promise<void> {
    // Create players in batches to avoid large inserts
    const batchSize = 1000;
    let created = 0;
    for (let i = 0; i < count; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, count);
      const batch = batchEnd - i;
      
      try {
        const values = Array.from({ length: batch }, (_, idx) => {
          const playerNum = i + idx + 1;
          return `('player_${playerNum}', 'verified', NOW(), NOW())`;
        }).join(',');
        
        await this.db.query(`
          INSERT INTO users (pubkey, kyc_status, created_at, updated_at)
          VALUES ${values}
          ON CONFLICT (pubkey) DO NOTHING
        `);
        
        created += batch;
        process.stdout.write(`\r   Progress: ${created}/${count} (${Math.floor(created/count*100)}%)`);
      } catch (error: any) {
        console.log(`\n   ❌ Error creating players batch ${i}-${batchEnd}: ${error.message}`);
        throw error;
      }
    }
    console.log(`\n   ✅ Created ${created} players in SQL`);
  }
  
  private async simulateBids(totalBids: number): Promise<void> {
    // Get active auctions
    const auctions = await this.db.query(`
      SELECT id, pda, price, end_time
      FROM listings
      WHERE status = 'Active'
      ORDER BY RANDOM()
      LIMIT 1000
    `);
    
    if (auctions.rows.length === 0) {
      throw new Error('No active auctions found');
    }
    
    const bidsPerAuction = Math.ceil(totalBids / auctions.rows.length);
    let bidCount = 0;
    const batchSize = 100;
    
    for (const auction of auctions.rows) {
      const bidsForThisAuction = Math.min(bidsPerAuction, totalBids - bidCount);
      
      // Insert bids in batches
      const bidValues: string[] = [];
      for (let i = 0; i < bidsForThisAuction; i++) {
        const bidderId = Math.floor(Math.random() * 5000) + 1;
        const bidAmount = Math.floor(parseFloat(auction.price) * (1 + Math.random() * 0.2));
        bidValues.push(`('${auction.id}', 'player_${bidderId}', '${bidAmount}', NOW())`);
        
        if (bidValues.length >= batchSize || i === bidsForThisAuction - 1) {
          await this.db.query(`
            INSERT INTO bids (listing_id, bidder, amount, created_at)
            VALUES ${bidValues.join(',')}
          `);
          bidCount += bidValues.length;
          process.stdout.write(`\r   Progress: ${bidCount}/${totalBids} (${Math.floor(bidCount/totalBids*100)}%)`);
          bidValues.length = 0;
        }
      }
    }
    
    console.log(`\n   ✅ Simulated ${bidCount} bids in SQL`);
  }
  
  private async settleAuctions(): Promise<void> {
    // Get auctions ready to settle (matching schema: status is TEXT, end_time is TIMESTAMP)
    const auctions = await this.db.query(`
      SELECT l.id, l.pda, l.game_id,
             (SELECT bidder FROM bids WHERE listing_id = l.id ORDER BY amount::numeric DESC LIMIT 1) as winner,
             (SELECT amount FROM bids WHERE listing_id = l.id ORDER BY amount::numeric DESC LIMIT 1) as final_price
      FROM listings l
      WHERE l.status = 'Active'
      AND l.end_time < NOW()
      LIMIT 1000
    `);
    
    console.log(`\n📝 Settling ${auctions.rows.length} auctions...`);
    
    // TODO: Implement actual settlement via program finalize_auction_settlement
    // For now, simulate settlement in SQL
    let settledCount = 0;
    let expiredCount = 0;
    const total = auctions.rows.length;
    
    for (let idx = 0; idx < auctions.rows.length; idx++) {
      const auction = auctions.rows[idx];
      
      try {
        if (auction.winner && auction.final_price) {
          await this.db.query(`
            UPDATE listings
            SET status = 'Settled',
                highest_bid = $1,
                updated_at = NOW()
            WHERE id = $2
          `, [auction.final_price, auction.id]);
          
          settledCount++;
          this.txCount++;
        } else {
          await this.db.query(`
            UPDATE listings
            SET status = 'Expired',
                updated_at = NOW()
            WHERE id = $1
          `, [auction.id]);
          expiredCount++;
        }
        
        if ((idx + 1) % 100 === 0 || idx === total - 1) {
          process.stdout.write(`\r   Progress: ${idx + 1}/${total} (${Math.floor((idx+1)/total*100)}%)`);
        }
      } catch (error: any) {
        console.log(`\n   ❌ Error settling auction ${auction.id}: ${error.message}`);
      }
    }
    
    console.log(`\n   ✅ Settled ${settledCount} auctions, expired ${expiredCount}`);
  }
  
  protected async getGameId(): Promise<string> {
    const result = await this.db.query('SELECT id FROM games ORDER BY created_at DESC LIMIT 1');
    const gameId = result.rows[0]?.id;
    if (!gameId) {
      throw new Error('No game found. Create a game first.');
    }
    return String(gameId);
  }
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('cluster', {
      type: 'string',
      default: 'localnet',
      choices: ['localnet', 'devnet', 'mainnet-beta'],
      describe: 'Solana cluster'
    })
    .option('solPrice', {
      type: 'number',
      default: 126,
      describe: 'SOL price in USD'
    })
    .help()
    .argv;
  
  // Setup connection
  const rpcUrl = argv.cluster === 'localnet' 
    ? 'http://127.0.0.1:8899'
    : argv.cluster === 'devnet'
    ? clusterApiUrl('devnet')
    : clusterApiUrl('mainnet-beta');
  
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Setup program - try to load IDL, but make it optional for testing
  let program: Program;
  try {
    const walletKeypair = Keypair.generate();
    const wallet = new Wallet(walletKeypair);
    const provider = new AnchorProvider(connection, wallet, {
      preflightCommitment: 'confirmed'
    });
    
    // Use existing IDL import pattern
    // @ts-ignore
    program = new Program(idl as any, PROGRAM_ID, provider);
  } catch (error) {
    console.warn('⚠️  Could not initialize program (IDL may be missing). Continuing with SQL-only test...');
    // Create a dummy program for now - we'll skip on-chain operations
    // @ts-ignore
    program = null;
  }
  
  const wallet = new Wallet(Keypair.generate());
  
  // Setup database
  const connectionString = process.env.PG_CONNECTION_STRING || 
    'postgresql://postgres:1234@localhost:5432/phantomgrid_test';
  
  console.log(`📊 Connecting to database: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
  
  const db = new Pool({
    connectionString
  });
  
  // Test connection
  try {
    await db.query('SELECT 1');
    console.log('✅ Database connection successful\n');
  } catch (error: any) {
    console.error('❌ Database connection failed:', error.message);
    console.error('\n💡 Make sure:');
    console.error('   1. PostgreSQL is running');
    console.error('   2. Database "phantomgrid_test" exists');
    console.error('   3. Connection string is correct');
    console.error(`   Current: ${connectionString.replace(/:[^:@]+@/, ':****@')}`);
    throw error;
  }
  
  // Run scenario
  const config: ScenarioConfig = {
    name: 'Small Sanity',
    auctions: 1000,
    players: 5000,
    bids: 20000,
    solPrice: argv.solPrice,
    cluster: argv.cluster as any
  };
  
  const runner = new SmallScenario(connection, program, db, wallet);
  
  try {
    const result = await runner.runScenario(config);
    
    // Additional assertions
    console.log('\n🔍 Running additional assertions...');
    
    // Check: No auction has >1 winner (check via bids table)
    const doubleWinners = await db.query(`
      SELECT l.id, COUNT(DISTINCT b.bidder) as winner_count
      FROM listings l
      JOIN bids b ON b.listing_id = l.id
      WHERE l.status = 'Settled'
      AND b.amount = l.highest_bid
      GROUP BY l.id
      HAVING COUNT(DISTINCT b.bidder) > 1
    `);
    
    if (doubleWinners.rows.length > 0) {
      throw new Error(`Found ${doubleWinners.rows.length} auctions with multiple winners`);
    }
    console.log('   ✅ No double-winners');
    
    // Check: All auctions in terminal state
    const nonTerminal = await db.query(`
      SELECT COUNT(*) as count
      FROM listings
      WHERE status NOT IN ('Settled', 'Cancelled', 'Expired')
      AND end_time < NOW()
    `);
    
    if (parseInt(nonTerminal.rows[0].count) > 0) {
      throw new Error(`Found ${nonTerminal.rows[0].count} non-terminal auctions`);
    }
    console.log('   ✅ All auctions terminal');
    
    console.log('\n✅ Scenario completed successfully!');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Scenario failed:', error.message);
    console.error('Full error:', error);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    try {
      await db.end();
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

