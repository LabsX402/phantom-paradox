import { Keypair } from "@solana/web3.js";
import * as fs from "fs";

// Create fresh wallets
const walletA = Keypair.generate();
const walletB = Keypair.generate();
const vault = Keypair.generate();
const blackMirror = Keypair.generate();

const wallets = {
  walletA: { pubkey: walletA.publicKey.toBase58(), secret: Array.from(walletA.secretKey) },
  walletB: { pubkey: walletB.publicKey.toBase58(), secret: Array.from(walletB.secretKey) },
  vault: { pubkey: vault.publicKey.toBase58(), secret: Array.from(vault.secretKey) },
  blackMirror: { pubkey: blackMirror.publicKey.toBase58(), secret: Array.from(blackMirror.secretKey) },
  createdAt: new Date().toISOString()
};

fs.writeFileSync("hydra_test_wallets.json", JSON.stringify(wallets, null, 2));

console.log("");
console.log("===============================================================================");
console.log("  FRESH ANONYMOUS TRANSFER WALLETS");
console.log("===============================================================================");
console.log("");
console.log("  WALLET A (Sender):");
console.log("     Address: " + walletA.publicKey.toBase58());
console.log("     Solscan: https://solscan.io/account/" + walletA.publicKey.toBase58() + "?cluster=devnet");
console.log("");
console.log("  VAULT (Deposit Pool):");
console.log("     Address: " + vault.publicKey.toBase58());
console.log("     Solscan: https://solscan.io/account/" + vault.publicKey.toBase58() + "?cluster=devnet");
console.log("");
console.log("  BLACKMIRROR (Payout Pool):");
console.log("     Address: " + blackMirror.publicKey.toBase58());
console.log("     Solscan: https://solscan.io/account/" + blackMirror.publicKey.toBase58() + "?cluster=devnet");
console.log("");
console.log("  WALLET B (Receiver):");
console.log("     Address: " + walletB.publicKey.toBase58());
console.log("     Solscan: https://solscan.io/account/" + walletB.publicKey.toBase58() + "?cluster=devnet");
console.log("");
console.log("===============================================================================");
console.log("");
console.log("  ANONYMOUS FLOW:");
console.log("");
console.log("  WALLET A -----> VAULT         BLACKMIRROR -----> WALLET B");
console.log("   (sends)      (deposits)        (pays out)       (receives)");
console.log("");
console.log("  NO ON-CHAIN LINK between Wallet A and Wallet B!");
console.log("  Vault and BlackMirror are SEPARATE pools!");
console.log("  Only visible on-chain: A->Vault and BlackMirror->B");
console.log("");
console.log("  Saved to: hydra_test_wallets.json");
console.log("");

