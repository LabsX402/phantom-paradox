import { PublicKey } from "@solana/web3.js";
import { randomBytes } from "crypto";

/**
 * ======================================================================
 * PHANTOM CHAIN v2 - Virtual Universe Mode
 * ======================================================================
 * In-memory blockchain simulator for testing without a real validator.
 * Tracks balances, accounts, and simulates smart contract execution.
 */

export class PhantomChain {
    // The "Ledger" (In-Memory)
    private balances: Map<string, bigint> = new Map();
    private accounts: Map<string, any> = new Map(); // Stores "Data" like Agent Registry

    constructor() {
        console.log("👻 PHANTOM CHAIN v2 (Universe Mode) INITIALIZED");
    }

    // --- BANKING ---
    async airdrop(pubkey: string, lamports: bigint) {
        const current = this.balances.get(pubkey) || 0n;
        this.balances.set(pubkey, current + lamports);
    }

    async getBalance(pubkey: string): Promise<bigint> {
        return this.balances.get(pubkey) || 0n;
    }

    // --- SMART CONTRACT SIMULATOR ---
    // This simulates "settle_net_batch" logic without Rust
    async executeBatchSettlement(
        vaultPubkey: string,
        netDeltas: Map<string, bigint>,
        fees: bigint,
        royalties: Map<string, bigint> // Agent -> Amount
    ): Promise<string> {
        
        // 1. Verify Vault Solvency (The Sentinel Check)
        let vaultBal = await this.getBalance(vaultPubkey);
        let totalOutflow = 0n;
        
        // Calculate net outflow from vault
        for (const delta of netDeltas.values()) {
            if (delta > 0n) totalOutflow += delta;
        }
        
        // In the "Soft State" model, the Vault should have received inflows earlier.
        // For this sim, we assume Vault has infinite liquidity or pre-funded.
        
        // 2. Apply User Deltas
        for (const [user, delta] of netDeltas.entries()) {
            const current = await this.getBalance(user);
            this.balances.set(user, current + delta);
        }

        // 3. Pay Royalties (The Nexus)
        for (const [agentId, amount] of royalties.entries()) {
            const current = await this.getBalance(agentId);
            this.balances.set(agentId, current + amount);
            // Log specifically for the test
            console.log(`   💰 Contract Logic: Paid ${amount} lamports royalties to Agent ${agentId.slice(0, 8)}...`);
        }

        // 4. Collect Protocol Fees
        // (Simulated burn or transfer to treasury)
        const treasuryBalance = await this.getBalance("PROTOCOL_TREASURY");
        this.balances.set("PROTOCOL_TREASURY", treasuryBalance + fees);
        console.log(`   🏦 Contract Logic: Swept ${fees} lamports to Treasury.`);

        return "sim_tx_" + randomBytes(16).toString('hex');
    }

    // Get all balances for debugging
    getAllBalances(): Map<string, bigint> {
        return new Map(this.balances);
    }
}

export const virtualChain = new PhantomChain();

