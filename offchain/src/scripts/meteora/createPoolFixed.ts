/**
 * CREATE PDOX/SOL POOL - Fixed BN issue
 * Using direct SDK methods with proper BN handling
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  getAccount, 
  TOKEN_2022_PROGRAM_ID,
  NATIVE_MINT
} from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

// Config
const RPC_URL = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const WSOL_MINT = NATIVE_MINT;

// Pool parameters
const SOL_AMOUNT = 5;
const PDOX_AMOUNT = 10_000_000;
const BIN_STEP = 25;

function loadWallet(): Keypair {
  const walletPath = path.join(__dirname, '..', '..', '..', '..', 'deployer_wallet.json');
  const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     CREATE PDOX/SOL POOL - SDK with Fixed BN                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadWallet();
  
  console.log('📍 Wallet:', wallet.publicKey.toBase58());
  console.log('');

  // Check balances
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 SOL: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const pdoxAta = await getAssociatedTokenAddress(
    PDOX_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID
  );
  
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log(`🪙 PDOX: ${(Number(pdoxAccount.amount) / 1e9).toLocaleString()} PDOX`);
  } catch {
    console.log('❌ No PDOX balance');
    return;
  }

  console.log('\n' + '─'.repeat(60) + '\n');

  // Try to create pool
  console.log('🚀 Attempting pool creation...\n');

  try {
    // Use a safer bin ID - start at 0 for simplicity
    const activeBinId = new BN(0);
    const binStep = new BN(BIN_STEP);
    const baseFee = new BN(100); // 1%

    console.log('Parameters:');
    console.log(`  Token X (Base): ${PDOX_MINT.toBase58()}`);
    console.log(`  Token Y (Quote): ${WSOL_MINT.toBase58()}`);
    console.log(`  Bin Step: ${BIN_STEP}`);
    console.log(`  Base Fee: 100 bps (1%)`);
    console.log(`  Active Bin ID: 0`);
    console.log('');

    // Create the pool
    const createPoolTx = await DLMM.createLbPair(
      connection,
      wallet.publicKey,
      PDOX_MINT,
      WSOL_MINT,
      binStep,
      baseFee,
      activeBinId,
      { cluster: 'devnet' }
    );

    console.log('✅ Transaction created!');
    console.log('Type:', typeof createPoolTx);
    
    if (Array.isArray(createPoolTx)) {
      console.log(`Transactions: ${createPoolTx.length}`);
    }

    // Sign and send
    const txs = Array.isArray(createPoolTx) ? createPoolTx : [createPoolTx];
    
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if ('instructions' in tx || 'serialize' in tx) {
        const { blockhash } = await connection.getLatestBlockhash();
        (tx as any).recentBlockhash = blockhash;
        (tx as any).feePayer = wallet.publicKey;
        
        console.log(`\nSending tx ${i + 1}/${txs.length}...`);
        
        const sig = await connection.sendTransaction(tx as any, [wallet], {
          skipPreflight: true,
          preflightCommitment: 'confirmed',
        });
        
        console.log(`TX: ${sig}`);
        console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
        
        // Wait for confirmation
        await connection.confirmTransaction(sig, 'confirmed');
        console.log('✅ Confirmed!');
      }
    }

    // Find created pool
    console.log('\n🔍 Looking for created pool...');
    await new Promise(r => setTimeout(r, 5000));
    
    const pools = await DLMM.getLbPairs(connection, { cluster: 'devnet' });
    const ourPool = pools.find((p: any) => {
      const mx = p.account.tokenXMint.toBase58();
      const my = p.account.tokenYMint.toBase58();
      return (mx === PDOX_MINT.toBase58() || my === PDOX_MINT.toBase58());
    });

    if (ourPool) {
      console.log('\n✅ POOL CREATED!');
      console.log(`Address: ${ourPool.publicKey.toBase58()}`);
      console.log(`\nAdd to .env:\nMETEORA_PDOX_POOL=${ourPool.publicKey.toBase58()}`);
    }

  } catch (e: any) {
    console.log('\n❌ Error:', e.message);
    
    if (e.message.includes('divmod') || e.message.includes('BN')) {
      console.log('\n⚠️  BN library conflict. Using manual pool creation.\n');
    }

    // Provide manual instructions
    console.log('═'.repeat(60));
    console.log('                 MANUAL CREATION (DEVNET)');
    console.log('═'.repeat(60));
    console.log('');
    console.log('1. Open: https://devnet.meteora.ag/dlmm/create');
    console.log('');
    console.log('2. Connect Phantom wallet to DEVNET');
    console.log(`   (Wallet: ${wallet.publicKey.toBase58()})`);
    console.log('');
    console.log('3. Base Token: Click "Select token" and paste:');
    console.log(`   ${PDOX_MINT.toBase58()}`);
    console.log('');
    console.log('4. Quote Token: SOL (already selected)');
    console.log('');
    console.log('5. Base Fee: 1% (100 bps)');
    console.log('');
    console.log('6. Bin Step: 25');
    console.log('');
    console.log('7. Initial Price: Set based on desired MC');
    console.log(`   For $68K MC: ~0.000068 SOL/PDOX`);
    console.log(`   For $13.6K MC: ~0.0000136 SOL/PDOX`);
    console.log('');
    console.log('8. Click "Create Pool"');
    console.log('');
    console.log('9. After creation, go to pool page and add liquidity:');
    console.log(`   - 5 SOL`);
    console.log(`   - 10,000,000 PDOX`);
    console.log('');
    console.log('10. Copy pool address and add to .env');
    console.log('');
  }
}

main().catch(console.error);

