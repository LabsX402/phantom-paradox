/**
 * Find PDOX Pools on Meteora
 * 
 * Simple script to search for existing pools - no wallet needed
 * 
 * Usage: npx ts-node src/scripts/meteora/findPools.ts
 */

import { PDOX_MINT, WSOL_MINT, fetchAllPools, findPoolsForToken } from '../../integrations/meteora';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Meteora Pool Search                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  console.log(`Searching for PDOX: ${PDOX_MINT.toBase58()}`);
  
  // Search for PDOX pools
  console.log('\n─── PDOX Pools ─────────────────────────────────────────────────');
  
  try {
    const pdoxPools = await findPoolsForToken(PDOX_MINT.toBase58());
    
    if (pdoxPools.length > 0) {
      console.log(`Found ${pdoxPools.length} PDOX pool(s):\n`);
      
      pdoxPools.forEach((pool: any, i: number) => {
        console.log(`Pool ${i + 1}: ${pool.name}`);
        console.log(`  Address: ${pool.address}`);
        console.log(`  Token X: ${pool.mint_x}`);
        console.log(`  Token Y: ${pool.mint_y}`);
        console.log(`  Bin Step: ${pool.bin_step}`);
        console.log(`  TVL: $${pool.liquidity?.toFixed(2) || '0'}`);
        console.log('');
      });
      
      const solPool = pdoxPools.find((p: any) => 
        p.mint_y === WSOL_MINT.toBase58() || p.mint_x === WSOL_MINT.toBase58()
      );
      
      if (solPool) {
        console.log('✅ PDOX/SOL pool found!');
        console.log(`\nAdd to .env:\nMETEORA_PDOX_POOL=${solPool.address}`);
      }
    } else {
      console.log('No PDOX pools found.');
    }
  } catch (e: any) {
    console.log(`API error: ${e.message}`);
  }
  
  // Show some sample pools
  console.log('\n─── Sample Available Pools (for testing) ────────────────────────');
  
  try {
    const allPools = await fetchAllPools();
    console.log(`Total pools in Meteora: ${allPools.length}\n`);
    
    // Show first 10 with SOL
    const solPools = allPools
      .filter((p: any) => p.mint_x === WSOL_MINT.toBase58() || p.mint_y === WSOL_MINT.toBase58())
      .slice(0, 10);
    
    if (solPools.length > 0) {
      console.log('SOL pair pools:');
      solPools.forEach((pool: any) => {
        console.log(`  ${pool.name}: ${pool.address}`);
      });
    }
    
    console.log('\n📝 To use any pool for testing:');
    console.log('   Add to .env: METEORA_PDOX_POOL=<pool_address>');
    
  } catch (e: any) {
    console.log(`Could not fetch pools: ${e.message}`);
  }
}

main().catch(console.error);

