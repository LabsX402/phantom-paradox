/**
 * PDOX TRADING BOTS
 * 
 * Splits 4 SOL across 50 wallets and executes random trades
 * to create organic-looking trading activity on the pool.
 * 
 * Each wallet gets 0.08 SOL (~$10.88 at $136/SOL)
 * 
 * Usage: node trading_bots.js
 */

const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// CONFIG
const DEVNET_RPC = "https://api.devnet.solana.com";
const TOTAL_SOL = 4;
const NUM_WALLETS = 50;
const SOL_PER_WALLET = TOTAL_SOL / NUM_WALLETS; // 0.08 SOL each

// Pool & Token
const POOL_ID = new PublicKey("DKdARvMSzUaFhRELRxe323xQvohqdVGnHHbtr8CbPSDU");
const PDOX_MINT = new PublicKey("5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

// Paths
const DEPLOYER_PATH = path.join(__dirname, '../../deployer_wallet.json');
const BOTS_DIR = path.join(__dirname, 'bot_wallets');
const BOTS_INFO_PATH = path.join(__dirname, 'BOTS_INFO.json');

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  🤖 PDOX TRADING BOTS - Setup");
  console.log("=".repeat(60) + "\n");
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load deployer
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf8'));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerData));
  
  const deployerBalance = await connection.getBalance(deployer.publicKey);
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);
  console.log(`Balance: ${deployerBalance / LAMPORTS_PER_SOL} SOL\n`);
  
  if (deployerBalance < TOTAL_SOL * LAMPORTS_PER_SOL) {
    console.log(`❌ Need at least ${TOTAL_SOL} SOL. Current: ${deployerBalance / LAMPORTS_PER_SOL}`);
    return;
  }
  
  // Create bot wallets directory
  if (!fs.existsSync(BOTS_DIR)) {
    fs.mkdirSync(BOTS_DIR, { recursive: true });
  }
  
  // Check if bots already exist
  let botsInfo;
  if (fs.existsSync(BOTS_INFO_PATH)) {
    botsInfo = JSON.parse(fs.readFileSync(BOTS_INFO_PATH, 'utf8'));
    console.log(`📋 Found ${botsInfo.wallets.length} existing bot wallets\n`);
  } else {
    console.log("🔧 Creating new bot wallets...\n");
    botsInfo = { wallets: [], createdAt: new Date().toISOString() };
    
    for (let i = 0; i < NUM_WALLETS; i++) {
      const bot = Keypair.generate();
      const botPath = path.join(BOTS_DIR, `bot_${i.toString().padStart(2, '0')}.json`);
      
      fs.writeFileSync(botPath, JSON.stringify(Array.from(bot.secretKey)));
      
      botsInfo.wallets.push({
        index: i,
        pubkey: bot.publicKey.toBase58(),
        path: botPath,
      });
      
      process.stdout.write(`\r  Created wallet ${i + 1}/${NUM_WALLETS}`);
    }
    console.log('\n');
    
    fs.writeFileSync(BOTS_INFO_PATH, JSON.stringify(botsInfo, null, 2));
    console.log(`✅ Created ${NUM_WALLETS} bot wallets\n`);
  }
  
  // Fund the bots
  console.log("💰 Funding bot wallets...\n");
  console.log(`   Each bot gets: ${SOL_PER_WALLET} SOL (~$${(SOL_PER_WALLET * 136).toFixed(2)})\n`);
  
  // Batch fund in groups of 10 (Solana tx size limits)
  const BATCH_SIZE = 10;
  let funded = 0;
  
  for (let batch = 0; batch < Math.ceil(botsInfo.wallets.length / BATCH_SIZE); batch++) {
    const start = batch * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, botsInfo.wallets.length);
    const batchWallets = botsInfo.wallets.slice(start, end);
    
    const tx = new Transaction();
    
    for (const botInfo of batchWallets) {
      // Check if already funded
      const balance = await connection.getBalance(new PublicKey(botInfo.pubkey));
      if (balance >= SOL_PER_WALLET * LAMPORTS_PER_SOL * 0.9) {
        funded++;
        continue;
      }
      
      tx.add(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: new PublicKey(botInfo.pubkey),
          lamports: Math.floor(SOL_PER_WALLET * LAMPORTS_PER_SOL),
        })
      );
    }
    
    if (tx.instructions.length > 0) {
      try {
        const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
        console.log(`   Batch ${batch + 1}: Funded ${tx.instructions.length} wallets`);
        console.log(`   TX: ${sig}`);
        funded += tx.instructions.length;
      } catch (e) {
        console.log(`   ❌ Batch ${batch + 1} failed: ${e.message}`);
      }
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n✅ ${funded}/${NUM_WALLETS} wallets funded\n`);
  
  // Update bots info with funding status
  botsInfo.funded = true;
  botsInfo.fundedAt = new Date().toISOString();
  botsInfo.solPerWallet = SOL_PER_WALLET;
  fs.writeFileSync(BOTS_INFO_PATH, JSON.stringify(botsInfo, null, 2));
  
  console.log("=".repeat(60));
  console.log("✅ SETUP COMPLETE");
  console.log("=".repeat(60));
  console.log(`\nBot wallets: ${BOTS_DIR}`);
  console.log(`Info file: ${BOTS_INFO_PATH}`);
  console.log(`\nTo start trading, run: node trading_bots_run.js`);
}

main().catch(console.error);

