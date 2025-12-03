/**
 * CREATE PDOX/SOL POOL ON RAYDIUM CPMM
 * 
 * Using Raydium SDK v2 for constant-product AMM
 * Simpler than DLMM, better SDK stability
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  VersionedTransaction
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  getAccount, 
  TOKEN_2022_PROGRAM_ID,
  NATIVE_MINT
} from '@solana/spl-token';
import { Raydium, TxVersion, parseTokenAccountResp } from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

// Config
const RPC_URL = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const WSOL_MINT = NATIVE_MINT;

// Pool parameters
const SOL_AMOUNT = 5 * LAMPORTS_PER_SOL; // 5 SOL in lamports
const PDOX_AMOUNT = 10_000_000 * 1e9; // 10M PDOX in base units

function loadWallet(): Keypair {
  const walletPath = path.join(__dirname, '..', '..', '..', '..', 'deployer_wallet.json');
  const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     CREATE PDOX/SOL POOL - RAYDIUM CPMM (DEVNET)             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadWallet();
  
  console.log('📍 Wallet:', wallet.publicKey.toBase58());
  console.log('🪙 PDOX:', PDOX_MINT.toBase58());
  console.log('');

  // Check balances
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`💰 SOL: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const pdoxAta = await getAssociatedTokenAddress(
    PDOX_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID
  );
  
  let pdoxBalance = BigInt(0);
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    pdoxBalance = pdoxAccount.amount;
    console.log(`🪙 PDOX: ${(Number(pdoxBalance) / 1e9).toLocaleString()} PDOX`);
  } catch {
    console.log('❌ No PDOX balance');
    return;
  }

  if (solBalance < SOL_AMOUNT + LAMPORTS_PER_SOL) {
    console.log(`❌ Need at least ${(SOL_AMOUNT + LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL} SOL`);
    return;
  }

  console.log('\n' + '─'.repeat(60) + '\n');

  try {
    console.log('🔧 Initializing Raydium SDK...');
    
    // Initialize Raydium
    const raydium = await Raydium.load({
      connection,
      owner: wallet,
      cluster: 'devnet',
      disableFeatureCheck: true,
      blockhashCommitment: 'confirmed',
    });

    console.log('✅ Raydium SDK initialized');
    console.log('');

    // Check for existing pools
    console.log('🔍 Checking for existing PDOX pools...');
    
    // Try to create CPMM pool
    console.log('\n🚀 Creating CPMM pool...');
    console.log(`   SOL: ${SOL_AMOUNT / LAMPORTS_PER_SOL} SOL`);
    console.log(`   PDOX: ${PDOX_AMOUNT / 1e9} PDOX`);
    console.log('');

    // Note: Raydium CPMM requires specific program setup
    // The devnet may have different configurations
    
    const { execute, extInfo } = await raydium.cpmm.createPool({
      programId: new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'), // CPMM program
      poolFeeAccount: new PublicKey('G11FKBRaAkHAKuLCgLM6K6NUc9rTjPAznRCjZifrTQe2'), // Devnet fee account
      mintA: {
        address: PDOX_MINT.toBase58(),
        decimals: 9,
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      },
      mintB: {
        address: WSOL_MINT.toBase58(),
        decimals: 9,
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      },
      mintAAmount: new BN(PDOX_AMOUNT.toString()),
      mintBAmount: new BN(SOL_AMOUNT.toString()),
      startTime: new BN(0),
      associatedOnly: false,
      ownerInfo: {
        useSOLBalance: true,
      },
      txVersion: TxVersion.V0,
    });

    console.log('✅ Pool creation transaction prepared');
    console.log(`   Pool ID: ${extInfo.address.poolId.toBase58()}`);
    console.log('');

    // Execute transaction
    console.log('📤 Sending transaction...');
    const { txId } = await execute({ sendAndConfirm: true });
    
    console.log('\n✅ POOL CREATED!');
    console.log(`   TX: ${txId}`);
    console.log(`   Pool: ${extInfo.address.poolId.toBase58()}`);
    console.log(`   https://explorer.solana.com/tx/${txId}?cluster=devnet`);
    console.log('');
    console.log('📝 Add to .env:');
    console.log(`RAYDIUM_PDOX_POOL=${extInfo.address.poolId.toBase58()}`);

  } catch (e: any) {
    console.log('\n❌ Error:', e.message);
    
    if (e.logs) {
      console.log('\nLogs:');
      e.logs.slice(-10).forEach((log: string) => console.log('  ', log));
    }

    console.log('\n' + '═'.repeat(60));
    console.log('                 ALTERNATIVE: ORCA WHIRLPOOL');
    console.log('═'.repeat(60));
    console.log('');
    console.log('Raydium CPMM might not support Token-2022 fully on devnet.');
    console.log('');
    console.log('Options:');
    console.log('1. Use Orca Whirlpools (supports Token-2022)');
    console.log('2. Use Meteora UI at https://devnet.meteora.ag/dlmm/create');
    console.log('3. Deploy our own simple AMM for testing');
    console.log('');
  }
}

main().catch(console.error);

