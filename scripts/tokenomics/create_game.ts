/**
 * CREATE GAME #1 with Vault (BlackMirror) 🪞
 * ============================================
 * This creates the on-chain infrastructure for anonymous payments:
 * - GameConfig PDA
 * - Game Vault PDA (future: BlackMirror)
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey('8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x');
const PDOX_MINT = new PublicKey('9qvdNjAd3QMHoujeDuzgUcXE2TXqwNaRwx6mfYFK6YqX');
const RPC_URL = 'https://api.devnet.solana.com';
const GAME_ID = 1n; // First game!

// create_game discriminator from IDL
const DISCRIMINATOR = Buffer.from([124, 69, 75, 66, 184, 220, 72, 206]);

function loadWallet(walletPath: string): Keypair {
  const rawKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(rawKey));
}

async function main() {
  console.log('\n🎮 CREATING GAME #1 + VAULT (BlackMirror) 🪞');
  console.log('═'.repeat(55));

  const conn = new Connection(RPC_URL, 'confirmed');

  // Load deployer wallet (game owner)
  const walletPath = path.join(__dirname, '../../deployer_wallet.json');
  const gameOwner = loadWallet(walletPath);
  console.log('👤 Game Owner:', gameOwner.publicKey.toBase58());

  // Derive PDAs
  const gameIdBytes = Buffer.alloc(8);
  gameIdBytes.writeBigUInt64LE(GAME_ID);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID
  );

  const [gamePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('game'), gameIdBytes],
    PROGRAM_ID
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), gamePda.toBuffer()],
    PROGRAM_ID
  );

  console.log('📋 Config PDA:  ', configPda.toBase58());
  console.log('🎮 Game PDA:    ', gamePda.toBase58());
  console.log('🪞 Vault PDA:   ', vaultPda.toBase58());
  console.log('');

  // Check if game already exists
  const existingGame = await conn.getAccountInfo(gamePda);
  if (existingGame && existingGame.owner.equals(PROGRAM_ID)) {
    console.log('✅ Game #1 already exists!');
    console.log('   Size:', existingGame.data.length, 'bytes');
    return;
  }

  // Build instruction data
  // Args: game_id (u64), currency_mint (pubkey), fee_bps (u16), cancel_penalty_bps (u16), kyc_required (bool), use_token_2022 (bool)
  const feeBps = 100; // 1% game fee
  const cancelPenaltyBps = 50; // 0.5% cancel penalty
  const kycRequired = false;
  const useToken2022 = true; // PDOX is Token-2022!

  const data = Buffer.alloc(8 + 8 + 32 + 2 + 2 + 1 + 1); // discriminator + args
  let offset = 0;

  // Discriminator
  DISCRIMINATOR.copy(data, offset);
  offset += 8;

  // game_id (u64)
  data.writeBigUInt64LE(GAME_ID, offset);
  offset += 8;

  // currency_mint (pubkey - 32 bytes)
  PDOX_MINT.toBuffer().copy(data, offset);
  offset += 32;

  // fee_bps (u16)
  data.writeUInt16LE(feeBps, offset);
  offset += 2;

  // cancel_penalty_bps (u16)
  data.writeUInt16LE(cancelPenaltyBps, offset);
  offset += 2;

  // kyc_required (bool)
  data.writeUInt8(kycRequired ? 1 : 0, offset);
  offset += 1;

  // use_token_2022 (bool)
  data.writeUInt8(useToken2022 ? 1 : 0, offset);
  offset += 1;

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: gamePda, isSigner: false, isWritable: true },
      { pubkey: gameOwner.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });

  console.log('📤 Creating Game #1...');
  
  const tx = new Transaction().add(ix);
  tx.feePayer = gameOwner.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

  try {
    const sig = await sendAndConfirmTransaction(conn, tx, [gameOwner], {
      commitment: 'confirmed',
    });
    
    console.log('');
    console.log('═'.repeat(55));
    console.log('✅ GAME #1 CREATED SUCCESSFULLY!');
    console.log('═'.repeat(55));
    console.log('🔗 TX:', sig);
    console.log('🎮 Game PDA:  ', gamePda.toBase58());
    console.log('🪞 Vault PDA: ', vaultPda.toBase58());
    console.log('');
    console.log('NEXT STEPS:');
    console.log('  1. Initialize Vault token account');
    console.log('  2. Users can deposit PDOX → Vault');
    console.log('  3. Netting engine settles → BlackMirror pays out!');
    
  } catch (e: any) {
    console.error('❌ Failed:', e.message);
    if (e.logs) {
      console.log('\nProgram Logs:');
      e.logs.forEach((log: string) => console.log('  ', log));
    }
  }
}

main().catch(console.error);

