/**
 * CREATE PDOX/SOL POOL - 5 SOL + 10M PDOX
 * 
 * Final pool creation for real devnet trading
 */

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
  createSyncNativeInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';
import DLMM from '@meteora-ag/dlmm';
import { BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// Config
const RPC_URL = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const WSOL_MINT = NATIVE_MINT;

// Pool parameters
const SOL_AMOUNT = 5; // 5 SOL
const PDOX_AMOUNT = 10_000_000; // 10M PDOX (1% of 1B supply)
const BIN_STEP = 25; // 0.25% per bin

function loadWallet(): Keypair {
  const walletPath = path.join(__dirname, '..', '..', '..', '..', 'deployer_wallet.json');
  const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     CREATE PDOX/SOL POOL - 5 SOL + 10M PDOX (1%)             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadWallet();
  
  console.log('📍 Wallet:', wallet.publicKey.toBase58());
  console.log('🪙 PDOX:', PDOX_MINT.toBase58());
  console.log('💧 WSOL:', WSOL_MINT.toBase58());
  console.log('');

  // Check balances
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  if (solBalance < (SOL_AMOUNT + 0.5) * LAMPORTS_PER_SOL) {
    console.log(`❌ Need at least ${SOL_AMOUNT + 0.5} SOL (${SOL_AMOUNT} for LP + 0.5 for fees)`);
    return;
  }

  // Check PDOX balance
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
    console.log(`🪙 PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX`);
  } catch {
    console.log('❌ No PDOX balance');
    return;
  }
  
  if (pdoxBalance < PDOX_AMOUNT) {
    console.log(`❌ Need at least ${PDOX_AMOUNT.toLocaleString()} PDOX`);
    return;
  }

  console.log('\n' + '─'.repeat(60) + '\n');

  // Calculate initial price
  const pricePerPdox = SOL_AMOUNT / PDOX_AMOUNT;
  const priceUsd = pricePerPdox * 136; // $136/SOL
  const marketCap = 1_000_000_000 * priceUsd;
  
  console.log('📊 POOL PARAMETERS:');
  console.log(`   SOL: ${SOL_AMOUNT} SOL (~$${(SOL_AMOUNT * 136).toFixed(0)})`);
  console.log(`   PDOX: ${PDOX_AMOUNT.toLocaleString()} PDOX`);
  console.log(`   Bin Step: ${BIN_STEP} (${BIN_STEP / 100}%)`);
  console.log(`   Initial Price: ${pricePerPdox.toExponential(4)} SOL/PDOX`);
  console.log(`   Initial Price: $${priceUsd.toExponential(4)}/PDOX`);
  console.log(`   Market Cap: $${marketCap.toLocaleString()}`);
  console.log(`   LP Value: $${(SOL_AMOUNT * 136 * 2).toLocaleString()}`);
  console.log('');

  // Check for existing pools
  console.log('🔍 Checking for existing PDOX/SOL pools...');
  
  try {
    const allPools = await DLMM.getLbPairs(connection, { cluster: 'devnet' });
    
    const existingPool = allPools.find((p: any) => {
      const mintX = p.account.tokenXMint.toBase58();
      const mintY = p.account.tokenYMint.toBase58();
      return (
        (mintX === PDOX_MINT.toBase58() && mintY === WSOL_MINT.toBase58()) ||
        (mintY === PDOX_MINT.toBase58() && mintX === WSOL_MINT.toBase58())
      );
    });

    if (existingPool) {
      console.log('✅ Pool already exists!');
      console.log(`   Address: ${existingPool.publicKey.toBase58()}`);
      
      // Load pool to get more info
      const pool = await DLMM.create(connection, existingPool.publicKey, { cluster: 'devnet' });
      const activeBin = await pool.getActiveBin();
      
      console.log(`   Active Bin: ${activeBin.binId}`);
      console.log(`   Current Price: ${activeBin.price} SOL/PDOX`);
      console.log('');
      console.log('📝 Add to .env:');
      console.log(`METEORA_PDOX_POOL=${existingPool.publicKey.toBase58()}`);
      return;
    }
    
    console.log('   No existing pool found.');
  } catch (e: any) {
    console.log('   Could not check existing pools:', e.message);
  }

  console.log('\n🚀 CREATING POOL...\n');

  try {
    // Step 1: Create the LB Pair (pool)
    console.log('Step 1: Creating LB Pair...');
    
    // Calculate active bin based on desired price
    // For DLMM: price = (1 + binStep/10000)^binId
    // We want price = SOL_AMOUNT / PDOX_AMOUNT = 5 / 10_000_000 = 0.0000005
    // binId = log(price) / log(1 + binStep/10000)
    const targetPrice = SOL_AMOUNT / PDOX_AMOUNT;
    const binStepDecimal = BIN_STEP / 10000;
    const activeBinId = Math.floor(Math.log(targetPrice) / Math.log(1 + binStepDecimal));
    
    console.log(`   Target Price: ${targetPrice}`);
    console.log(`   Calculated Active Bin: ${activeBinId}`);

    const createTx = await DLMM.createLbPair(
      connection,
      wallet.publicKey,
      PDOX_MINT,      // Token X (base)
      WSOL_MINT,      // Token Y (quote)  
      new BN(BIN_STEP),
      new BN(100),    // Base fee: 1% (100 bps)
      new BN(activeBinId),
      { cluster: 'devnet' }
    );

    // Send transaction(s)
    const txs = Array.isArray(createTx) ? createTx : [createTx];
    let poolAddress: PublicKey | null = null;
    
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (tx instanceof Transaction) {
        tx.feePayer = wallet.publicKey;
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        
        console.log(`   Sending tx ${i + 1}/${txs.length}...`);
        const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
          commitment: 'confirmed',
          skipPreflight: true,
        });
        console.log(`   ✅ TX: ${sig}`);
        console.log(`   https://explorer.solana.com/tx/${sig}?cluster=devnet`);
        
        // Try to extract pool address from logs
        const txInfo = await connection.getTransaction(sig, { commitment: 'confirmed' });
        if (txInfo?.meta?.logMessages) {
          for (const log of txInfo.meta.logMessages) {
            if (log.includes('LbPair') || log.includes('lbPair')) {
              console.log(`   Log: ${log}`);
            }
          }
        }
      }
    }

    // Find the created pool
    console.log('\n   Searching for created pool...');
    await new Promise(r => setTimeout(r, 3000)); // Wait for indexing
    
    const allPools = await DLMM.getLbPairs(connection, { cluster: 'devnet' });
    const newPool = allPools.find((p: any) => {
      const mintX = p.account.tokenXMint.toBase58();
      const mintY = p.account.tokenYMint.toBase58();
      return (
        (mintX === PDOX_MINT.toBase58() && mintY === WSOL_MINT.toBase58()) ||
        (mintY === PDOX_MINT.toBase58() && mintX === WSOL_MINT.toBase58())
      );
    });

    if (newPool) {
      poolAddress = newPool.publicKey;
      console.log(`   ✅ Pool found: ${poolAddress.toBase58()}`);
    } else {
      console.log('   ⚠️ Pool not found in list yet (may need more time)');
    }

    console.log('\n✅ POOL CREATED!');
    console.log('');
    
    if (poolAddress) {
      console.log('📝 Add to .env:');
      console.log(`METEORA_PDOX_POOL=${poolAddress.toBase58()}`);
      console.log('');
      console.log('Next: Run add liquidity script or use Meteora UI');
    }

  } catch (e: any) {
    console.log('\n❌ Pool creation failed:', e.message);
    
    if (e.logs) {
      console.log('\nLogs:');
      e.logs.forEach((log: string) => console.log('  ', log));
    }

    console.log('\n' + '═'.repeat(60));
    console.log('                    MANUAL CREATION');
    console.log('═'.repeat(60));
    console.log('');
    console.log('Create pool via Meteora UI:');
    console.log('');
    console.log('1. Go to: https://app.meteora.ag/dlmm/create');
    console.log('2. Connect wallet:', wallet.publicKey.toBase58());
    console.log('3. Token X (Base): Paste PDOX address:');
    console.log(`   ${PDOX_MINT.toBase58()}`);
    console.log('4. Token Y (Quote): SOL');
    console.log('5. Bin Step: 25');
    console.log('6. Base Fee: 1%');
    console.log(`7. Add liquidity: 5 SOL + 10M PDOX`);
    console.log('');
    console.log('After creating, paste the pool address here!');
    console.log('');
  }
}

main().catch(console.error);

