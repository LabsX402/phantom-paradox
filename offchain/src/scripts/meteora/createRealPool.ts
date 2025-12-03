/**
 * Create Real PDOX/SOL Pool on Meteora Devnet
 * 
 * Now that Meteora supports Token-2022, we can create a real pool!
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// Config
const RPC_URL = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Load deployer wallet
function loadWallet(): Keypair {
  const walletPath = path.join(__dirname, '..', '..', '..', '..', 'deployer_wallet.json');
  const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         CREATE REAL PDOX/SOL POOL ON METEORA DEVNET          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadWallet();
  
  console.log('📍 Wallet:', wallet.publicKey.toBase58());
  console.log('🪙 PDOX Token:', PDOX_MINT.toBase58());
  console.log('');

  // Check SOL balance
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // Check PDOX balance
  try {
    const pdoxAta = await getAssociatedTokenAddress(
      PDOX_MINT,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    const pdoxBalance = Number(pdoxAccount.amount) / 1e9; // 9 decimals
    console.log(`🪙 PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX`);
    console.log(`   ATA: ${pdoxAta.toBase58()}`);
  } catch (e) {
    console.log('❌ No PDOX balance found');
    console.log('   Need to mint PDOX first or transfer some');
  }

  console.log('\n' + '─'.repeat(60) + '\n');

  // Instructions for creating pool on Meteora
  console.log('📋 METEORA DLMM POOL CREATION\n');
  console.log('Since Meteora now supports Token-2022 (announced Nov 27, 2025),');
  console.log('we can create a real PDOX/SOL pool!\n');
  
  console.log('🔗 OPTION 1: Use Meteora UI (Recommended)');
  console.log('─'.repeat(40));
  console.log('1. Go to: https://app.meteora.ag/dlmm/create');
  console.log('2. Connect wallet:', wallet.publicKey.toBase58());
  console.log('3. Select Token X: PDOX (' + PDOX_MINT.toBase58() + ')');
  console.log('4. Select Token Y: SOL (wrapped)');
  console.log('5. Set bin step: 25 (0.25% per bin)');
  console.log('6. Set initial price based on desired MC');
  console.log('7. Add liquidity: 1 SOL + equivalent PDOX');
  console.log('');

  console.log('🔗 OPTION 2: Use Meteora SDK');
  console.log('─'.repeat(40));
  console.log('The Meteora DLMM SDK now supports Token-2022.');
  console.log('See: https://docs.meteora.ag/overview/products/dlmm/token-2022-extensions');
  console.log('');
  
  console.log('TransferFeeConfig is PERMISSIONLESS - no badge needed!');
  console.log('');

  // Calculate suggested initial liquidity
  const suggestedSol = 1; // Start with 1 SOL
  const suggestedPrice = 0.0000136; // ~$136 MC at 10M supply
  const suggestedPdox = suggestedSol / suggestedPrice;
  
  console.log('💡 SUGGESTED INITIAL LIQUIDITY:');
  console.log('─'.repeat(40));
  console.log(`   SOL: ${suggestedSol} SOL (~$${(suggestedSol * 136).toFixed(0)})`);
  console.log(`   PDOX: ${suggestedPdox.toLocaleString()} PDOX`);
  console.log(`   Initial Price: ${suggestedPrice} SOL/PDOX`);
  console.log(`   Initial MC: ~$${(suggestedPdox * suggestedPrice * 136).toFixed(0)}`);
  console.log('');

  console.log('📝 AFTER POOL CREATION:');
  console.log('─'.repeat(40));
  console.log('1. Copy the pool address from Meteora');
  console.log('2. Update .env with: METEORA_PDOX_POOL=<pool_address>');
  console.log('3. Run: npm run meteora:test to verify');
  console.log('4. All buys/sells will have real TX hashes!');
  console.log('');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Ready! Go to Meteora UI to create the pool.                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

main().catch(console.error);

