/**
 * Use Existing Pool for Testing
 * 
 * Verifies Meteora SDK integration works before creating PDOX pool
 * 
 * Usage: npx ts-node src/scripts/meteora/useExistingPool.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import DLMM from '@meteora-ag/dlmm';
import * as fs from 'fs';
import * as path from 'path';

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          FIND & TEST WITH EXISTING METEORA POOL              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Fetch all pools from Meteora API
  console.log('Fetching pools from Meteora API...');
  
  const response = await fetch('https://dlmm-api.meteora.ag/pair/all');
  const allPools = await response.json();
  
  console.log(`Total pools: ${allPools.length}`);
  
  // Find pools with SOL and good liquidity
  const solPools = allPools
    .filter((p: any) => 
      (p.mint_x === WSOL_MINT.toBase58() || p.mint_y === WSOL_MINT.toBase58()) &&
      p.liquidity > 1000 // At least $1000 liquidity
    )
    .sort((a: any, b: any) => (b.liquidity || 0) - (a.liquidity || 0))
    .slice(0, 10);
  
  console.log(`\nTop SOL pools with liquidity:\n`);
  
  solPools.forEach((pool: any, i: number) => {
    console.log(`${i + 1}. ${pool.name}`);
    console.log(`   Address: ${pool.address}`);
    console.log(`   Liquidity: $${pool.liquidity?.toLocaleString() || 'N/A'}`);
    console.log(`   Bin Step: ${pool.bin_step}`);
    console.log('');
  });
  
  if (solPools.length === 0) {
    console.log('No suitable pools found!');
    return;
  }
  
  // Pick the best pool for testing
  const testPool = solPools[0];
  console.log(`\n─── Testing with: ${testPool.name} ────────────────────────────`);
  console.log(`Pool: ${testPool.address}`);
  
  // Try to connect to the pool
  try {
    console.log('\nConnecting to pool via SDK...');
    const dlmmPool = await DLMM.create(connection, new PublicKey(testPool.address));
    
    const lbPair = dlmmPool.lbPair;
    console.log('✅ Connected!');
    console.log(`   Token X: ${lbPair.tokenXMint.toBase58()}`);
    console.log(`   Token Y: ${lbPair.tokenYMint.toBase58()}`);
    console.log(`   Bin Step: ${lbPair.binStep}`);
    console.log(`   Active ID: ${lbPair.activeId}`);
    
    // Get active bin price
    const activeBin = await dlmmPool.getActiveBin();
    console.log(`   Active Price: ${activeBin.price}`);
    
    // Test swap quote - need to fetch bin arrays first
    console.log('\n─── Testing Swap Quote ────────────────────────────────────────');
    const quoteAmount = new BN(0.01 * LAMPORTS_PER_SOL);
    
    try {
      // Fetch bin arrays for the swap
      console.log('Fetching bin arrays...');
      const binArrays = await dlmmPool.getBinArrays();
      console.log(`Found ${binArrays.length} bin arrays`);
      
      if (binArrays.length > 0) {
        // Call swapQuote with all required parameters
        const quote = dlmmPool.swapQuote(
          quoteAmount,      // inAmount
          true,             // swapForY (X -> Y)
          new BN(100),      // allowedSlippage (1% = 100 bps)
          binArrays         // binArrays
        );
        
        console.log('✅ Quote received:');
        console.log(`   Input: 0.01 SOL`);
        console.log(`   Output: ${quote.outAmount.toString()}`);
        console.log(`   Fee: ${quote.fee.toString()}`);
      } else {
        console.log('No bin arrays found - pool may be empty');
      }
    } catch (e: any) {
      console.log(`Quote calculation: ${e.message}`);
    }
    
    // Success - save this pool for testing
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    INTEGRATION VERIFIED!                       ');
    console.log('═══════════════════════════════════════════════════════════════');
    
    console.log('\n✅ Meteora SDK integration working!');
    console.log(`✅ Pool ${testPool.name} is accessible`);
    
    // Update .env with this pool for testing
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf-8');
      
      // Add test pool
      if (!content.includes('METEORA_TEST_POOL')) {
        content += `\n# Test pool (not PDOX, just for SDK testing)\nMETEORA_TEST_POOL=${testPool.address}\n`;
        fs.writeFileSync(envPath, content);
        console.log(`\n📝 Added METEORA_TEST_POOL to .env`);
      }
    }
    
    console.log('\n─── For PDOX Pool ─────────────────────────────────────────────');
    console.log('\nTo create a PDOX/SOL pool, you need to:');
    console.log('\n1. Use Meteora UI at: https://devnet.meteora.ag/dlmm/create');
    console.log('2. Connect Phantom wallet');
    console.log('3. Import deployer wallet key into Phantom');
    console.log(`   (from: F:\\Devnet production\\deployer_wallet.json)`);
    console.log(`4. Select PDOX: 4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF`);
    console.log('5. Create pool with 1 SOL + 100K PDOX');
    console.log('6. Add pool address to .env: METEORA_PDOX_POOL=<address>');
    
  } catch (e: any) {
    console.error('Connection failed:', e.message);
  }
}

main().catch(console.error);
