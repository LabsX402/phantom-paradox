/**
 * Add Liquidity to PDOX/SOL Meteora Pool
 * 
 * Usage: npx ts-node src/scripts/meteora/addLiquidity.ts [sol_amount] [pdox_amount]
 * Example: npx ts-node src/scripts/meteora/addLiquidity.ts 1 1000000
 */

import dotenv from 'dotenv';
dotenv.config();

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { MeteoraIntegration, PDOX_MINT, WSOL_MINT } from '../../integrations/meteora';

const PDOX_DECIMALS = 9;

function loadWallet(): Keypair {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.SERVER_AUTHORITY_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('No wallet key in env');
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(privateKey)));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const solAmount = parseFloat(args[0] || '1');
  const pdoxAmount = parseFloat(args[1] || '1000000');
  
  console.log('=== Add Liquidity to PDOX/SOL Pool ===\n');
  
  // Setup
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = loadWallet();
  
  const poolAddress = process.env.METEORA_PDOX_POOL;
  if (!poolAddress) {
    console.error('❌ METEORA_PDOX_POOL not set in .env');
    console.log('Run createPdoxPool.ts first to create the pool');
    process.exit(1);
  }
  
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Pool: ${poolAddress}`);
  console.log(`Adding: ${solAmount} SOL + ${pdoxAmount} PDOX`);
  
  // Check balances
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log(`\nSOL balance: ${solBalance / LAMPORTS_PER_SOL}`);
  
  const pdoxAta = await getAssociatedTokenAddress(PDOX_MINT, wallet.publicKey);
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta);
    console.log(`PDOX balance: ${Number(pdoxAccount.amount) / (10 ** PDOX_DECIMALS)}`);
  } catch {
    console.log('PDOX balance: 0 (no ATA)');
  }
  
  // Initialize Meteora integration
  const meteora = new MeteoraIntegration({
    connection,
    wallet,
    poolAddress: new PublicKey(poolAddress),
  });
  
  console.log('\nConnecting to pool...');
  await meteora.connectToPool(new PublicKey(poolAddress));
  
  const poolInfo = await meteora.getPoolInfo();
  console.log('\nPool info:', poolInfo);
  
  // Add liquidity
  const amountX = new BN(pdoxAmount * (10 ** PDOX_DECIMALS)); // PDOX
  const amountY = new BN(solAmount * LAMPORTS_PER_SOL);        // SOL
  
  console.log(`\nAdding liquidity...`);
  console.log(`  PDOX (X): ${amountX.toString()}`);
  console.log(`  SOL (Y):  ${amountY.toString()}`);
  
  try {
    const sig = await meteora.addLiquidity(amountX, amountY, 10); // 10 bins each side
    
    console.log(`\n✅ Liquidity Added!`);
    console.log(`TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    
    // Check positions
    const positions = await meteora.getUserPositions();
    console.log(`\nYour positions:`, positions);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.logs) {
      console.log('\nLogs:');
      error.logs.forEach((l: string) => console.log(`  ${l}`));
    }
  }
}

main().catch(console.error);

