/**
 * Complete Test Environment Setup
 * 
 * Sets up PDOX/SOL liquidity pool on Meteora devnet for real testing
 * Based on LIVE_TESTS.md specifications
 * 
 * Usage: npx ts-node src/scripts/meteora/setupTestEnv.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  getAccount, 
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  createSyncNativeInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TOKEN SPECIFICATIONS (from LIVE_TESTS.md)
// ============================================================================

const PDOX_SPECS = {
  mint: new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF'),
  name: 'Phantom Paradox',
  symbol: 'PDOX',
  decimals: 9,
  totalSupply: 1_000_000_000, // 1B
  transferFee: 300, // 3% in bps
  tokenProgram: TOKEN_2022_PROGRAM_ID,
  mintAuthority: new PublicKey('3XBBYhqcV5fdF1j8Bs97wcAbj9AYEeVHcxZipaFcefr3'),
};

const PROGRAM_SPECS = {
  programId: new PublicKey('8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x'),
  globalConfig: new PublicKey('HHefAxKZQqaLj3V2Hd9XfTBRPe8av4JTmvE4DWiygER8'),
};

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ============================================================================
// WALLET LOADING
// ============================================================================

function loadWallet(keyPath?: string): Keypair {
  // Try multiple sources
  const sources = [
    keyPath,
    process.env.DEPLOYER_PRIVATE_KEY,
    process.env.SERVER_AUTHORITY_PRIVATE_KEY,
    path.join(process.cwd(), 'deployer_wallet.json'),
    path.join(process.cwd(), 'server_authority_wallet.json'),
  ].filter(Boolean);

  for (const source of sources) {
    try {
      if (!source) continue;
      
      // If it's a file path
      if (fs.existsSync(source)) {
        const keyData = JSON.parse(fs.readFileSync(source, 'utf-8'));
        return Keypair.fromSecretKey(new Uint8Array(keyData));
      }
      
      // If it's a base58 string
      if (source.length > 50 && !source.includes('/')) {
        return Keypair.fromSecretKey(bs58.decode(source));
      }
      
      // If it's a JSON array string
      if (source.startsWith('[')) {
        return Keypair.fromSecretKey(new Uint8Array(JSON.parse(source)));
      }
    } catch (e) {
      continue;
    }
  }
  
  throw new Error('No valid wallet found. Check deployer_wallet.json or set DEPLOYER_PRIVATE_KEY');
}

// ============================================================================
// MAIN SETUP
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       PHANTOM PARADOX - COMPLETE TEST ENVIRONMENT SETUP      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log('═══ Configuration ════════════════════════════════════════════\n');
  console.log(`RPC: ${rpcUrl}`);
  console.log(`PDOX Token: ${PDOX_SPECS.mint.toBase58()}`);
  console.log(`Program ID: ${PROGRAM_SPECS.programId.toBase58()}`);
  console.log(`Transfer Fee: ${PDOX_SPECS.transferFee / 100}%`);
  
  // Load wallet
  let wallet: Keypair;
  try {
    wallet = loadWallet();
    console.log(`\nWallet: ${wallet.publicKey.toBase58()}`);
  } catch (e: any) {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  }
  
  // ========================================================================
  // STEP 1: Verify Infrastructure
  // ========================================================================
  
  console.log('\n═══ Step 1: Verify Infrastructure ═══════════════════════════\n');
  
  // Check SOL balance
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`SOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
  
  if (solBalance < 0.5 * LAMPORTS_PER_SOL) {
    console.error('❌ Need at least 0.5 SOL for setup');
    console.log('\nGet devnet SOL:');
    console.log('  solana airdrop 2 --url devnet');
    console.log('  https://faucet.solana.com');
    process.exit(1);
  }
  console.log('✅ SOL balance sufficient');
  
  // Check PDOX token exists
  try {
    const mintInfo = await connection.getAccountInfo(PDOX_SPECS.mint);
    if (!mintInfo) throw new Error('Token not found');
    console.log(`✅ PDOX Token exists (${mintInfo.data.length} bytes)`);
  } catch (e) {
    console.error('❌ PDOX Token not found on devnet');
    process.exit(1);
  }
  
  // Check program exists
  try {
    const programInfo = await connection.getAccountInfo(PROGRAM_SPECS.programId);
    if (!programInfo?.executable) throw new Error('Program not executable');
    console.log('✅ Program deployed and executable');
  } catch (e) {
    console.error('❌ Program not found');
    process.exit(1);
  }
  
  // Check PDOX balance
  const pdoxAta = await getAssociatedTokenAddress(
    PDOX_SPECS.mint, 
    wallet.publicKey, 
    false, 
    TOKEN_2022_PROGRAM_ID
  );
  
  let pdoxBalance = 0;
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    pdoxBalance = Number(pdoxAccount.amount) / (10 ** PDOX_SPECS.decimals);
    console.log(`✅ PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX`);
  } catch {
    console.log('⚠️ No PDOX token account - will create');
  }
  
  // ========================================================================
  // STEP 2: Check/Create Meteora Pool
  // ========================================================================
  
  console.log('\n═══ Step 2: Meteora Pool Setup ═══════════════════════════════\n');
  
  // Check for existing PDOX pool
  let poolAddress = process.env.METEORA_PDOX_POOL;
  
  if (!poolAddress) {
    console.log('Searching for existing PDOX pools...');
    
    try {
      const response = await fetch('https://dlmm-api.meteora.ag/pair/all');
      const pools = await response.json();
      
      const pdoxPool = pools.find((p: any) => 
        p.mint_x === PDOX_SPECS.mint.toBase58() || 
        p.mint_y === PDOX_SPECS.mint.toBase58()
      );
      
      if (pdoxPool) {
        poolAddress = pdoxPool.address;
        console.log(`✅ Found existing PDOX pool: ${poolAddress}`);
        console.log(`   Name: ${pdoxPool.name}`);
      } else {
        console.log('❌ No PDOX pool found on Meteora');
      }
    } catch (e: any) {
      console.log(`API error: ${e.message}`);
    }
  } else {
    console.log(`Using configured pool: ${poolAddress}`);
  }
  
  if (!poolAddress) {
    console.log('\n📋 POOL CREATION REQUIRED\n');
    console.log('Since PDOX uses Token-2022 with transfer fees, create via Meteora UI:');
    console.log('\n1. Go to: https://app.meteora.ag/dlmm (switch to devnet if available)');
    console.log('\n2. Create new DLMM pool with:');
    console.log(`   Token X (Base):  ${PDOX_SPECS.mint.toBase58()}`);
    console.log(`   Token Y (Quote): ${WSOL_MINT.toBase58()} (Wrapped SOL)`);
    console.log('   Bin Step: 25 (0.25% per bin)');
    console.log('\n3. Add initial liquidity:');
    console.log('   - 1 SOL (will be wrapped to WSOL)');
    console.log('   - 100,000 PDOX (or proportional amount)');
    console.log('\n4. After creation, add pool address to .env:');
    console.log('   METEORA_PDOX_POOL=<pool_address>');
    console.log('\n5. Re-run this script');
    
    // Save progress
    const envUpdate = `
# Meteora Integration (add pool address after creation)
# METEORA_PDOX_POOL=<your_pool_address>
`;
    console.log('\n📝 Add to .env:', envUpdate);
    
    process.exit(0);
  }
  
  // ========================================================================
  // STEP 3: Test Pool Connection
  // ========================================================================
  
  console.log('\n═══ Step 3: Test Pool Connection ═════════════════════════════\n');
  
  const { MeteoraIntegration } = await import('../../integrations/meteora');
  
  const meteora = new MeteoraIntegration({
    connection,
    wallet,
    poolAddress: new PublicKey(poolAddress),
  });
  
  try {
    await meteora.connectToPool(new PublicKey(poolAddress));
    const poolInfo = await meteora.getPoolInfo();
    
    console.log('✅ Pool connected!');
    console.log(`   Token X: ${poolInfo.tokenX}`);
    console.log(`   Token Y: ${poolInfo.tokenY}`);
    console.log(`   Bin Step: ${poolInfo.binStep}`);
    console.log(`   Active Price: ${poolInfo.activeBinPrice}`);
    
  } catch (e: any) {
    console.error(`❌ Pool connection failed: ${e.message}`);
    console.log('\nThe pool may not exist or may be on a different network.');
    process.exit(1);
  }
  
  // ========================================================================
  // STEP 4: Check/Add Liquidity
  // ========================================================================
  
  console.log('\n═══ Step 4: Liquidity Check ══════════════════════════════════\n');
  
  const positions = await meteora.getUserPositions();
  
  if (positions.length > 0) {
    console.log(`✅ You have ${positions.length} LP position(s)`);
    positions.forEach((p, i) => {
      console.log(`   Position ${i + 1}: ${p.address}`);
      console.log(`     Bins: ${p.lowerBinId} - ${p.upperBinId}`);
    });
  } else {
    console.log('⚠️ No LP positions found');
    console.log('\nTo add liquidity:');
    console.log('  npm run meteora:liquidity 1 100000');
    console.log('  (Adds 1 SOL + 100,000 PDOX)');
  }
  
  // ========================================================================
  // STEP 5: Test Swap Quote
  // ========================================================================
  
  console.log('\n═══ Step 5: Test Swap Quote ══════════════════════════════════\n');
  
  try {
    const testAmount = new BN(0.01 * LAMPORTS_PER_SOL);
    const quote = await meteora.getSwapQuote(testAmount, false); // SOL -> PDOX
    
    console.log('✅ Swap quote received:');
    console.log(`   Input: 0.01 SOL`);
    console.log(`   Output: ${Number(quote.amountOut) / (10 ** PDOX_SPECS.decimals)} PDOX`);
    console.log(`   Fee: ${Number(quote.fee) / LAMPORTS_PER_SOL} SOL`);
    console.log(`   Price Impact: ${quote.priceImpact}%`);
    
  } catch (e: any) {
    console.log(`⚠️ Quote failed: ${e.message}`);
    console.log('   Pool may have no liquidity');
  }
  
  // ========================================================================
  // SUMMARY
  // ========================================================================
  
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                     SETUP COMPLETE                             ');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log('Environment Status:');
  console.log(`  ✅ PDOX Token: ${PDOX_SPECS.mint.toBase58()}`);
  console.log(`  ✅ Program: ${PROGRAM_SPECS.programId.toBase58()}`);
  console.log(`  ✅ Meteora Pool: ${poolAddress}`);
  console.log(`  ✅ Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  ✅ SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`  ✅ PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX`);
  
  console.log('\nNext Steps:');
  console.log('  1. Add liquidity (if needed):');
  console.log('     npm run meteora:liquidity 1 100000');
  console.log('\n  2. Test swap:');
  console.log('     npm run meteora:swap buy 0.1');
  console.log('\n  3. Run full integration test:');
  console.log('     npm run meteora:test');
  console.log('\n  4. Run netting engine with real swaps:');
  console.log('     npm run netting:demo');
  
  // Save pool address to .env if not already there
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    if (!envContent.includes('METEORA_PDOX_POOL')) {
      fs.appendFileSync(envPath, `\n# Meteora PDOX Pool\nMETEORA_PDOX_POOL=${poolAddress}\n`);
      console.log('\n📝 Added METEORA_PDOX_POOL to .env');
    }
  }
}

main().catch(console.error);

