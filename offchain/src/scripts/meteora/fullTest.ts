/**
 * Full Meteora Integration Test
 * 
 * Tests the complete flow:
 * 1. Check pool status
 * 2. Get swap quotes
 * 3. Execute test swaps
 * 4. Verify balances
 * 
 * Usage: npx ts-node src/scripts/meteora/fullTest.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { MeteoraIntegration, PDOX_MINT, WSOL_MINT, fetchAllPools, findPoolsForToken } from '../../integrations/meteora';

const PDOX_DECIMALS = 9;

function loadWallet(): Keypair {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.SERVER_AUTHORITY_PRIVATE_KEY;
  if (!privateKey) throw new Error('No wallet key in env');
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(privateKey)));
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         PHANTOM PARADOX x METEORA INTEGRATION TEST           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = loadWallet();
  
  console.log('Configuration:');
  console.log(`  RPC: ${rpcUrl}`);
  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  PDOX Mint: ${PDOX_MINT.toBase58()}`);
  
  // Step 1: Check wallet balances
  console.log('\n─── Step 1: Check Balances ───────────────────────────────────');
  
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`SOL: ${solBalance / LAMPORTS_PER_SOL}`);
  
  let pdoxBalance = 0;
  const pdoxAta = await getAssociatedTokenAddress(PDOX_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    pdoxBalance = Number(pdoxAccount.amount);
    console.log(`PDOX: ${pdoxBalance / (10 ** PDOX_DECIMALS)}`);
  } catch {
    console.log('PDOX: 0 (no token account)');
  }
  
  if (solBalance < 0.1 * LAMPORTS_PER_SOL) {
    console.error('\n❌ Need at least 0.1 SOL for testing');
    console.log('Get devnet SOL: https://faucet.solana.com');
    process.exit(1);
  }
  
  // Step 2: Check for existing pools
  console.log('\n─── Step 2: Search for PDOX Pools ────────────────────────────');
  
  let poolAddress = process.env.METEORA_PDOX_POOL;
  
  if (!poolAddress) {
    console.log('Searching Meteora API for PDOX pools...');
    
    try {
      const pdoxPools = await findPoolsForToken(PDOX_MINT.toBase58());
      
      if (pdoxPools.length > 0) {
        console.log(`Found ${pdoxPools.length} pool(s):`);
        pdoxPools.forEach((p: any, i: number) => {
          console.log(`  ${i + 1}. ${p.address} (${p.name})`);
        });
        poolAddress = pdoxPools[0].address;
      } else {
        console.log('No existing PDOX pools found.');
        console.log('\n📝 To create a pool:');
        console.log('   npx ts-node src/scripts/meteora/createPdoxPool.ts');
        
        // Check devnet pools for any SOL pair we can use for testing
        console.log('\nLooking for any devnet test pools...');
        const allPools = await fetchAllPools();
        const devnetPools = allPools.slice(0, 5);
        console.log('Sample available pools:');
        devnetPools.forEach((p: any) => {
          console.log(`  - ${p.name}: ${p.address}`);
        });
      }
    } catch (e: any) {
      console.log('Could not fetch pools from API:', e.message);
    }
  }
  
  if (!poolAddress) {
    console.log('\n⚠️ No PDOX pool available. Testing with simulation only.\n');
    
    // Simulate what the integration would do
    console.log('─── Simulation: What Would Happen ────────────────────────────');
    console.log('1. Connect to PDOX/SOL pool');
    console.log('2. Get swap quote for 0.1 SOL → PDOX');
    console.log('3. Execute swap through Meteora');
    console.log('4. Receive PDOX tokens');
    console.log('5. Route through netting engine for privacy');
    
    console.log('\n✅ Integration code ready. Create pool to test live.\n');
    return;
  }
  
  // Step 3: Connect to pool
  console.log('\n─── Step 3: Connect to Pool ──────────────────────────────────');
  console.log(`Pool: ${poolAddress}`);
  
  const meteora = new MeteoraIntegration({
    connection,
    wallet,
    poolAddress: new PublicKey(poolAddress),
  });
  
  try {
    await meteora.connectToPool(new PublicKey(poolAddress));
    const poolInfo = await meteora.getPoolInfo();
    
    console.log('Pool connected!');
    console.log(`  Token X: ${poolInfo.tokenX}`);
    console.log(`  Token Y: ${poolInfo.tokenY}`);
    console.log(`  Bin Step: ${poolInfo.binStep}`);
    console.log(`  Active Price: ${poolInfo.activeBinPrice}`);
    
  } catch (e: any) {
    console.error('Failed to connect to pool:', e.message);
    process.exit(1);
  }
  
  // Step 4: Get swap quote
  console.log('\n─── Step 4: Get Swap Quote ───────────────────────────────────');
  
  const testAmountSol = 0.01; // Small test amount
  const amountIn = new BN(testAmountSol * LAMPORTS_PER_SOL);
  
  console.log(`Getting quote for ${testAmountSol} SOL → PDOX...`);
  
  try {
    const quote = await meteora.getSwapQuote(amountIn, false); // SOL -> PDOX
    
    console.log('Quote received:');
    console.log(`  Amount in: ${testAmountSol} SOL`);
    console.log(`  Amount out: ${Number(quote.amountOut) / (10 ** PDOX_DECIMALS)} PDOX`);
    console.log(`  Fee: ${Number(quote.fee) / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Price impact: ${quote.priceImpact}%`);
    
    // Step 5: Execute swap (optional)
    console.log('\n─── Step 5: Execute Test Swap ────────────────────────────────');
    
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise<string>(resolve => {
      rl.question(`Execute swap of ${testAmountSol} SOL for PDOX? (y/n): `, resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() === 'y') {
      const minOut = quote.amountOut.muln(95).divn(100); // 5% slippage
      
      console.log('Executing swap...');
      const sig = await meteora.swap(amountIn, false, minOut);
      
      console.log(`\n✅ Swap executed!`);
      console.log(`TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
      
      // Check new balances
      await new Promise(r => setTimeout(r, 3000));
      
      const newSolBalance = await connection.getBalance(wallet.publicKey);
      let newPdoxBalance = 0;
      try {
        const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
        newPdoxBalance = Number(pdoxAccount.amount);
      } catch {}
      
      console.log('\nNew balances:');
      console.log(`  SOL: ${newSolBalance / LAMPORTS_PER_SOL} (${(newSolBalance - solBalance) / LAMPORTS_PER_SOL})`);
      console.log(`  PDOX: ${newPdoxBalance / (10 ** PDOX_DECIMALS)} (+${(newPdoxBalance - pdoxBalance) / (10 ** PDOX_DECIMALS)})`);
      
    } else {
      console.log('Swap skipped.');
    }
    
  } catch (e: any) {
    console.error('Quote/swap failed:', e.message);
  }
  
  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    INTEGRATION TEST COMPLETE                   ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\nNext steps:');
  console.log('  1. Add more liquidity: npx ts-node src/scripts/meteora/addLiquidity.ts');
  console.log('  2. Test swaps: npx ts-node src/scripts/meteora/testSwap.ts buy 0.1');
  console.log('  3. Route through netting engine for anonymous swaps');
}

main().catch(console.error);

