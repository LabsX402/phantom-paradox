/**
 * FUND SHARDS FROM GHOSTS - One at a time
 */
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const DEVNET_RPC = "https://api.devnet.solana.com";
const INFRA_DIR = path.join(__dirname, 'anon_infra');
const INFRA_INFO_PATH = path.join(INFRA_DIR, 'INFRA_INFO.json');
const DEPLOYER_PATH = path.join(__dirname, '../../deployer_wallet.json');

const SHARD_TARGET = 0.03; // Each shard should have ~0.03 SOL

async function main() {
  console.log("\n=== FUNDING SHARDS FROM GHOSTS ===\n");
  
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const infraInfo = JSON.parse(fs.readFileSync(INFRA_INFO_PATH, 'utf8'));
  
  // First, top up vault if needed
  const vaultKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(infraInfo.vault.path, 'utf8'))));
  const vaultBal = await connection.getBalance(vaultKey.publicKey);
  console.log(`Vault: ${(vaultBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  // Check ghost balances
  let totalGhostBal = 0;
  for (const g of infraInfo.ghosts) {
    const bal = await connection.getBalance(new PublicKey(g.pubkey));
    totalGhostBal += bal / LAMPORTS_PER_SOL;
    console.log(`Ghost ${g.index}: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }
  
  // Check how much shards need
  let shardsNeed = 0;
  for (const s of infraInfo.shards) {
    const bal = await connection.getBalance(new PublicKey(s.pubkey));
    const need = SHARD_TARGET - (bal / LAMPORTS_PER_SOL);
    if (need > 0.005) shardsNeed += need;
    console.log(`Shard ${s.index}: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL (needs ${need > 0 ? need.toFixed(4) : '0'})`);
  }
  
  console.log(`\nTotal in ghosts: ${totalGhostBal.toFixed(4)} SOL`);
  console.log(`Shards need: ${shardsNeed.toFixed(4)} SOL\n`);
  
  if (totalGhostBal < shardsNeed) {
    // Need to top up ghosts via vault
    const deployerData = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf8'));
    const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerData));
    const deployerBal = await connection.getBalance(deployer.publicKey);
    
    const toAdd = shardsNeed - totalGhostBal + 0.02; // Extra for fees
    console.log(`Need to add ${toAdd.toFixed(4)} SOL to system...`);
    
    if (deployerBal / LAMPORTS_PER_SOL > toAdd + 0.5) {
      // Fund vault
      console.log("Funding vault...");
      const tx1 = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: vaultKey.publicKey,
          lamports: Math.floor(toAdd * LAMPORTS_PER_SOL),
        })
      );
      const sig1 = await sendAndConfirmTransaction(connection, tx1, [deployer]);
      console.log(`TX: ${sig1.slice(0, 30)}...`);
      
      await new Promise(r => setTimeout(r, 1000));
      
      // Spread to ghosts
      console.log("\nSpreading to ghosts...");
      const perGhost = toAdd / infraInfo.ghosts.length - 0.002;
      const tx2 = new Transaction();
      for (const g of infraInfo.ghosts) {
        tx2.add(
          SystemProgram.transfer({
            fromPubkey: vaultKey.publicKey,
            toPubkey: new PublicKey(g.pubkey),
            lamports: Math.floor(perGhost * LAMPORTS_PER_SOL),
          })
        );
      }
      const sig2 = await sendAndConfirmTransaction(connection, tx2, [vaultKey]);
      console.log(`TX: ${sig2.slice(0, 30)}...`);
      
      await new Promise(r => setTimeout(r, 1000));
    } else {
      console.log("Not enough SOL in deployer to top up!");
    }
  }
  
  // Now fund shards one at a time from ghosts
  console.log("\n=== FUNDING SHARDS ===\n");
  
  for (let i = 0; i < infraInfo.shards.length; i++) {
    const shardInfo = infraInfo.shards[i];
    const shardBal = await connection.getBalance(new PublicKey(shardInfo.pubkey));
    
    if (shardBal >= SHARD_TARGET * LAMPORTS_PER_SOL * 0.9) {
      console.log(`Shard ${i}: Already funded (${(shardBal / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
      continue;
    }
    
    // Pick a ghost that has enough
    const ghostIdx = i % infraInfo.ghosts.length;
    const ghostInfo = infraInfo.ghosts[ghostIdx];
    const ghostKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ghostInfo.path, 'utf8'))));
    const ghostBal = await connection.getBalance(ghostKey.publicKey);
    
    const toSend = Math.min(SHARD_TARGET, (ghostBal / LAMPORTS_PER_SOL) - 0.002);
    
    if (toSend < 0.01) {
      console.log(`Shard ${i}: Ghost ${ghostIdx} has insufficient funds`);
      continue;
    }
    
    console.log(`Shard ${i}: Ghost ${ghostIdx} → ${toSend.toFixed(4)} SOL`);
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: ghostKey.publicKey,
        toPubkey: new PublicKey(shardInfo.pubkey),
        lamports: Math.floor(toSend * LAMPORTS_PER_SOL),
      })
    );
    
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [ghostKey]);
      console.log(`  ✅ TX: ${sig.slice(0, 20)}...`);
    } catch (e) {
      console.log(`  ❌ ${e.message.slice(0, 50)}...`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Final status
  console.log("\n=== FINAL SHARD BALANCES ===\n");
  let total = 0;
  for (const s of infraInfo.shards) {
    const bal = await connection.getBalance(new PublicKey(s.pubkey));
    total += bal / LAMPORTS_PER_SOL;
    console.log(`Shard ${s.index}: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL | ${s.pubkey.slice(0, 12)}...`);
  }
  console.log(`\nTotal: ${total.toFixed(4)} SOL`);
  console.log(`Max tests at 0.05 SOL: ${Math.floor(total / 0.05)}`);
}

main().catch(console.error);

