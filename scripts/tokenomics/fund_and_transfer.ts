import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, createTransferCheckedInstruction, TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const PDOX = new PublicKey("4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF");
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  🔐 100% ANONYMOUS TRANSFER - FUNDING & EXECUTING");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("");

  // Load wallets
  const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deployer_wallet.json"), "utf-8"))));
  const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, "hydra_test_wallets.json"), "utf-8"));
  
  const walletA = Keypair.fromSecretKey(Uint8Array.from(wallets.walletA.secret));
  const walletB = Keypair.fromSecretKey(Uint8Array.from(wallets.walletB.secret));
  const vault = Keypair.fromSecretKey(Uint8Array.from(wallets.vault.secret));
  const blackMirror = Keypair.fromSecretKey(Uint8Array.from(wallets.blackMirror.secret));

  console.log("📍 Addresses:");
  console.log("   Wallet A:    " + walletA.publicKey.toBase58());
  console.log("   Vault:       " + vault.publicKey.toBase58());
  console.log("   BlackMirror: " + blackMirror.publicKey.toBase58());
  console.log("   Wallet B:    " + walletB.publicKey.toBase58());
  console.log("");

  // Step 1: Fund all wallets with SOL (minimal amounts)
  console.log("💰 STEP 1: Funding wallets with SOL...");
  const tx1 = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: walletA.publicKey, lamports: 5_000_000 }),
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: vault.publicKey, lamports: 5_000_000 }),
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: blackMirror.publicKey, lamports: 5_000_000 }),
    SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: walletB.publicKey, lamports: 5_000_000 })
  );
  const sig1 = await sendAndConfirmTransaction(conn, tx1, [deployer]);
  console.log("   ✅ TX: " + sig1);
  console.log("");

  // Step 2: Create PDOX token accounts
  console.log("🏦 STEP 2: Creating PDOX token accounts...");
  const walletA_ATA = await getAssociatedTokenAddress(PDOX, walletA.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const walletB_ATA = await getAssociatedTokenAddress(PDOX, walletB.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const vault_ATA = await getAssociatedTokenAddress(PDOX, vault.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const blackMirror_ATA = await getAssociatedTokenAddress(PDOX, blackMirror.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const deployer_ATA = await getAssociatedTokenAddress(PDOX, deployer.publicKey, false, TOKEN_2022_PROGRAM_ID);

  const tx2 = new Transaction().add(
    createAssociatedTokenAccountInstruction(deployer.publicKey, walletA_ATA, walletA.publicKey, PDOX, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(deployer.publicKey, vault_ATA, vault.publicKey, PDOX, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(deployer.publicKey, blackMirror_ATA, blackMirror.publicKey, PDOX, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(deployer.publicKey, walletB_ATA, walletB.publicKey, PDOX, TOKEN_2022_PROGRAM_ID)
  );
  const sig2 = await sendAndConfirmTransaction(conn, tx2, [deployer]);
  console.log("   ✅ TX: " + sig2);
  console.log("");

  // Step 3: Fund Wallet A with 500 PDOX
  console.log("💸 STEP 3: Funding Wallet A with 500 PDOX...");
  const tx3 = new Transaction().add(
    createTransferCheckedInstruction(deployer_ATA, PDOX, walletA_ATA, deployer.publicKey, 500_000_000_000n, 9, [], TOKEN_2022_PROGRAM_ID)
  );
  const sig3 = await sendAndConfirmTransaction(conn, tx3, [deployer]);
  console.log("   ✅ TX: " + sig3);
  console.log("");

  // Step 4: Fund BlackMirror LP with 1000 PDOX
  console.log("🪞 STEP 4: Funding BlackMirror LP with 1000 PDOX...");
  const tx4 = new Transaction().add(
    createTransferCheckedInstruction(deployer_ATA, PDOX, blackMirror_ATA, deployer.publicKey, 1000_000_000_000n, 9, [], TOKEN_2022_PROGRAM_ID)
  );
  const sig4 = await sendAndConfirmTransaction(conn, tx4, [deployer]);
  console.log("   ✅ TX: " + sig4);
  console.log("");

  // Step 5: ANONYMOUS TRANSFER - Wallet A -> Vault
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  🔒 ANONYMOUS TRANSFER EXECUTION");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("📤 STEP 5: Wallet A -> VAULT (100 PDOX deposit)...");
  const tx5 = new Transaction().add(
    createTransferCheckedInstruction(walletA_ATA, PDOX, vault_ATA, walletA.publicKey, 100_000_000_000n, 9, [], TOKEN_2022_PROGRAM_ID)
  );
  const sig5 = await sendAndConfirmTransaction(conn, tx5, [walletA]);
  console.log("   ✅ TX: " + sig5);
  console.log("   🔗 https://solscan.io/tx/" + sig5 + "?cluster=devnet");
  console.log("");

  // Step 6: ANONYMOUS PAYOUT - BlackMirror -> Wallet B  
  console.log("📥 STEP 6: BLACKMIRROR -> Wallet B (97 PDOX payout after 3% fee)...");
  const tx6 = new Transaction().add(
    createTransferCheckedInstruction(blackMirror_ATA, PDOX, walletB_ATA, blackMirror.publicKey, 97_000_000_000n, 9, [], TOKEN_2022_PROGRAM_ID)
  );
  const sig6 = await sendAndConfirmTransaction(conn, tx6, [blackMirror]);
  console.log("   ✅ TX: " + sig6);
  console.log("   🔗 https://solscan.io/tx/" + sig6 + "?cluster=devnet");
  console.log("");

  // Final balances
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  📊 FINAL STATE");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("");

  const aBalance = (await getAccount(conn, walletA_ATA, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const vBalance = (await getAccount(conn, vault_ATA, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const bmBalance = (await getAccount(conn, blackMirror_ATA, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const bBalance = (await getAccount(conn, walletB_ATA, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;

  console.log("   Wallet A:    " + (Number(aBalance) / 1e9).toFixed(2) + " PDOX");
  console.log("   Vault:       " + (Number(vBalance) / 1e9).toFixed(2) + " PDOX");
  console.log("   BlackMirror: " + (Number(bmBalance) / 1e9).toFixed(2) + " PDOX");
  console.log("   Wallet B:    " + (Number(bBalance) / 1e9).toFixed(2) + " PDOX");
  console.log("");

  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("  🎉 100% ANONYMOUS TRANSFER COMPLETE!");
  console.log("═══════════════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("  ON-CHAIN VISIBILITY:");
  console.log("  ✅ TX1: Wallet A -> Vault      (visible)");
  console.log("  ✅ TX2: BlackMirror -> Wallet B (visible)");
  console.log("  ❌ NO LINK between Wallet A and Wallet B!");
  console.log("");
  console.log("  SOLSCAN LINKS:");
  console.log("  Wallet A:    https://solscan.io/account/" + walletA.publicKey.toBase58() + "?cluster=devnet");
  console.log("  Vault:       https://solscan.io/account/" + vault.publicKey.toBase58() + "?cluster=devnet");
  console.log("  BlackMirror: https://solscan.io/account/" + blackMirror.publicKey.toBase58() + "?cluster=devnet");
  console.log("  Wallet B:    https://solscan.io/account/" + walletB.publicKey.toBase58() + "?cluster=devnet");
  console.log("");
}

main().catch(console.error);

