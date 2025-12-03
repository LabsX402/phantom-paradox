/**
 * CHECK DEVNET RESOURCES
 * 
 * Verify all test accounts, shards, and PDAs are funded
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const RPC_URL = 'https://api.devnet.solana.com';
const PROGRAM_ID = new PublicKey('8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x'); // Note: 'x' not '1'
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const DEPLOYER = new PublicKey('3XBBYhqcV5fdF1j8Bs97wcAbj9AYEeVHcxZipaFcefr3');

async function main() {
  const conn = new Connection(RPC_URL, 'confirmed');
  
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                 DEVNET RESOURCE CHECK                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Check program
  console.log('📦 PROGRAM');
  console.log('─'.repeat(50));
  const progInfo = await conn.getAccountInfo(PROGRAM_ID);
  console.log(`   Address: ${PROGRAM_ID.toBase58()}`);
  console.log(`   Exists: ${progInfo ? '✅' : '❌'}`);
  console.log(`   Executable: ${progInfo?.executable ? '✅' : '❌'}`);
  console.log(`   Balance: ${progInfo ? (progInfo.lamports / LAMPORTS_PER_SOL).toFixed(4) : 0} SOL`);
  console.log('');

  // Check deployer
  console.log('👤 DEPLOYER');
  console.log('─'.repeat(50));
  const deplBal = await conn.getBalance(DEPLOYER);
  console.log(`   Address: ${DEPLOYER.toBase58()}`);
  console.log(`   Balance: ${(deplBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Status: ${deplBal > 1 * LAMPORTS_PER_SOL ? '✅ Funded' : '⚠️ Low balance'}`);
  console.log('');

  // Check PDOX token
  console.log('🪙 PDOX TOKEN');
  console.log('─'.repeat(50));
  const tokenInfo = await conn.getAccountInfo(PDOX_MINT);
  console.log(`   Mint: ${PDOX_MINT.toBase58()}`);
  console.log(`   Exists: ${tokenInfo ? '✅' : '❌'}`);
  console.log('');

  // Check GlobalConfig PDA
  console.log('⚙️ GLOBAL CONFIG PDA');
  console.log('─'.repeat(50));
  const [globalConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_config')],
    PROGRAM_ID
  );
  const globalInfo = await conn.getAccountInfo(globalConfig);
  console.log(`   Address: ${globalConfig.toBase58()}`);
  console.log(`   Exists: ${globalInfo ? '✅' : '❌'}`);
  console.log(`   Balance: ${globalInfo ? (globalInfo.lamports / LAMPORTS_PER_SOL).toFixed(6) : 0} SOL`);
  console.log('');

  // Check Protocol Treasury PDA
  console.log('💰 PROTOCOL TREASURY');
  console.log('─'.repeat(50));
  const [treasury] = PublicKey.findProgramAddressSync(
    [Buffer.from('protocol_treasury')],
    PROGRAM_ID
  );
  const treasuryInfo = await conn.getAccountInfo(treasury);
  console.log(`   Address: ${treasury.toBase58()}`);
  console.log(`   Exists: ${treasuryInfo ? '✅' : '❌'}`);
  console.log(`   Balance: ${treasuryInfo ? (treasuryInfo.lamports / LAMPORTS_PER_SOL).toFixed(6) : 0} SOL`);
  console.log('');

  // Check Hydra Shards
  console.log('🐉 HYDRA SHARDS');
  console.log('─'.repeat(50));
  let shardsFunded = 0;
  let shardsTotal = 0;
  
  for (let i = 0; i < 10; i++) {
    const [shard] = PublicKey.findProgramAddressSync(
      [Buffer.from('hydra_shard'), new Uint8Array([i])],
      PROGRAM_ID
    );
    const shardInfo = await conn.getAccountInfo(shard);
    shardsTotal++;
    if (shardInfo && shardInfo.lamports > 0) {
      shardsFunded++;
      console.log(`   Shard ${i}: ${shard.toBase58().slice(0, 16)}... ${(shardInfo.lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL ✅`);
    } else {
      console.log(`   Shard ${i}: ${shard.toBase58().slice(0, 16)}... NOT INITIALIZED`);
    }
  }
  console.log(`   Status: ${shardsFunded}/${shardsTotal} shards initialized`);
  console.log('');

  // Check BlackMirror Vaults
  console.log('🪞 BLACKMIRROR VAULTS');
  console.log('─'.repeat(50));
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('blackmirror_vault')],
    PROGRAM_ID
  );
  const vaultInfo = await conn.getAccountInfo(vault);
  console.log(`   Main Vault: ${vault.toBase58()}`);
  console.log(`   Exists: ${vaultInfo ? '✅' : '❌'}`);
  console.log(`   Balance: ${vaultInfo ? (vaultInfo.lamports / LAMPORTS_PER_SOL).toFixed(6) : 0} SOL`);
  console.log('');

  // Recent transactions
  console.log('📜 RECENT PROGRAM TRANSACTIONS');
  console.log('─'.repeat(50));
  try {
    const sigs = await conn.getSignaturesForAddress(PROGRAM_ID, { limit: 5 });
    if (sigs.length === 0) {
      console.log('   No recent transactions');
    } else {
      for (const sig of sigs) {
        const date = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'unknown';
        console.log(`   ${sig.signature.slice(0, 20)}... ${date} ${sig.err ? '❌' : '✅'}`);
      }
    }
  } catch (e) {
    console.log('   Could not fetch transactions');
  }
  console.log('');

  // Summary
  console.log('═'.repeat(60));
  console.log('                        SUMMARY');
  console.log('═'.repeat(60));
  
  const issues: string[] = [];
  
  if (!progInfo) issues.push('Program not deployed');
  if (deplBal < 1 * LAMPORTS_PER_SOL) issues.push('Deployer balance low (<1 SOL)');
  if (!tokenInfo) issues.push('PDOX token not found');
  if (!globalInfo) issues.push('GlobalConfig not initialized');
  if (shardsFunded === 0) issues.push('No Hydra shards initialized');
  
  if (issues.length === 0) {
    console.log('   ✅ All resources verified!');
    console.log('   ✅ Ready for real tests with real TX hashes');
  } else {
    console.log('   ⚠️ Issues found:');
    issues.forEach(i => console.log(`   - ${i}`));
  }
  console.log('');
}

main().catch(console.error);

