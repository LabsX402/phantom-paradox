/**
 * ANONYMOUS PAYMENT INFRASTRUCTURE
 * 
 * Creates a proper mixing setup that breaks on-chain links:
 * 
 * FLOW:
 *   1. Deployer → VAULT (one-time funding)
 *   2. VAULT → Ghost wallets (random splits)
 *   3. Ghosts → Shards (broken link!)
 *   4. Shards → Recipients (anonymous!)
 * 
 * On-chain observer sees:
 *   - Deployer funded Vault (public knowledge)
 *   - Vault paid many ghosts (obfuscated)
 *   - Shards paid recipients (no link to deployer!)
 */

const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// CONFIG
const DEVNET_RPC = "https://api.devnet.solana.com";
const DEPLOYER_PATH = path.join(__dirname, '../../deployer_wallet.json');
const INFRA_DIR = path.join(__dirname, 'anon_infra');
const VAULT_PATH = path.join(INFRA_DIR, 'vault.json');
const GHOSTS_DIR = path.join(INFRA_DIR, 'ghosts');
const SHARDS_DIR = path.join(INFRA_DIR, 'shards');
const INFRA_INFO_PATH = path.join(INFRA_DIR, 'INFRA_INFO.json');

// HARD LIMITS
const MAX_TEST_AMOUNT = 0.05; // Max per test
const NUM_GHOSTS = 3;         // Intermediate mixing wallets
const NUM_SHARDS = 5;         // Final anonymous payers
const SHARD_FUNDING = 0.03;   // Each shard gets this

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  🕵️ ANONYMOUS PAYMENT INFRASTRUCTURE SETUP");
  console.log("=".repeat(60));
  console.log("\n  Breaking on-chain links with vault/ghost/shard pattern\n");
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  
  // Load deployer
  const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf8'));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerData));
  
  const balance = await connection.getBalance(deployer.publicKey);
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);
  
  // Calculate how much to use (leave 1 SOL for other ops)
  const availableSol = Math.max(0, (balance / LAMPORTS_PER_SOL) - 1);
  const totalNeeded = NUM_SHARDS * SHARD_FUNDING + 0.01; // shards + fees
  
  if (availableSol < totalNeeded) {
    console.log(`⚠️  Need ${totalNeeded.toFixed(3)} SOL, have ${availableSol.toFixed(3)} available`);
    console.log("   Will fund what we can...\n");
  }
  
  // Create directories
  [INFRA_DIR, GHOSTS_DIR, SHARDS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  
  let infraInfo;
  
  // Check if infrastructure already exists
  if (fs.existsSync(INFRA_INFO_PATH)) {
    infraInfo = JSON.parse(fs.readFileSync(INFRA_INFO_PATH, 'utf8'));
    console.log("📋 Found existing infrastructure\n");
  } else {
    console.log("🔧 Creating new infrastructure...\n");
    
    // Create VAULT
    const vault = Keypair.generate();
    fs.writeFileSync(VAULT_PATH, JSON.stringify(Array.from(vault.secretKey)));
    console.log(`✅ VAULT: ${vault.publicKey.toBase58()}`);
    
    // Create GHOSTS (mixing layer)
    const ghosts = [];
    for (let i = 0; i < NUM_GHOSTS; i++) {
      const ghost = Keypair.generate();
      const ghostPath = path.join(GHOSTS_DIR, `ghost_${i}.json`);
      fs.writeFileSync(ghostPath, JSON.stringify(Array.from(ghost.secretKey)));
      ghosts.push({ index: i, pubkey: ghost.publicKey.toBase58(), path: ghostPath });
      console.log(`✅ GHOST ${i}: ${ghost.publicKey.toBase58().slice(0, 12)}...`);
    }
    
    // Create SHARDS (final anonymous payers)
    const shards = [];
    for (let i = 0; i < NUM_SHARDS; i++) {
      const shard = Keypair.generate();
      const shardPath = path.join(SHARDS_DIR, `shard_${i}.json`);
      fs.writeFileSync(shardPath, JSON.stringify(Array.from(shard.secretKey)));
      shards.push({ index: i, pubkey: shard.publicKey.toBase58(), path: shardPath });
      console.log(`✅ SHARD ${i}: ${shard.publicKey.toBase58().slice(0, 12)}...`);
    }
    
    infraInfo = {
      vault: { pubkey: vault.publicKey.toBase58(), path: VAULT_PATH },
      ghosts,
      shards,
      createdAt: new Date().toISOString(),
      maxTestAmount: MAX_TEST_AMOUNT,
    };
    
    fs.writeFileSync(INFRA_INFO_PATH, JSON.stringify(infraInfo, null, 2));
    console.log("\n✅ Infrastructure created!\n");
  }
  
  // Load keys
  const vaultKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(infraInfo.vault.path, 'utf8'))));
  
  // STEP 1: Fund VAULT from Deployer (this is the ONLY link!)
  console.log("=".repeat(50));
  console.log("  STEP 1: Deployer → Vault (public funding)");
  console.log("=".repeat(50) + "\n");
  
  const vaultBalance = await connection.getBalance(vaultKey.publicKey);
  const vaultNeeds = totalNeeded - (vaultBalance / LAMPORTS_PER_SOL);
  
  if (vaultNeeds > 0.005 && availableSol > 0.01) {
    const toSend = Math.min(vaultNeeds + 0.005, availableSol);
    console.log(`Funding vault with ${toSend.toFixed(4)} SOL...`);
    
    const tx1 = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: vaultKey.publicKey,
        lamports: Math.floor(toSend * LAMPORTS_PER_SOL),
      })
    );
    
    try {
      const sig1 = await sendAndConfirmTransaction(connection, tx1, [deployer]);
      console.log(`✅ TX: ${sig1.slice(0, 20)}...`);
      console.log(`   Explorer: https://solscan.io/tx/${sig1}?cluster=devnet\n`);
    } catch (e) {
      console.log(`❌ Failed: ${e.message}\n`);
    }
    
    await sleep(2000);
  } else {
    console.log(`Vault already funded: ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);
  }
  
  // STEP 2: Vault → Ghosts (mixing layer - breaks link!)
  console.log("=".repeat(50));
  console.log("  STEP 2: Vault → Ghosts (MIXING - breaks link!)");
  console.log("=".repeat(50) + "\n");
  
  const currentVaultBal = await connection.getBalance(vaultKey.publicKey);
  const perGhost = (currentVaultBal / LAMPORTS_PER_SOL) / NUM_GHOSTS - 0.001;
  
  if (perGhost > 0.005) {
    const tx2 = new Transaction();
    
    for (const ghostInfo of infraInfo.ghosts) {
      const ghostBal = await connection.getBalance(new PublicKey(ghostInfo.pubkey));
      if (ghostBal < perGhost * LAMPORTS_PER_SOL * 0.5) {
        // Random amount to further obfuscate
        const randomAmount = perGhost * (0.7 + Math.random() * 0.3);
        tx2.add(
          SystemProgram.transfer({
            fromPubkey: vaultKey.publicKey,
            toPubkey: new PublicKey(ghostInfo.pubkey),
            lamports: Math.floor(randomAmount * LAMPORTS_PER_SOL),
          })
        );
        console.log(`Ghost ${ghostInfo.index}: +${randomAmount.toFixed(4)} SOL`);
      }
    }
    
    if (tx2.instructions.length > 0) {
      try {
        const sig2 = await sendAndConfirmTransaction(connection, tx2, [vaultKey]);
        console.log(`\n✅ TX: ${sig2.slice(0, 20)}...`);
        console.log(`   Explorer: https://solscan.io/tx/${sig2}?cluster=devnet\n`);
      } catch (e) {
        console.log(`❌ Failed: ${e.message}\n`);
      }
      await sleep(2000);
    }
  } else {
    console.log("Not enough in vault for ghost funding\n");
  }
  
  // STEP 3: Ghosts → Shards (final distribution - fully broken link!)
  console.log("=".repeat(50));
  console.log("  STEP 3: Ghosts → Shards (ANONYMOUS LAYER)");
  console.log("=".repeat(50) + "\n");
  
  // Each ghost funds different shards (round-robin with randomization)
  for (let i = 0; i < infraInfo.ghosts.length; i++) {
    const ghostInfo = infraInfo.ghosts[i];
    const ghostKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ghostInfo.path, 'utf8'))));
    const ghostBal = await connection.getBalance(ghostKey.publicKey);
    
    if (ghostBal < 0.01 * LAMPORTS_PER_SOL) continue;
    
    const tx3 = new Transaction();
    
    // Each ghost funds ~2 shards (overlapping for mixing)
    const shardsToFund = infraInfo.shards.filter((_, idx) => idx % NUM_GHOSTS === i || (idx + 1) % NUM_GHOSTS === i);
    
    for (const shardInfo of shardsToFund) {
      const shardBal = await connection.getBalance(new PublicKey(shardInfo.pubkey));
      if (shardBal < SHARD_FUNDING * LAMPORTS_PER_SOL * 0.5) {
        const amount = SHARD_FUNDING * (0.8 + Math.random() * 0.4); // Randomize!
        tx3.add(
          SystemProgram.transfer({
            fromPubkey: ghostKey.publicKey,
            toPubkey: new PublicKey(shardInfo.pubkey),
            lamports: Math.floor(amount * LAMPORTS_PER_SOL),
          })
        );
        console.log(`Ghost ${i} → Shard ${shardInfo.index}: ${amount.toFixed(4)} SOL`);
      }
    }
    
    if (tx3.instructions.length > 0) {
      try {
        const sig3 = await sendAndConfirmTransaction(connection, tx3, [ghostKey]);
        console.log(`✅ TX: ${sig3.slice(0, 20)}...`);
      } catch (e) {
        console.log(`❌ ${e.message}`);
      }
      await sleep(1500);
    }
  }
  
  // Final status
  console.log("\n" + "=".repeat(60));
  console.log("  📊 FINAL INFRASTRUCTURE STATUS");
  console.log("=".repeat(60) + "\n");
  
  const finalVaultBal = await connection.getBalance(vaultKey.publicKey);
  console.log(`VAULT: ${(finalVaultBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  console.log("\nGHOSTS:");
  for (const g of infraInfo.ghosts) {
    const bal = await connection.getBalance(new PublicKey(g.pubkey));
    console.log(`  Ghost ${g.index}: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }
  
  console.log("\nSHARDS (anonymous payers):");
  let totalShardSol = 0;
  for (const s of infraInfo.shards) {
    const bal = await connection.getBalance(new PublicKey(s.pubkey));
    totalShardSol += bal / LAMPORTS_PER_SOL;
    console.log(`  Shard ${s.index}: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL | ${s.pubkey.slice(0, 8)}...`);
  }
  
  console.log("\n" + "-".repeat(40));
  console.log(`Total in shards: ${totalShardSol.toFixed(4)} SOL`);
  console.log(`Max tests (0.05 SOL each): ${Math.floor(totalShardSol / MAX_TEST_AMOUNT)}`);
  console.log(`HARD LIMIT: ${MAX_TEST_AMOUNT} SOL per test`);
  
  console.log("\n✅ Ready for anonymous payments!");
  console.log("   Shards have NO direct link to deployer.\n");
}

main().catch(console.error);

