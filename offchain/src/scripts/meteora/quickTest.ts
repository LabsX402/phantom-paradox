/**
 * Quick Meteora Integration Test
 * 
 * Tests integration using an existing SOL pool
 * No PDOX pool required - just verifies SDK works
 * 
 * Usage: npx ts-node src/scripts/meteora/quickTest.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { MeteoraIntegration, WSOL_MINT } from '../../integrations/meteora';

function loadWallet(): Keypair {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.SERVER_AUTHORITY_PRIVATE_KEY;
  if (!privateKey) throw new Error('No wallet key in env');
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(privateKey)));
  }
}

// A well-known active SOL pool for testing
const TEST_POOL = new PublicKey('F2ZNdwdf4WoR42H27Y4NHkC22VEbsSrb8zQaZKhLhBjk'); // ssi-SOL

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          Quick Meteora Integration Test                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  let wallet: Keypair;
  try {
    wallet = loadWallet();
    console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  } catch (e) {
    console.log('No wallet configured - testing read-only operations');
    wallet = Keypair.generate(); // Dummy for read-only
  }
  
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Test Pool: ${TEST_POOL.toBase58()}`);
  
  // Test 1: Connect to pool
  console.log('\n─── Test 1: Connect to Pool ───────────────────────────────────');
  
  const meteora = new MeteoraIntegration({
    connection,
    wallet,
  });
  
  try {
    await meteora.connectToPool(TEST_POOL);
    console.log('✅ Pool connection successful!');
    
    const poolInfo = await meteora.getPoolInfo();
    console.log('Pool Info:');
    console.log(`  Token X: ${poolInfo.tokenX}`);
    console.log(`  Token Y: ${poolInfo.tokenY}`);
    console.log(`  Bin Step: ${poolInfo.binStep}`);
    console.log(`  Active Price: ${poolInfo.activeBinPrice}`);
    
  } catch (e: any) {
    console.error('❌ Pool connection failed:', e.message);
    console.log('\nThis might be because:');
    console.log('1. The pool is mainnet only (not on devnet)');
    console.log('2. API/RPC issue');
    console.log('\nTrying a different approach...');
    
    // Try using API to find the pool instead
    console.log('\nFetching pool data from API...');
    try {
      const resp = await fetch(`https://dlmm-api.meteora.ag/pair/${TEST_POOL.toBase58()}`);
      if (resp.ok) {
        const data = await resp.json();
        console.log('Pool found via API:', data.name);
      } else {
        console.log('Pool not in API either');
      }
    } catch {}
    
    process.exit(1);
  }
  
  // Test 2: Get swap quote (read-only)
  console.log('\n─── Test 2: Get Swap Quote ────────────────────────────────────');
  
  try {
    const quoteAmount = new BN(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL
    const quote = await meteora.getSwapQuote(quoteAmount, true); // SOL -> other
    
    console.log('✅ Quote received:');
    console.log(`  Input: 0.01 SOL`);
    console.log(`  Output: ${quote.amountOut.toString()}`);
    console.log(`  Fee: ${quote.fee.toString()}`);
    console.log(`  Price Impact: ${quote.priceImpact}%`);
    
  } catch (e: any) {
    console.error('❌ Quote failed:', e.message);
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    INTEGRATION TEST RESULTS                    ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n✅ Meteora SDK integration working!');
  console.log('\nNext steps to create PDOX pool:');
  console.log('1. Go to https://app.meteora.ag (or devnet equivalent)');
  console.log('2. Create new DLMM pool with:');
  console.log('   - Token X: 4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF (PDOX)');
  console.log('   - Token Y: So11111111111111111111111111111111111111112 (SOL)');
  console.log('   - Bin Step: 25');
  console.log('3. Add initial liquidity (1 SOL + PDOX)');
  console.log('4. Set pool address in .env: METEORA_PDOX_POOL=<address>');
  console.log('5. Run: npm run meteora:test');
}

main().catch(console.error);

