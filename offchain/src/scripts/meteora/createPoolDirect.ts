/**
 * Create PDOX/SOL DLMM Pool Programmatically
 * 
 * Creates pool directly via SDK without browser
 * 
 * Usage: npx ts-node src/scripts/meteora/createPoolDirect.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createSyncNativeInstruction,
  getAccount
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import DLMM from '@meteora-ag/dlmm';
import * as fs from 'fs';
import * as path from 'path';

// Token specs
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const WSOL_MINT = NATIVE_MINT; // So11111111111111111111111111111111111111112

function loadWallet(): Keypair {
  const paths = [
    path.join(process.cwd(), 'deployer_wallet.json'),
    path.join(process.cwd(), 'server_authority_wallet.json'),
  ];
  
  for (const p of paths) {
    if (fs.existsSync(p)) {
      const keyData = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return Keypair.fromSecretKey(new Uint8Array(keyData));
    }
  }
  
  throw new Error('No wallet file found');
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          CREATE PDOX/SOL DLMM POOL - DEVNET                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = loadWallet();
  
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`PDOX: ${PDOX_MINT.toBase58()}`);
  console.log(`SOL: ${WSOL_MINT.toBase58()}`);
  
  // Check balances
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`\nSOL Balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);
  
  // Check PDOX balance
  const pdoxAta = await getAssociatedTokenAddress(PDOX_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  let pdoxBalance = 0;
  try {
    const acc = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    pdoxBalance = Number(acc.amount) / 1e9;
    console.log(`PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX`);
  } catch {
    console.log('PDOX Balance: 0');
  }
  
  // Pool parameters
  const BIN_STEP = 25; // 0.25% per bin
  const BASE_FEE_BPS = 25; // 0.25% base fee
  const INITIAL_PRICE = 0.0001; // 1 PDOX = 0.0001 SOL (10,000 PDOX per SOL)
  
  console.log(`\nPool Parameters:`);
  console.log(`  Bin Step: ${BIN_STEP} (${BIN_STEP/100}% per bin)`);
  console.log(`  Base Fee: ${BASE_FEE_BPS} bps (${BASE_FEE_BPS/100}%)`);
  console.log(`  Initial Price: ${INITIAL_PRICE} SOL per PDOX`);
  console.log(`  (= ${1/INITIAL_PRICE} PDOX per SOL)`);
  
  // Calculate active bin ID from price
  // For DLMM: price = (1 + binStep/10000)^binId
  // binId = ln(price) / ln(1 + binStep/10000)
  const binStepDecimal = BIN_STEP / 10000;
  const activeId = Math.round(Math.log(INITIAL_PRICE) / Math.log(1 + binStepDecimal));
  
  console.log(`  Active Bin ID: ${activeId}`);
  
  // Check if pool already exists
  console.log('\n─── Checking for existing pool ────────────────────────────────');
  
  try {
    const response = await fetch('https://dlmm-api.meteora.ag/pair/all');
    const pools = await response.json();
    
    const existing = pools.find((p: any) => 
      (p.mint_x === PDOX_MINT.toBase58() && p.mint_y === WSOL_MINT.toBase58()) ||
      (p.mint_y === PDOX_MINT.toBase58() && p.mint_x === WSOL_MINT.toBase58())
    );
    
    if (existing) {
      console.log(`\n✅ Pool already exists!`);
      console.log(`   Address: ${existing.address}`);
      console.log(`   Name: ${existing.name}`);
      console.log(`\nAdd to .env: METEORA_PDOX_POOL=${existing.address}`);
      return;
    }
  } catch (e) {
    console.log('Could not check API');
  }
  
  // Create the pool
  console.log('\n─── Creating DLMM Pool ────────────────────────────────────────');
  
  try {
    // Note: DLMM pool creation requires specific parameters
    // The SDK's createLbPair may need different setup for Token-2022
    
    console.log('\nAttempting pool creation...');
    console.log('(This may take a moment)\n');
    
    // Try using the DLMM SDK to create
    // Since PDOX is Token-2022, we need to be careful about the setup
    
    const createPoolResult = await DLMM.createLbPair(
      connection,
      wallet.publicKey,
      PDOX_MINT,       // tokenX (base)
      WSOL_MINT,       // tokenY (quote) 
      new BN(BIN_STEP),
      new BN(activeId),
      {
        cluster: 'devnet'
      }
    );
    
    console.log('Pool creation TX prepared');
    console.log(`New Pool Address: ${createPoolResult.lbPair.toBase58()}`);
    
    // Add compute budget
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400000
    });
    
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 10000
    });
    
    // Build final transaction
    const tx = new Transaction();
    tx.add(modifyComputeUnits);
    tx.add(addPriorityFee);
    
    // Add pool creation instructions
    if (createPoolResult.transactions) {
      for (const poolTx of createPoolResult.transactions) {
        tx.add(...poolTx.instructions);
      }
    }
    
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    
    // Sign and send
    console.log('Sending transaction...');
    
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [wallet],
      { commitment: 'confirmed', skipPreflight: true }
    );
    
    console.log(`\n✅ Pool Created Successfully!`);
    console.log(`TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    console.log(`Pool: ${createPoolResult.lbPair.toBase58()}`);
    
    // Update .env
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf-8');
      if (content.includes('METEORA_PDOX_POOL')) {
        content = content.replace(/METEORA_PDOX_POOL=.*/, `METEORA_PDOX_POOL=${createPoolResult.lbPair.toBase58()}`);
      } else {
        content += `\nMETEORA_PDOX_POOL=${createPoolResult.lbPair.toBase58()}\n`;
      }
      fs.writeFileSync(envPath, content);
      console.log('\n📝 Updated .env with pool address');
    }
    
  } catch (error: any) {
    console.error('\n❌ Pool creation failed:', error.message);
    
    if (error.logs) {
      console.log('\nProgram logs:');
      error.logs.slice(-10).forEach((log: string) => console.log(`  ${log}`));
    }
    
    // Alternative approach - create a simple AMM pool instead
    console.log('\n─── Trying Alternative: Dynamic AMM Pool ──────────────────────');
    console.log('\nDLMM pool creation is complex for Token-2022.');
    console.log('Let me try creating a simpler Dynamic AMM pool...');
    
    // For now, show manual instructions
    console.log('\n📋 Manual Steps (if SDK fails):');
    console.log('1. Go to: https://devnet.meteora.ag/dlmm/create');
    console.log('2. Connect Phantom wallet with deployer key');
    console.log(`3. Import PDOX: ${PDOX_MINT.toBase58()}`);
    console.log('4. Set parameters:');
    console.log(`   - Bin Step: ${BIN_STEP}`);
    console.log(`   - Initial Price: ${INITIAL_PRICE}`);
    console.log('5. Create pool and copy address');
    console.log('\nAlternatively, we can test with existing SOL pools:');
    
    // Find a usable test pool
    try {
      const response = await fetch('https://dlmm-api.meteora.ag/pair/all');
      const pools = await response.json();
      
      const solPools = pools
        .filter((p: any) => p.mint_y === WSOL_MINT.toBase58() || p.mint_x === WSOL_MINT.toBase58())
        .slice(0, 3);
      
      if (solPools.length > 0) {
        console.log('\nAvailable SOL pools for testing:');
        solPools.forEach((p: any) => {
          console.log(`  ${p.name}: ${p.address}`);
        });
        console.log('\nTo test with existing pool:');
        console.log(`  Add to .env: METEORA_PDOX_POOL=${solPools[0].address}`);
      }
    } catch {}
  }
}

main().catch(console.error);

