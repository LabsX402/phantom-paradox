/**
 * Wallet Consolidation Script
 * 
 * Consolidates all SOL from test wallets into the deployer wallet.
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.devnet.solana.com';

// Root directory
const ROOT = path.join(__dirname, '..', '..', '..');

// All wallet files to check
const WALLET_FILES = [
  'deployer_wallet.json',
  'server_authority_wallet.json',
  'test_anon_wallets.json',
  'offchain/deployer_wallet.json',
  'offchain/server_authority_wallet.json',
];

interface WalletInfo {
  name: string;
  publicKey: PublicKey;
  keypair: Keypair;
  balance: number;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           WALLET CONSOLIDATION - DEVNET                      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load master wallet (deployer)
  const masterPath = path.join(ROOT, 'deployer_wallet.json');
  const masterKeypairData = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));
  const masterKeypair = Keypair.fromSecretKey(Uint8Array.from(masterKeypairData));
  const masterPubkey = masterKeypair.publicKey;
  
  console.log(`📍 MASTER WALLET: ${masterPubkey.toBase58()}\n`);
  
  // Collect all wallets (avoid duplicates by pubkey)
  const seenPubkeys = new Set<string>();
  const wallets: WalletInfo[] = [];
  
  for (const filePath of WALLET_FILES) {
    try {
      const fullPath = path.join(ROOT, filePath);
      if (!fs.existsSync(fullPath)) continue;
      
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      
      // Handle different formats
      if (Array.isArray(data)) {
        // Direct keypair array
        const keypair = Keypair.fromSecretKey(Uint8Array.from(data));
        const pubStr = keypair.publicKey.toBase58();
        
        if (!seenPubkeys.has(pubStr)) {
          seenPubkeys.add(pubStr);
          const balance = await connection.getBalance(keypair.publicKey);
          wallets.push({
            name: path.basename(filePath),
            publicKey: keypair.publicKey,
            keypair,
            balance: balance / LAMPORTS_PER_SOL,
          });
        }
      } else if (data.walletA || data.walletB) {
        // test_anon_wallets format
        for (const key of ['walletA', 'walletB', 'walletC', 'walletD', 'walletE']) {
          if (data[key]) {
            const keypair = Keypair.fromSecretKey(Uint8Array.from(data[key].secretKey));
            const pubStr = keypair.publicKey.toBase58();
            
            if (!seenPubkeys.has(pubStr)) {
              seenPubkeys.add(pubStr);
              const balance = await connection.getBalance(keypair.publicKey);
              wallets.push({
                name: `${path.basename(filePath)}:${key}`,
                publicKey: keypair.publicKey,
                keypair,
                balance: balance / LAMPORTS_PER_SOL,
              });
            }
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ Could not load ${filePath}: ${e}`);
    }
  }
  
  // Display all balances
  console.log('📊 WALLET BALANCES:\n');
  console.log('─'.repeat(70));
  
  let totalToConsolidate = 0;
  
  for (const wallet of wallets) {
    const isMaster = wallet.publicKey.equals(masterPubkey);
    const marker = isMaster ? '👑 MASTER' : '';
    console.log(`${wallet.name}`);
    console.log(`   ${wallet.publicKey.toBase58()}`);
    console.log(`   Balance: ${wallet.balance.toFixed(6)} SOL ${marker}`);
    console.log('');
    
    if (!isMaster && wallet.balance > 0.001) {
      totalToConsolidate += wallet.balance;
    }
  }
  
  console.log('─'.repeat(70));
  console.log(`\n💰 TOTAL TO CONSOLIDATE: ${totalToConsolidate.toFixed(6)} SOL\n`);
  
  if (totalToConsolidate < 0.001) {
    console.log('✅ Nothing to consolidate - all balances are in master or too small.');
    
    // Show master balance
    const masterBalance = await connection.getBalance(masterPubkey);
    console.log(`\n👑 MASTER BALANCE: ${(masterBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    return;
  }
  
  // Consolidate
  console.log('🔄 CONSOLIDATING...\n');
  
  for (const wallet of wallets) {
    const isMaster = wallet.publicKey.equals(masterPubkey);
    
    if (isMaster || wallet.balance < 0.002) {
      continue;
    }
    
    // Leave 0.001 SOL for rent
    const amountToSend = Math.floor((wallet.balance - 0.001) * LAMPORTS_PER_SOL);
    
    if (amountToSend <= 0) {
      continue;
    }
    
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: masterPubkey,
          lamports: amountToSend,
        })
      );
      
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet.keypair]);
      console.log(`✅ ${wallet.name}: Sent ${(amountToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      console.log(`   TX: ${sig}\n`);
    } catch (e: any) {
      console.log(`❌ ${wallet.name}: Failed - ${e.message}\n`);
    }
  }
  
  // Final balance
  const finalBalance = await connection.getBalance(masterPubkey);
  console.log('─'.repeat(70));
  console.log(`\n👑 MASTER WALLET FINAL BALANCE: ${(finalBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  console.log(`   ${masterPubkey.toBase58()}\n`);
}

main().catch(console.error);

