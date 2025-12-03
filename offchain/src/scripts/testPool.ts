/**
 * TEST POOL - Verify pool and execute test trades
 * 
 * Run: npx ts-node src/scripts/testPool.ts <pool_address>
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
  TOKEN_2022_PROGRAM_ID 
} from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');

function loadWallet(): Keypair {
  const walletPath = path.join(__dirname, '..', '..', '..', 'deployer_wallet.json');
  const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  const poolAddress = process.argv[2];
  
  if (!poolAddress) {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    POOL TEST UTILITY                             ║
╚══════════════════════════════════════════════════════════════════╝

Usage: npx ts-node src/scripts/testPool.ts <pool_address>

Example:
  npx ts-node src/scripts/testPool.ts 7qbRF6YsyGuLUVs6Y1SF9kZLM1QBbxX9qL1RbGyBW5vN

This will:
  1. Verify the pool exists and is configured correctly
  2. Display current reserves and price
  3. Execute a small test swap (0.01 SOL → PDOX)
  4. Show the real transaction hash for verification

After creating your pool at https://devnet.meteora.ag/dlmm/create,
paste the pool address here to test!
`);
    return;
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    TESTING POOL                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadWallet();
  const poolPubkey = new PublicKey(poolAddress);

  console.log('📍 Pool:', poolAddress);
  console.log('📍 Wallet:', wallet.publicKey.toBase58());
  console.log('');

  // Check wallet balances
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const pdoxAta = await getAssociatedTokenAddress(
    PDOX_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID
  );
  
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log(`🪙 PDOX Balance: ${(Number(pdoxAccount.amount) / 1e9).toLocaleString()} PDOX`);
  } catch {
    console.log('🪙 PDOX Balance: 0');
  }

  console.log('\n' + '─'.repeat(60) + '\n');

  try {
    // Load pool
    console.log('🔍 Loading pool...');
    const pool = await DLMM.create(connection, poolPubkey, { cluster: 'devnet' });
    
    console.log('✅ Pool loaded successfully!');
    console.log('');

    // Get pool info
    const activeBin = await pool.getActiveBin();
    
    console.log('📊 POOL INFO:');
    console.log(`   Token X: ${pool.tokenX.publicKey.toBase58()}`);
    console.log(`   Token Y: ${pool.tokenY.publicKey.toBase58()}`);
    console.log(`   Active Bin: ${activeBin.binId}`);
    console.log(`   Current Price: ${activeBin.price} ${pool.tokenY.publicKey.equals(PDOX_MINT) ? 'SOL/PDOX' : 'PDOX/SOL'}`);
    console.log('');

    // Calculate reserves (approximation)
    const binData = await pool.getBinsAroundActiveBin(10);
    let totalX = 0;
    let totalY = 0;
    
    for (const bin of binData.bins) {
      totalX += Number(bin.amountX) / 1e9;
      totalY += Number(bin.amountY) / 1e9;
    }

    console.log('💧 LIQUIDITY (around active bin):');
    console.log(`   Token X: ${totalX.toLocaleString()}`);
    console.log(`   Token Y: ${totalY.toLocaleString()}`);
    console.log('');

    // Test swap
    console.log('🔄 TESTING SMALL SWAP (0.01 SOL → PDOX)...\n');
    
    const swapAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
    
    const binArrays = await pool.getBinArrays();
    const swapQuote = pool.getSwapQuote(
      swapAmount,
      true, // swap X to Y (or vice versa depending on pool setup)
      binArrays
    );

    console.log(`   Input: 0.01 SOL`);
    console.log(`   Expected Output: ${(Number(swapQuote.outAmount) / 1e9).toLocaleString()} tokens`);
    console.log(`   Price Impact: ${(swapQuote.priceImpact * 100).toFixed(2)}%`);
    console.log('');

    // Execute swap
    console.log('📤 Executing swap...');
    
    const swapTx = await pool.swap({
      inToken: pool.tokenX.publicKey,
      outToken: pool.tokenY.publicKey,
      inAmount: swapAmount,
      minOutAmount: 0, // For test, accept any amount
      user: wallet.publicKey,
    });

    swapTx.feePayer = wallet.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    swapTx.recentBlockhash = blockhash;

    const sig = await connection.sendTransaction(swapTx, [wallet], {
      skipPreflight: true,
      preflightCommitment: 'confirmed',
    });

    console.log(`   TX: ${sig}`);
    console.log(`   https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    
    // Wait for confirmation
    console.log('   Waiting for confirmation...');
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('   ✅ CONFIRMED!');
    
    console.log('\n' + '═'.repeat(60));
    console.log('                    TEST COMPLETE!');
    console.log('═'.repeat(60));
    console.log('');
    console.log('Your pool is working! All trades will have real TX hashes.');
    console.log('');
    console.log('📝 Save to .env:');
    console.log(`METEORA_PDOX_POOL=${poolAddress}`);
    console.log('');

  } catch (e: any) {
    console.log('❌ Error:', e.message);
    
    if (e.message.includes('Account does not exist')) {
      console.log('');
      console.log('The pool address might be incorrect or the pool hasn\'t been created yet.');
      console.log('');
      console.log('Steps to create:');
      console.log('1. Go to https://devnet.meteora.ag/dlmm/create');
      console.log('2. Create the pool');
      console.log('3. Copy the pool address');
      console.log('4. Run this script again');
    }
    
    if (e.logs) {
      console.log('\nTransaction logs:');
      e.logs.slice(-5).forEach((log: string) => console.log('  ', log));
    }
  }
}

main().catch(console.error);

