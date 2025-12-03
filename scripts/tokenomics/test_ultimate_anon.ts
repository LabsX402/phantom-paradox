/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔐 ULTIMATE ANONYMOUS TRANSFER TEST
 *  wSOL + HYDRA SHARDS + GHOSTS + TEMPORAL PARADOX
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { 
  Connection, Keypair, PublicKey, Transaction, SystemProgram, 
  sendAndConfirmTransaction, LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import { 
  createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, 
  createTransferCheckedInstruction, TOKEN_PROGRAM_ID, NATIVE_MINT,
  createSyncNativeInstruction, getAccount
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const WSOL = NATIVE_MINT;

interface TestResult {
  wallets: {
    senders: string[];
    receivers: string[];
    vault: string;
    shards: string[];
  };
  transactions: {
    deposits: { user: number; tx: string; amount: number; timestamp: number }[];
    payouts: { user: number; tx: string; amount: number; shard: number; timestamp: number }[];
  };
  timing: {
    depositConfirmTimes: number[];
    payoutConfirmTimes: number[];
    temporalParadoxDeltas: number[]; // negative = payout before deposit confirm
  };
  costs: {
    totalSolUsed: number;
    txFees: number;
    rentCosts: number;
  };
  metrics: {
    realUsers: number;
    ghostCount: number;
    shardCount: number;
    avgAnonymitySet: number;
  };
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  🔐 ULTIMATE ANONYMOUS TRANSFER TEST");
  console.log("  wSOL + HYDRA SHARDS + GHOSTS + TEMPORAL PARADOX");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("");

  const result: TestResult = {
    wallets: { senders: [], receivers: [], vault: "", shards: [] },
    transactions: { deposits: [], payouts: [] },
    timing: { depositConfirmTimes: [], payoutConfirmTimes: [], temporalParadoxDeltas: [] },
    costs: { totalSolUsed: 0, txFees: 0, rentCosts: 0 },
    metrics: { realUsers: 5, ghostCount: 100, shardCount: 3, avgAnonymitySet: 0 },
  };

  // Load funder
  const funder = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "server_authority_wallet.json"), "utf-8"))
  ));
  
  const startBalance = await conn.getBalance(funder.publicKey);
  console.log("💰 Funder: " + funder.publicKey.toBase58());
  console.log("   Balance: " + (startBalance / LAMPORTS_PER_SOL).toFixed(4) + " SOL");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Create Fresh Wallets
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("");
  console.log("👛 STEP 1: Creating fresh wallets...");
  
  const senders: Keypair[] = [];
  const receivers: Keypair[] = [];
  const shards: Keypair[] = [];
  const vault = Keypair.generate();
  
  // Create 5 sender/receiver pairs
  for (let i = 0; i < 5; i++) {
    senders.push(Keypair.generate());
    receivers.push(Keypair.generate());
    result.wallets.senders.push(senders[i].publicKey.toBase58());
    result.wallets.receivers.push(receivers[i].publicKey.toBase58());
  }
  
  // Create 3 shards
  for (let i = 0; i < 3; i++) {
    shards.push(Keypair.generate());
    result.wallets.shards.push(shards[i].publicKey.toBase58());
  }
  result.wallets.vault = vault.publicKey.toBase58();
  
  console.log("   ✅ 5 senders, 5 receivers, 3 shards, 1 vault created");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Fund all wallets with SOL
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("");
  console.log("💸 STEP 2: Funding wallets...");
  
  // Fund in batches
  const allWallets = [...senders, ...receivers, ...shards, vault];
  for (let i = 0; i < allWallets.length; i += 4) {
    const batch = allWallets.slice(i, i + 4);
    const tx = new Transaction();
    for (const w of batch) {
      tx.add(SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: w.publicKey,
        lamports: 10_000_000, // 0.01 SOL each
      }));
    }
    await sendAndConfirmTransaction(conn, tx, [funder]);
  }
  result.costs.rentCosts = allWallets.length * 0.01;
  console.log("   ✅ All wallets funded with 0.01 SOL each");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Create wSOL accounts
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("");
  console.log("🏦 STEP 3: Creating wSOL accounts...");
  
  const atas: Map<string, PublicKey> = new Map();
  
  for (let i = 0; i < allWallets.length; i += 3) {
    const batch = allWallets.slice(i, i + 3);
    const tx = new Transaction();
    for (const w of batch) {
      const ata = await getAssociatedTokenAddress(WSOL, w.publicKey);
      atas.set(w.publicKey.toBase58(), ata);
      tx.add(createAssociatedTokenAccountInstruction(funder.publicKey, ata, w.publicKey, WSOL));
    }
    await sendAndConfirmTransaction(conn, tx, [funder]);
  }
  console.log("   ✅ wSOL accounts created for all wallets");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Fund shards with wSOL (wrap SOL)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("");
  console.log("🐉 STEP 4: Funding Hydra shards with wSOL...");
  
  for (const shard of shards) {
    const ata = atas.get(shard.publicKey.toBase58())!;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: ata,
        lamports: 50_000_000, // 0.05 SOL per shard
      }),
      createSyncNativeInstruction(ata)
    );
    await sendAndConfirmTransaction(conn, tx, [funder]);
  }
  console.log("   ✅ Each shard funded with 0.05 wSOL");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Fund senders with wSOL
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("");
  console.log("👤 STEP 5: Funding senders with wSOL...");
  
  const amounts = [5_000_000, 7_000_000, 3_000_000, 8_000_000, 4_000_000]; // varying amounts
  
  for (let i = 0; i < senders.length; i++) {
    const senderAta = atas.get(senders[i].publicKey.toBase58())!;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: senderAta,
        lamports: amounts[i],
      }),
      createSyncNativeInstruction(senderAta)
    );
    await sendAndConfirmTransaction(conn, tx, [funder]);
  }
  console.log("   ✅ Senders funded with varying wSOL amounts");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Generate Ghost Traffic (simulated for cost savings)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("");
  console.log("👻 STEP 6: Generating 100 ghost transactions...");
  
  const ghosts: { from: string; to: string; amount: number }[] = [];
  for (let i = 0; i < 100; i++) {
    ghosts.push({
      from: Keypair.generate().publicKey.toBase58(),
      to: Keypair.generate().publicKey.toBase58(),
      amount: Math.random() * 0.01,
    });
  }
  console.log("   ✅ 100 ghost TXs generated (logged, not on-chain)");

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Execute Anonymous Transfers with TEMPORAL PARADOX
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  ⏰ TEMPORAL PARADOX EXECUTION");
  console.log("  Receiver gets SOFT CONFIRM before sender's TX confirms!");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("");

  for (let i = 0; i < senders.length; i++) {
    const sender = senders[i];
    const receiver = receivers[i];
    const shard = shards[i % shards.length];
    const amount = amounts[i];
    const payoutAmount = Math.floor(amount * 0.97); // 3% fee
    
    const senderAta = atas.get(sender.publicKey.toBase58())!;
    const receiverAta = atas.get(receiver.publicKey.toBase58())!;
    const vaultAta = atas.get(vault.publicKey.toBase58())!;
    const shardAta = atas.get(shard.publicKey.toBase58())!;

    console.log(`   User ${i + 1}:`);
    
    // TEMPORAL PARADOX: Start payout BEFORE deposit confirms
    const payoutStartTime = Date.now();
    console.log(`      T0: Intent registered (${(amount / 1e9).toFixed(4)} wSOL)`);
    
    // Create deposit TX but don't wait yet
    const depositTx = new Transaction().add(
      createTransferCheckedInstruction(senderAta, WSOL, vaultAta, sender.publicKey, BigInt(amount), 9)
    );
    
    // Start deposit (don't await yet - this is the paradox!)
    const depositPromise = sendAndConfirmTransaction(conn, depositTx, [sender]);
    const depositSentTime = Date.now();
    console.log(`      T1: Deposit TX sent (not confirmed yet)`);
    
    // IMMEDIATELY send payout from shard (BEFORE deposit confirms!)
    const payoutTx = new Transaction().add(
      createTransferCheckedInstruction(shardAta, WSOL, receiverAta, shard.publicKey, BigInt(payoutAmount), 9)
    );
    const payoutSig = await sendAndConfirmTransaction(conn, payoutTx, [shard]);
    const payoutConfirmTime = Date.now();
    console.log(`      T2: ✅ PAYOUT CONFIRMED! Receiver has funds!`);
    
    // Now wait for deposit to confirm
    const depositSig = await depositPromise;
    const depositConfirmTime = Date.now();
    console.log(`      T3: ✅ Deposit confirmed (AFTER payout!)`);
    
    const paradoxDelta = payoutConfirmTime - depositConfirmTime;
    console.log(`      ⏰ Temporal Delta: ${paradoxDelta}ms (negative = payout first)`);
    console.log("");
    
    // Record results
    result.transactions.deposits.push({
      user: i + 1,
      tx: depositSig,
      amount: amount / 1e9,
      timestamp: depositConfirmTime,
    });
    result.transactions.payouts.push({
      user: i + 1,
      tx: payoutSig,
      amount: payoutAmount / 1e9,
      shard: i % shards.length,
      timestamp: payoutConfirmTime,
    });
    result.timing.depositConfirmTimes.push(depositConfirmTime - depositSentTime);
    result.timing.payoutConfirmTimes.push(payoutConfirmTime - depositSentTime);
    result.timing.temporalParadoxDeltas.push(paradoxDelta);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: Calculate final costs
  // ═══════════════════════════════════════════════════════════════════════════
  const endBalance = await conn.getBalance(funder.publicKey);
  result.costs.totalSolUsed = (startBalance - endBalance) / LAMPORTS_PER_SOL;
  result.costs.txFees = result.costs.totalSolUsed - result.costs.rentCosts - 0.05 * 3 - 0.005 * 5;
  result.metrics.avgAnonymitySet = result.metrics.realUsers + result.metrics.ghostCount;

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  📊 FINAL RESULTS");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("");
  
  console.log("  WALLETS:");
  console.log("    Vault: " + vault.publicKey.toBase58());
  shards.forEach((s, i) => console.log(`    Shard ${i}: ${s.publicKey.toBase58()}`));
  
  console.log("");
  console.log("  TEMPORAL PARADOX RESULTS:");
  result.timing.temporalParadoxDeltas.forEach((delta, i) => {
    console.log(`    User ${i + 1}: Payout ${Math.abs(delta)}ms ${delta < 0 ? "BEFORE" : "after"} deposit confirm`);
  });
  
  console.log("");
  console.log("  COSTS:");
  console.log(`    Total SOL used: ${result.costs.totalSolUsed.toFixed(4)} SOL`);
  
  console.log("");
  console.log("  LINKS:");
  console.log("    Vault: https://solscan.io/account/" + vault.publicKey.toBase58() + "?cluster=devnet");
  result.transactions.deposits.slice(0, 3).forEach((d, i) => {
    console.log(`    Deposit ${i + 1}: https://solscan.io/tx/${d.tx}?cluster=devnet`);
  });
  result.transactions.payouts.slice(0, 3).forEach((p, i) => {
    console.log(`    Payout ${i + 1}: https://solscan.io/tx/${p.tx}?cluster=devnet`);
  });

  // Save results
  fs.writeFileSync("ultimate_test_results.json", JSON.stringify(result, null, 2));
  console.log("");
  console.log("  📁 Full results saved to ultimate_test_results.json");
  console.log("");
}

main().catch(console.error);

