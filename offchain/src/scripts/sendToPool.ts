/**
 * Send SOL to pool creator wallet
 */

import { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  Keypair, 
  Transaction, 
  SystemProgram,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.devnet.solana.com';
const TARGET = '3HDVer4UMewbyuzzXbcC3WBRr3odMAMYTsC7LWWE83DX';
const SEND_AMOUNT = 5; // SOL

function loadWallet(name: string): Keypair | null {
  try {
    const walletPath = path.join(__dirname, '..', '..', '..', name);
    const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(data));
  } catch {
    return null;
  }
}

async function main() {
  const conn = new Connection(RPC_URL, 'confirmed');
  
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    SEND SOL TO POOL CREATOR                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('Target:', TARGET);
  console.log('Amount:', SEND_AMOUNT, 'SOL\n');

  // Check all accounts with SOL
  console.log('═'.repeat(60));
  console.log('                    BALANCE CHECK');
  console.log('═'.repeat(60));
  console.log('');

  // Deployer wallet
  const deployer = loadWallet('deployer_wallet.json');
  if (!deployer) {
    console.log('❌ Could not load deployer wallet');
    return;
  }
  
  const deployerBal = await conn.getBalance(deployer.publicKey);
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);
  console.log(`  Balance: ${(deployerBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  // Target
  const targetBal = await conn.getBalance(new PublicKey(TARGET));
  console.log(`\nTarget: ${TARGET}`);
  console.log(`  Balance: ${(targetBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  // Program (can't withdraw, just for info)
  const programId = '8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x';
  const programBal = await conn.getBalance(new PublicKey(programId));
  console.log(`\nProgram: ${programId}`);
  console.log(`  Balance: ${(programBal / LAMPORTS_PER_SOL).toFixed(4)} SOL (rent-exempt, cannot withdraw)`);
  
  // Test wallets
  console.log('\nTest Wallets:');
  const testWalletsPath = path.join(__dirname, '..', '..', '..', 'test_wallets.json');
  let testWalletTotal = 0;
  
  if (fs.existsSync(testWalletsPath)) {
    const testWallets = JSON.parse(fs.readFileSync(testWalletsPath, 'utf-8'));
    for (const tw of testWallets) {
      const bal = await conn.getBalance(new PublicKey(tw.publicKey));
      testWalletTotal += bal;
      console.log(`  Wallet ${tw.index}: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }
  }
  
  console.log('');
  console.log('═'.repeat(60));
  console.log('');

  // Check if we have enough
  if (deployerBal < (SEND_AMOUNT + 0.01) * LAMPORTS_PER_SOL) {
    console.log(`❌ Not enough SOL in deployer.`);
    console.log(`   Need: ${SEND_AMOUNT + 0.01} SOL`);
    console.log(`   Have: ${(deployerBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    return;
  }

  // Send SOL
  console.log(`📤 Sending ${SEND_AMOUNT} SOL to ${TARGET}...\n`);
  
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: new PublicKey(TARGET),
      lamports: SEND_AMOUNT * LAMPORTS_PER_SOL,
    })
  );

  const sig = await sendAndConfirmTransaction(conn, tx, [deployer]);
  
  console.log('✅ SUCCESS!');
  console.log(`   TX: ${sig}`);
  console.log(`   https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  
  // Check new balances
  const newDeployerBal = await conn.getBalance(deployer.publicKey);
  const newTargetBal = await conn.getBalance(new PublicKey(TARGET));
  
  console.log('\n📊 Updated Balances:');
  console.log(`   Deployer: ${(newDeployerBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Target: ${(newTargetBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log('');
  console.log('✅ Ready to create pool on Meteora!');
}

main().catch(console.error);

