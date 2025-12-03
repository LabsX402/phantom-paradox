/**
 * Test Swap on PDOX/SOL Meteora Pool
 * 
 * Usage: 
 *   npx ts-node src/scripts/meteora/testSwap.ts buy 0.1    # Buy PDOX with 0.1 SOL
 *   npx ts-node src/scripts/meteora/testSwap.ts sell 1000  # Sell 1000 PDOX for SOL
 */

import dotenv from 'dotenv';
dotenv.config();

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { MeteoraIntegration, PDOX_MINT } from '../../integrations/meteora';

const PDOX_DECIMALS = 9;

function loadWallet(): Keypair {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.SERVER_AUTHORITY_PRIVATE_KEY;
  if (!privateKey) throw new Error('No wallet key in env');
  try {
    return Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(privateKey)));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const direction = args[0] || 'buy'; // buy or sell
  const amount = parseFloat(args[1] || '0.1');
  
  console.log('=== Test Swap on PDOX/SOL Pool ===\n');
  
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = loadWallet();
  
  const poolAddress = process.env.METEORA_PDOX_POOL;
  if (!poolAddress) {
    console.error('❌ METEORA_PDOX_POOL not set in .env');
    process.exit(1);
  }
  
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Pool: ${poolAddress}`);
  console.log(`Direction: ${direction.toUpperCase()}`);
  console.log(`Amount: ${amount}`);
  
  // Check balances before
  const solBefore = await connection.getBalance(wallet.publicKey);
  console.log(`\nBefore swap:`);
  console.log(`  SOL: ${solBefore / LAMPORTS_PER_SOL}`);
  
  const pdoxAta = await getAssociatedTokenAddress(PDOX_MINT, wallet.publicKey);
  let pdoxBefore = 0;
  try {
    const pdoxAccount = await getAccount(connection, pdoxAta);
    pdoxBefore = Number(pdoxAccount.amount);
    console.log(`  PDOX: ${pdoxBefore / (10 ** PDOX_DECIMALS)}`);
  } catch {
    console.log(`  PDOX: 0`);
  }
  
  // Connect to pool
  const meteora = new MeteoraIntegration({
    connection,
    wallet,
    poolAddress: new PublicKey(poolAddress),
  });
  
  await meteora.connectToPool(new PublicKey(poolAddress));
  
  // Determine swap direction
  // Pool: X = PDOX, Y = SOL
  // buy PDOX = swap SOL->PDOX = swapForY=false (we want X out)
  // sell PDOX = swap PDOX->SOL = swapForY=true (we want Y out)
  
  const isBuy = direction.toLowerCase() === 'buy';
  const swapForY = !isBuy; // buy = want PDOX (X), sell = want SOL (Y)
  
  let amountIn: BN;
  if (isBuy) {
    // Buying PDOX with SOL
    amountIn = new BN(amount * LAMPORTS_PER_SOL);
    console.log(`\nSwapping ${amount} SOL for PDOX...`);
  } else {
    // Selling PDOX for SOL  
    amountIn = new BN(amount * (10 ** PDOX_DECIMALS));
    console.log(`\nSwapping ${amount} PDOX for SOL...`);
  }
  
  // Get quote first
  console.log('\nGetting quote...');
  const quote = await meteora.getSwapQuote(amountIn, swapForY);
  
  console.log(`Quote:`);
  console.log(`  Amount out: ${quote.amountOut.toString()}`);
  console.log(`  Fee: ${quote.fee.toString()}`);
  console.log(`  Price impact: ${quote.priceImpact}%`);
  
  if (quote.priceImpact > 5) {
    console.warn('⚠️ High price impact! Consider smaller amount.');
  }
  
  // Execute swap with 1% slippage
  const minAmountOut = quote.amountOut.muln(99).divn(100);
  
  console.log('\nExecuting swap...');
  try {
    const sig = await meteora.swap(amountIn, swapForY, minAmountOut);
    
    console.log(`\n✅ Swap Successful!`);
    console.log(`TX: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    
    // Check balances after
    await new Promise(r => setTimeout(r, 2000)); // Wait for confirmation
    
    const solAfter = await connection.getBalance(wallet.publicKey);
    let pdoxAfter = 0;
    try {
      const pdoxAccount = await getAccount(connection, pdoxAta);
      pdoxAfter = Number(pdoxAccount.amount);
    } catch {}
    
    console.log(`\nAfter swap:`);
    console.log(`  SOL: ${solAfter / LAMPORTS_PER_SOL} (${(solAfter - solBefore) / LAMPORTS_PER_SOL > 0 ? '+' : ''}${(solAfter - solBefore) / LAMPORTS_PER_SOL})`);
    console.log(`  PDOX: ${pdoxAfter / (10 ** PDOX_DECIMALS)} (${(pdoxAfter - pdoxBefore) / (10 ** PDOX_DECIMALS) > 0 ? '+' : ''}${(pdoxAfter - pdoxBefore) / (10 ** PDOX_DECIMALS)})`);
    
  } catch (error: any) {
    console.error('❌ Swap failed:', error.message);
    if (error.logs) {
      console.log('\nLogs:');
      error.logs.forEach((l: string) => console.log(`  ${l}`));
    }
  }
}

main().catch(console.error);

