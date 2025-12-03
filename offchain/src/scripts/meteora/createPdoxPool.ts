/**
 * Create PDOX/SOL Pool on Meteora Devnet
 * 
 * Pool creation via SDK is complex and requires specific setup.
 * This script helps find existing pools or guides through UI creation.
 * 
 * Usage: npx ts-node src/scripts/meteora/createPdoxPool.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { PDOX_MINT, WSOL_MINT, METEORA_DLMM_PROGRAM_ID, fetchAllPools, findPoolsForToken } from '../../integrations/meteora';

// Load wallet from env
function loadWallet(): Keypair {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.SERVER_AUTHORITY_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('No wallet key found in env. Set DEPLOYER_PRIVATE_KEY or SERVER_AUTHORITY_PRIVATE_KEY');
  }
  
  try {
    // Try base58 first
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    // Try JSON array
    const keyArray = JSON.parse(privateKey);
    return Keypair.fromSecretKey(new Uint8Array(keyArray));
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           PDOX/SOL Pool Setup on Meteora Devnet              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  // Setup
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = loadWallet();
  
  console.log('Configuration:');
  console.log(`  RPC: ${rpcUrl}`);
  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  PDOX Mint: ${PDOX_MINT.toBase58()}`);
  console.log(`  WSOL Mint: ${WSOL_MINT.toBase58()}`);
  console.log(`  Meteora Program: ${METEORA_DLMM_PROGRAM_ID.toBase58()}`);
  
  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`\nWallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.warn('\n⚠️ Low balance. Get devnet SOL from:');
    console.log('  - https://faucet.solana.com');
    console.log('  - https://faucet.raccoons.dev');
  }
  
  // Check if pool already exists via API
  console.log('\n─── Searching for Existing PDOX Pools ─────────────────────────');
  
  try {
    const pdoxPools = await findPoolsForToken(PDOX_MINT.toBase58());
    
    if (pdoxPools.length > 0) {
      console.log(`\n✅ Found ${pdoxPools.length} existing PDOX pool(s):`);
      
      pdoxPools.forEach((pool: any, i: number) => {
        console.log(`\n  Pool ${i + 1}:`);
        console.log(`    Address: ${pool.address}`);
        console.log(`    Name: ${pool.name}`);
        console.log(`    Token X: ${pool.mint_x}`);
        console.log(`    Token Y: ${pool.mint_y}`);
        console.log(`    Bin Step: ${pool.bin_step}`);
        console.log(`    Liquidity: $${pool.liquidity?.toFixed(2) || 'N/A'}`);
      });
      
      const solPool = pdoxPools.find((p: any) => 
        p.mint_y === WSOL_MINT.toBase58() || p.mint_x === WSOL_MINT.toBase58()
      );
      
      if (solPool) {
        console.log(`\n📝 Add this to your .env:`);
        console.log(`METEORA_PDOX_POOL=${solPool.address}`);
      }
      
      return;
    }
    
    console.log('No existing PDOX pools found in Meteora API.');
    
  } catch (e: any) {
    console.log(`Could not query API: ${e.message}`);
  }
  
  // Pool doesn't exist - show creation instructions
  console.log('\n─── Pool Creation Instructions ────────────────────────────────');
  console.log('\nTo create a new PDOX/SOL DLMM pool:');
  console.log('\n1. Go to Meteora App:');
  console.log('   https://app.meteora.ag/dlmm');
  console.log('\n2. Switch to Devnet (if available in UI)');
  console.log('   Or use: https://devnet.meteora.ag');
  console.log('\n3. Click "Create New Pool"');
  console.log('\n4. Enter Pool Parameters:');
  console.log(`   Token X (Base): ${PDOX_MINT.toBase58()}`);
  console.log(`   Token Y (Quote): ${WSOL_MINT.toBase58()} (Wrapped SOL)`);
  console.log('   Bin Step: 25 (recommended for volatile pairs)');
  console.log('   Initial Price: Set based on desired PDOX/SOL rate');
  console.log('\n5. Add Initial Liquidity:');
  console.log('   Recommended: 1 SOL + equivalent PDOX');
  console.log('\n6. After creation, copy the Pool Address');
  console.log('\n7. Add to .env:');
  console.log('   METEORA_PDOX_POOL=<your_pool_address>');
  
  // Alternative: Use existing test pools
  console.log('\n─── Alternative: Use Existing Test Pools ──────────────────────');
  console.log('\nIf you want to test with existing devnet pools:');
  
  try {
    const allPools = await fetchAllPools();
    // Get some sample pools
    const samplePools = allPools.slice(0, 5);
    
    if (samplePools.length > 0) {
      console.log('\nSample available pools:');
      samplePools.forEach((pool: any) => {
        console.log(`  - ${pool.name}: ${pool.address}`);
      });
      
      console.log('\nSet any pool in .env to test integration:');
      console.log(`METEORA_PDOX_POOL=${samplePools[0].address}`);
    }
  } catch (e: any) {
    console.log('Could not fetch sample pools.');
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('After setting up pool, run:');
  console.log('  npm run meteora:test     - Full integration test');
  console.log('  npm run meteora:liquidity - Add liquidity');
  console.log('  npm run meteora:swap buy 0.1 - Test swap');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
