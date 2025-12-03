import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PhantomParadox } from "../target/types/phantom_paradox";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

// Simple assertion helpers (Anchor tests don't require chai)
function expect(condition: any, message?: string) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function expectEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected}, got ${actual}`
    );
  }
}

function expectToContain(str: string, substring: string, message?: string) {
  if (!str.includes(substring)) {
    throw new Error(
      message || `Expected "${str}" to contain "${substring}"`
    );
  }
}

describe("settle_net_batch", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.PhantomParadox as Program<PhantomParadox>;
  const provider = anchor.getProvider();

  // Test keypairs
  let admin: Keypair;
  let serverAuthority: Keypair;
  let globalConfig: PublicKey;

  before(async () => {
    // Generate test keypairs
    admin = Keypair.generate();
    serverAuthority = Keypair.generate();

    // Airdrop SOL to admin
    const airdropSig = await provider.connection.requestAirdrop(
      admin.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Derive global config PDA
    [globalConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Initialize GlobalConfig
    try {
      await program.methods
        .initConfig(
          admin.publicKey, // governance
          serverAuthority.publicKey, // server_authority
          new BN(100) // protocol_fee_bps (1%)
        )
        .accounts({
          admin: admin.publicKey,
          config: globalConfig,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    } catch (error: any) {
      // Config might already be initialized, that's ok
      if (!error.message?.includes("already in use")) {
        throw error;
      }
    }
  });

  describe("Valid batch settlement", () => {
    it("should successfully settle a valid batch with zero-sum cash deltas", async () => {
      const batchId = new BN(1);
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000001",
        "hex"
      );

      // Create test wallets
      const wallet1 = Keypair.generate().publicKey;
      const wallet2 = Keypair.generate().publicKey;

      // Items: 2 items with different owners
      const items = [
        {
          itemId: new BN(1),
          finalOwner: wallet1,
        },
        {
          itemId: new BN(2),
          finalOwner: wallet2,
        },
      ];

      // Cash deltas: sum to zero (pure netting)
      const cashDeltas = [
        {
          owner: wallet1,
          deltaLamports: new BN(1000), // wallet1 receives 1000
        },
        {
          owner: wallet2,
          deltaLamports: new BN(-1000), // wallet2 pays 1000
        },
      ];

      // Settle the batch
      const txSig = await program.methods
        .settleNetBatch(
          batchId,
          Array.from(batchHash),
          items,
          cashDeltas
        )
        .accounts({
          config: globalConfig,
          authority: serverAuthority.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([serverAuthority])
        .rpc();

      expect(txSig, "Transaction signature should be defined");
      expect(typeof txSig === "string", "Transaction signature should be a string");

      // Verify last_net_batch_id was updated
      const config = await program.account.globalConfig.fetch(globalConfig);
      expectEqual(config.lastNetBatchId.toNumber(), 1, "last_net_batch_id should be 1");
    });
  });

  describe("Replay protection", () => {
    it("should reject duplicate batch_id (replay attack)", async () => {
      const batchId = new BN(1); // Same batch_id as before
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000002",
        "hex"
      );

      const wallet1 = Keypair.generate().publicKey;
      const wallet2 = Keypair.generate().publicKey;

      const items = [
        {
          itemId: new BN(3),
          finalOwner: wallet1,
        },
      ];

      const cashDeltas = [
        {
          owner: wallet1,
          deltaLamports: new BN(500),
        },
        {
          owner: wallet2,
          deltaLamports: new BN(-500),
        },
      ];

      // Should fail because batch_id = 1 was already used
      try {
        await program.methods
          .settleNetBatch(
            batchId,
            Array.from(batchHash),
            items,
            cashDeltas
          )
          .accounts({
            config: globalConfig,
            authority: serverAuthority.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([serverAuthority])
          .rpc();

        throw new Error("Should have thrown an error for duplicate batch_id");
      } catch (error: any) {
        const errorStr = error.message || error.toString();
        expectToContain(errorStr, "InvalidBatchId", "Should contain InvalidBatchId error");
      }

      // Verify last_net_batch_id was NOT updated
      const config = await program.account.globalConfig.fetch(globalConfig);
      expectEqual(config.lastNetBatchId.toNumber(), 1, "last_net_batch_id should still be 1");
    });

    it("should reject batch_id <= last_net_batch_id", async () => {
      const batchId = new BN(0); // Less than last (which is 1)
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000003",
        "hex"
      );

      const wallet1 = Keypair.generate().publicKey;
      const wallet2 = Keypair.generate().publicKey;

      const items: any[] = [];
      const cashDeltas = [
        {
          owner: wallet1,
          deltaLamports: new BN(100),
        },
        {
          owner: wallet2,
          deltaLamports: new BN(-100),
        },
      ];

      try {
        await program.methods
          .settleNetBatch(
            batchId,
            Array.from(batchHash),
            items,
            cashDeltas
          )
          .accounts({
            config: globalConfig,
            authority: serverAuthority.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([serverAuthority])
          .rpc();

        throw new Error("Should have thrown an error for batch_id <= last_net_batch_id");
      } catch (error: any) {
        const errorStr = error.message || error.toString();
        expectToContain(errorStr, "InvalidBatchId", "Should contain InvalidBatchId error");
      }
    });
  });

  describe("Cash delta sum validation", () => {
    it("should reject batches where cash deltas do NOT sum to zero", async () => {
      const batchId = new BN(2);
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000004",
        "hex"
      );

      const wallet1 = Keypair.generate().publicKey;
      const wallet2 = Keypair.generate().publicKey;

      const items: any[] = [];

      // Cash deltas that sum to 2000 (not zero) - creates SOL out of thin air
      const cashDeltas = [
        {
          owner: wallet1,
          deltaLamports: new BN(1000),
        },
        {
          owner: wallet2,
          deltaLamports: new BN(1000), // Sum = 2000, should be 0
        },
      ];

      try {
        await program.methods
          .settleNetBatch(
            batchId,
            Array.from(batchHash),
            items,
            cashDeltas
          )
          .accounts({
            config: globalConfig,
            authority: serverAuthority.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([serverAuthority])
          .rpc();

        throw new Error("Should have thrown an error for invalid cash delta sum");
      } catch (error: any) {
        const errorStr = error.message || error.toString();
        expectToContain(errorStr, "InvalidAmount", "Should contain InvalidAmount error");
      }

      // Verify last_net_batch_id was NOT updated
      const config = await program.account.globalConfig.fetch(globalConfig);
      expectEqual(config.lastNetBatchId.toNumber(), 1, "last_net_batch_id should still be 1");
    });

    it("should accept batches with zero-sum cash deltas", async () => {
      const batchId = new BN(2);
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000005",
        "hex"
      );

      const wallet1 = Keypair.generate().publicKey;
      const wallet2 = Keypair.generate().publicKey;
      const wallet3 = Keypair.generate().publicKey;

      const items: any[] = [];

      // Cash deltas that sum to zero (valid)
      const cashDeltas = [
        {
          owner: wallet1,
          deltaLamports: new BN(1000),
        },
        {
          owner: wallet2,
          deltaLamports: new BN(500),
        },
        {
          owner: wallet3,
          deltaLamports: new BN(-1500), // Sum = 0
        },
      ];

      const txSig = await program.methods
        .settleNetBatch(
          batchId,
          Array.from(batchHash),
          items,
          cashDeltas
        )
        .accounts({
          config: globalConfig,
          authority: serverAuthority.publicKey,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([serverAuthority])
        .rpc();

      expect(txSig, "Transaction signature should be defined");
      expect(typeof txSig === "string", "Transaction signature should be a string");

      // Verify last_net_batch_id was updated
      const config = await program.account.globalConfig.fetch(globalConfig);
      expectEqual(config.lastNetBatchId.toNumber(), 2, "last_net_batch_id should be 2");
    });
  });

  describe("Batch size limits", () => {
    it("should reject batches with too many items", async () => {
      const batchId = new BN(3);
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000006",
        "hex"
      );

      const wallet = Keypair.generate().publicKey;

      // Create 10,001 items (exceeds limit of 10,000)
      const items = Array.from({ length: 10001 }, (_, i) => ({
        itemId: new BN(i + 1),
        finalOwner: wallet,
      }));

      const cashDeltas: any[] = [];

      try {
        await program.methods
          .settleNetBatch(
            batchId,
            Array.from(batchHash),
            items,
            cashDeltas
          )
          .accounts({
            config: globalConfig,
            authority: serverAuthority.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([serverAuthority])
          .rpc();

        throw new Error("Should have thrown an error for too many items");
      } catch (error: any) {
        const errorStr = error.message || error.toString();
        expectToContain(errorStr, "InvalidAmount", "Should contain InvalidAmount error");
      }

      // Verify last_net_batch_id was NOT updated
      const config = await program.account.globalConfig.fetch(globalConfig);
      expectEqual(config.lastNetBatchId.toNumber(), 2, "last_net_batch_id should still be 2");
    });

    it("should reject batches with too many wallets", async () => {
      const batchId = new BN(3);
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000007",
        "hex"
      );

      const items: any[] = [];

      // Create 5,001 wallets (exceeds limit of 5,000)
      const cashDeltas = Array.from({ length: 5001 }, (_, i) => ({
        owner: Keypair.generate().publicKey,
        deltaLamports: new BN(i % 2 === 0 ? 1 : -1), // Alternate to keep sum near zero
      }));

      // Adjust last delta to make sum exactly zero
      cashDeltas[cashDeltas.length - 1].deltaLamports = new BN(
        -Math.floor(5000 / 2)
      );

      try {
        await program.methods
          .settleNetBatch(
            batchId,
            Array.from(batchHash),
            items,
            cashDeltas
          )
          .accounts({
            config: globalConfig,
            authority: serverAuthority.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([serverAuthority])
          .rpc();

        throw new Error("Should have thrown an error for too many wallets");
      } catch (error: any) {
        const errorStr = error.message || error.toString();
        expectToContain(errorStr, "InvalidAmount", "Should contain InvalidAmount error");
      }
    });
  });

  describe("Duplicate items", () => {
    it("should reject batches with duplicate item_ids", async () => {
      const batchId = new BN(3);
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000008",
        "hex"
      );

      const wallet1 = Keypair.generate().publicKey;
      const wallet2 = Keypair.generate().publicKey;

      // Duplicate item_id = 1
      const items = [
        {
          itemId: new BN(1),
          finalOwner: wallet1,
        },
        {
          itemId: new BN(1), // Duplicate!
          finalOwner: wallet2,
        },
      ];

      const cashDeltas = [
        {
          owner: wallet1,
          deltaLamports: new BN(1000),
        },
        {
          owner: wallet2,
          deltaLamports: new BN(-1000),
        },
      ];

      try {
        await program.methods
          .settleNetBatch(
            batchId,
            Array.from(batchHash),
            items,
            cashDeltas
          )
          .accounts({
            config: globalConfig,
            authority: serverAuthority.publicKey,
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([serverAuthority])
          .rpc();

        throw new Error("Should have thrown an error for duplicate items");
      } catch (error: any) {
        const errorStr = error.message || error.toString();
        expectToContain(errorStr, "InvalidAmount", "Should contain InvalidAmount error");
      }
    });
  });

  describe("Authorization", () => {
    it("should reject unauthorized caller", async () => {
      const batchId = new BN(3);
      const batchHash = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000009",
        "hex"
      );

      const unauthorized = Keypair.generate();

      // Airdrop SOL to unauthorized key
      const airdropSig = await provider.connection.requestAirdrop(
        unauthorized.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      const wallet1 = Keypair.generate().publicKey;
      const wallet2 = Keypair.generate().publicKey;

      const items: any[] = [];
      const cashDeltas = [
        {
          owner: wallet1,
          deltaLamports: new BN(1000),
        },
        {
          owner: wallet2,
          deltaLamports: new BN(-1000),
        },
      ];

      try {
        await program.methods
          .settleNetBatch(
            batchId,
            Array.from(batchHash),
            items,
            cashDeltas
          )
          .accounts({
            config: globalConfig,
            authority: unauthorized.publicKey, // Wrong authority!
            clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          })
          .signers([unauthorized])
          .rpc();

        throw new Error("Should have thrown an error for unauthorized caller");
      } catch (error: any) {
        const errorStr = error.message || error.toString();
        expectToContain(errorStr, "Unauthorized", "Should contain Unauthorized error");
      }
    });
  });
});
