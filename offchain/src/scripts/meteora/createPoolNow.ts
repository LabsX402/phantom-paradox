/**
 * Create PDOX/SOL Pool on Meteora DLMM - NOW
 * 
 * Programmatic pool creation using Meteora SDK
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  getAccount, 
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT
} from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// Config
const RPC_URL = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const WSOL_MINT = NATIVE_MINT;

// Meteora Program IDs
const METEORA_DLMM_PROGRAM = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

// Load deployer wallet
function loadWallet(): Keypair {
  const walletPath = path.join(__dirname, '..', '..', '..', '..', 'deployer_wallet.json');
  const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         CREATE PDOX/SOL DLMM POOL - METEORA DEVNET           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadWallet();
  
  console.log('📍 Wallet:', wallet.publicKey.toBase58());
  console.log('🪙 PDOX:', PDOX_MINT.toBase58());
  console.log('🌐 Network: Devnet');
  console.log('');

  // Check balances
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 SOL: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const pdoxAta = await getAssociatedTokenAddress(
    PDOX_MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  let pdoxBalance = 0;
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    pdoxBalance = Number(pdoxAccount.amount) / 1e9;
    console.log(`🪙 PDOX: ${pdoxBalance.toLocaleString()} PDOX`);
  } catch {
    console.log('❌ No PDOX balance');
    return;
  }

  console.log('\n' + '─'.repeat(60) + '\n');

  // Pool parameters
  const SOL_AMOUNT = 1 * LAMPORTS_PER_SOL; // 1 SOL
  const PDOX_AMOUNT = 10_000_000 * 1e9; // 10M PDOX (for 1B supply, this gives $136 MC)
  const BIN_STEP = 25; // 0.25% per bin - good for volatile pairs
  
  console.log('📊 POOL PARAMETERS:');
  console.log(`   SOL: ${SOL_AMOUNT / LAMPORTS_PER_SOL} SOL`);
  console.log(`   PDOX: ${PDOX_AMOUNT / 1e9} PDOX`);
  console.log(`   Bin Step: ${BIN_STEP} (${BIN_STEP / 100}%)`);
  console.log(`   Initial Price: ${(SOL_AMOUNT / PDOX_AMOUNT).toFixed(10)} SOL/PDOX`);
  console.log('');

  // Check if pool already exists
  console.log('🔍 Checking for existing pools...');
  
  try {
    // Try to find existing pool
    const response = await fetch(`https://dlmm-api.meteora.ag/pair/all`);
    const pools = await response.json();
    
    const existingPool = pools.find((p: any) => 
      (p.mint_x === PDOX_MINT.toBase58() && p.mint_y === WSOL_MINT.toBase58()) ||
      (p.mint_y === PDOX_MINT.toBase58() && p.mint_x === WSOL_MINT.toBase58())
    );
    
    if (existingPool) {
      console.log('✅ Pool already exists!');
      console.log(`   Address: ${existingPool.address}`);
      console.log(`   Name: ${existingPool.name}`);
      console.log(`   TVL: $${existingPool.tvl || 0}`);
      console.log('');
      console.log('Add to .env:');
      console.log(`METEORA_PDOX_POOL=${existingPool.address}`);
      return;
    }
    
    console.log('   No existing pool found - creating new one...');
  } catch (e) {
    console.log('   API check failed, proceeding with creation...');
  }

  console.log('\n🚀 CREATING POOL...\n');

  try {
    // Create pool using DLMM SDK
    // Note: This requires the Meteora DLMM program to support Token-2022
    
    const activeBinId = 0; // Start at bin 0, price will be calculated
    
    // Initialize DLMM pool
    console.log('Step 1: Preparing pool initialization...');
    
    // For Token-2022, we need to use the correct method
    // The SDK should handle this automatically now
    
    const createPoolTx = await DLMM.createLbPair(
      connection,
      wallet.publicKey,
      PDOX_MINT, // Token X (base)
      WSOL_MINT, // Token Y (quote)
      new BN(BIN_STEP),
      new BN(100), // Base fee: 1%
      new BN(activeBinId),
      { cluster: 'devnet' }
    );
    
    console.log('Step 2: Signing and sending transaction...');
    
    // Handle single tx or array of txs
    const txs = Array.isArray(createPoolTx) ? createPoolTx : [createPoolTx];
    
    for (const tx of txs) {
      if (tx instanceof Transaction) {
        tx.feePayer = wallet.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        
        const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
          commitment: 'confirmed',
          skipPreflight: true,
        });
        console.log(`   TX: ${sig}`);
      }
    }
    
    console.log('\n✅ POOL CREATED!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Find pool address in transaction logs');
    console.log('2. Add liquidity using Meteora UI');
    console.log('3. Update .env with pool address');
    
  } catch (e: any) {
    console.log('\n❌ Pool creation failed:', e.message);
    console.log('');
    console.log('This could be because:');
    console.log('1. Token-2022 requires special handling');
    console.log('2. Pool may need to be created via Meteora UI');
    console.log('3. Devnet might have different requirements');
    console.log('');
    console.log('📋 MANUAL CREATION:');
    console.log('─'.repeat(40));
    console.log('1. Go to: https://app.meteora.ag/dlmm/create');
    console.log('2. Connect wallet:', wallet.publicKey.toBase58());
    console.log('3. Paste Token X address:', PDOX_MINT.toBase58());
    console.log('4. Token Y: SOL');
    console.log('5. Bin Step: 25');
    console.log('6. Add 1 SOL + 10M PDOX');
    console.log('');
    console.log('Then paste the pool address here to continue.');
  }
}

main().catch(console.error);

