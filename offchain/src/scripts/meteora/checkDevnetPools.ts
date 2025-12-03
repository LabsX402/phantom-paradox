/**
 * Check Devnet-Specific Meteora Pools
 * 
 * Usage: npx ts-node src/scripts/meteora/checkDevnetPools.ts
 */

import { Connection, PublicKey } from '@solana/web3.js';
import DLMM from '@meteora-ag/dlmm';

// Known devnet pool addresses to try
const DEVNET_POOLS = [
  // From devnet.meteora.ag homepage
  '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',  // SOL-USDC
  '9d9mb8kooFfaD3SctgZtkxQypkshx6ezhbKio89ixyy2', // TRUMP-USDC  
  'AXXo7N2gcLeVyo8nDsN99UW8Fv6NCsa2DP21WD3SKtM3', // FO-USDT
];

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              CHECK DEVNET METEORA POOLS                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('Testing known devnet pool addresses...\n');
  
  for (const poolAddr of DEVNET_POOLS) {
    console.log(`─── Testing ${poolAddr.slice(0, 8)}... ───`);
    
    try {
      // First check if account exists
      const accountInfo = await connection.getAccountInfo(new PublicKey(poolAddr));
      
      if (!accountInfo) {
        console.log('  ❌ Account not found on devnet\n');
        continue;
      }
      
      console.log(`  ✅ Account exists (${accountInfo.data.length} bytes)`);
      console.log(`  Owner: ${accountInfo.owner.toBase58()}`);
      
      // Try to connect via SDK
      try {
        const dlmmPool = await DLMM.create(connection, new PublicKey(poolAddr));
        const lbPair = dlmmPool.lbPair;
        
        console.log('  ✅ SDK connection successful!');
        console.log(`  Token X: ${lbPair.tokenXMint.toBase58()}`);
        console.log(`  Token Y: ${lbPair.tokenYMint.toBase58()}`);
        console.log(`  Bin Step: ${lbPair.binStep}`);
        console.log(`  Active ID: ${lbPair.activeId}`);
        
        // Get active bin
        const activeBin = await dlmmPool.getActiveBin();
        console.log(`  Price: ${activeBin.price}`);
        
        console.log('\n  🎉 THIS POOL WORKS!\n');
        
        // Return the working pool
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`\nWorking devnet pool found: ${poolAddr}`);
        console.log('\nAdd to .env:');
        console.log(`METEORA_TEST_POOL=${poolAddr}`);
        
        return poolAddr;
        
      } catch (e: any) {
        console.log(`  ❌ SDK error: ${e.message}\n`);
      }
      
    } catch (e: any) {
      console.log(`  ❌ Error: ${e.message}\n`);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('No working devnet pools found from known list.');
  console.log('\nThe Meteora devnet UI may use different pool addresses.');
  console.log('Try creating a new pool via: https://devnet.meteora.ag/dlmm/create');
}

main().catch(console.error);

