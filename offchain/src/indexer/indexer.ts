/**
 * Indexer Service - Reconstructs game state from on-chain events
 * 
 * This is the "Black Box" that makes compressed/netted state readable.
 * 
 * Responsibilities:
 * - Subscribe to program events (NetBatchSettled, NetWindowSubmitted, etc.)
 * - Reconstruct current inventory/market views from batch settlements
 * - Store state in Postgres for fast API queries
 * - Never expose internal netting logic - only final outcomes
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { Program, EventParser } from "@coral-xyz/anchor";
import { query } from "../shared/db";
import { logger } from "../shared/logger";
import { getProgram } from "../shared/solana";
import { BN } from "@coral-xyz/anchor";

interface NetBatchSettledEvent {
  batchId: BN;
  numItems: number;
  numWallets: number;
  batchHash: number[];
  settledAt: BN;
}

interface NetWindowSubmittedEvent {
  windowId: BN;
  engine: PublicKey;
  root: number[];
  tradeCount: BN;
  volumeLamports: BN;
  submittedAt: BN;
}

export class Indexer {
  private connection: Connection;
  private program: Program | null = null;
  private isRunning = false;
  private lastProcessedSlot: number | null = null;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Initialize the indexer - sets up database tables if needed
   * 
   * @param fromSlot - Optional slot to start from (for resync). If not provided, resumes from last processed slot.
   */
  async initialize(fromSlot?: number): Promise<void> {
    logger.info("Initializing indexer...", { fromSlot });

    // Create tables if they don't exist
    await this.createTables();

    if (fromSlot !== undefined) {
      // Resync mode - start from specified slot
      this.lastProcessedSlot = fromSlot;
      logger.info(`Resync mode: starting from slot ${fromSlot}`);
      
      // Update or insert state
      await query(
        `INSERT INTO indexer_state (last_processed_slot, updated_at) 
         VALUES ($1, NOW())
         ON CONFLICT (id) DO UPDATE SET last_processed_slot = $1, updated_at = NOW()`,
        [fromSlot]
      );
    } else {
      // Normal mode - resume from last processed slot
      const result = await query(
        `SELECT last_processed_slot FROM indexer_state LIMIT 1`
      ).catch(() => ({ rows: [] }));

      if (result.rows.length > 0) {
        this.lastProcessedSlot = result.rows[0].last_processed_slot;
        logger.info(`Resuming from slot: ${this.lastProcessedSlot}`);
      } else {
        // Initialize state - start from program deploy slot or 0
        const deploySlot = parseInt(process.env.PROGRAM_DEPLOY_SLOT || "0");
        await query(
          `INSERT INTO indexer_state (last_processed_slot, updated_at) VALUES ($1, NOW())`,
          [deploySlot]
        );
        this.lastProcessedSlot = deploySlot;
        logger.info(`Initializing from slot: ${deploySlot}`);
      }
    }

    // Load program
    this.program = getProgram(this.connection);
  }

  /**
   * Create database tables for indexing
   */
  private async createTables(): Promise<void> {
    // Indexer state tracking
    await query(`
      CREATE TABLE IF NOT EXISTS indexer_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        last_processed_slot BIGINT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT single_row CHECK (id = 1)
      )
    `).catch(() => {}); // Ignore if exists

    // Batches table - stores batch settlement summaries
    await query(`
      CREATE TABLE IF NOT EXISTS batches (
        batch_id BIGINT PRIMARY KEY,
        batch_hash BYTEA NOT NULL,
        num_items INTEGER NOT NULL,
        num_wallets INTEGER NOT NULL,
        settled_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    // Item ownership - tracks current ownership (rebuilt from batches)
    await query(`
      CREATE TABLE IF NOT EXISTS item_ownership (
        item_id BIGINT NOT NULL,
        game_id BIGINT NOT NULL,
        owner_wallet TEXT NOT NULL,
        batch_id BIGINT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (item_id, game_id)
      )
    `).catch(() => {});

    // Wallet balances - tracks net cash deltas (rebuilt from batches)
    await query(`
      CREATE TABLE IF NOT EXISTS wallet_balances (
        wallet TEXT NOT NULL,
        game_id BIGINT NOT NULL,
        balance_lamports BIGINT NOT NULL DEFAULT 0,
        last_batch_id BIGINT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (wallet, game_id)
      )
    `).catch(() => {});

    // Item history - tracks ownership changes for audit
    await query(`
      CREATE TABLE IF NOT EXISTS item_history (
        id SERIAL PRIMARY KEY,
        item_id BIGINT NOT NULL,
        game_id BIGINT NOT NULL,
        from_wallet TEXT,
        to_wallet TEXT NOT NULL,
        batch_id BIGINT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    logger.info("Indexer tables created/verified");
  }

  /**
   * Start indexing - subscribes to program events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Indexer already running");
      return;
    }

    if (!this.program) {
      throw new Error("Indexer not initialized. Call initialize() first.");
    }

    this.isRunning = true;
    logger.info("Starting indexer...");

    // Subscribe to program events
    const eventParser = new EventParser(
      this.program.programId,
      this.program.coder
    );

    // Listen for new slots and process events
    this.connection.onSlotChange(async (slotInfo) => {
      if (!this.isRunning) return;

      try {
        await this.processSlot(slotInfo.slot);
      } catch (error) {
        logger.error("Error processing slot", { error, slot: slotInfo.slot });
      }
    });

    // Also listen directly to program logs
    this.connection.onLogs(
      this.program.programId,
      async (logs, context) => {
        if (!this.isRunning) return;

        try {
          const events = eventParser.parseLogs(logs.logs);
          for (const event of events) {
            await this.handleEvent(event.name, event.data);
          }
        } catch (error) {
          logger.error("Error parsing logs", { error, slot: context.slot });
        }
      },
      "confirmed"
    );

    logger.info("Indexer started and listening for events");
  }

  /**
   * Process a slot - fetch and index transactions
   */
  private async processSlot(slot: number): Promise<void> {
    if (this.lastProcessedSlot !== null && slot <= this.lastProcessedSlot) {
      return; // Already processed
    }

    try {
      // Fetch signatures for this slot
      const signatures = await this.connection.getSignaturesForAddress(
        this.program!.programId,
        {
          limit: 1000,
          before: this.lastProcessedSlot ? undefined : undefined,
        }
      );

      // Process each transaction
      for (const sigInfo of signatures) {
        if (this.lastProcessedSlot && sigInfo.slot <= this.lastProcessedSlot) {
          continue;
        }

        try {
          const tx = await this.connection.getTransaction(sigInfo.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });

          if (tx && tx.meta && tx.meta.logMessages) {
            const eventParser = new EventParser(
              this.program!.programId,
              this.program!.coder
            );
            const events = eventParser.parseLogs(tx.meta.logMessages);

            for (const event of events) {
              await this.handleEvent(event.name, event.data);
            }
          }
        } catch (error) {
          logger.error("Error processing transaction", {
            error,
            signature: sigInfo.signature,
          });
        }
      }

      // Update last processed slot
      this.lastProcessedSlot = slot;
      await query(
        `UPDATE indexer_state SET last_processed_slot = $1, updated_at = NOW()`,
        [slot]
      );
    } catch (error) {
      logger.error("Error processing slot", { error, slot });
    }
  }

  /**
   * Handle a program event
   */
  private async handleEvent(eventName: string, data: any): Promise<void> {
    logger.debug("Handling event", { eventName, data });

    switch (eventName) {
      case "NetBatchSettled":
        await this.handleNetBatchSettled(data as NetBatchSettledEvent);
        break;
      case "NetWindowSubmitted":
        await this.handleNetWindowSubmitted(data as NetWindowSubmittedEvent);
        break;
      // Add other events as needed
      default:
        logger.debug("Unhandled event", { eventName });
    }
  }

  /**
   * Handle NetBatchSettled event - update item ownership and wallet balances
   */
  private async handleNetBatchSettled(event: NetBatchSettledEvent): Promise<void> {
    const batchId = event.batchId.toNumber();
    const batchHash = Buffer.from(event.batchHash);
    const numItems = event.numItems;
    const numWallets = event.numWallets;
    const settledAt = new Date(event.settledAt.toNumber() * 1000);

    logger.info("Processing NetBatchSettled", {
      batchId,
      numItems,
      numWallets,
    });

    // Store batch summary
    await query(
      `INSERT INTO batches (batch_id, batch_hash, num_items, num_wallets, settled_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (batch_id) DO NOTHING`,
      [batchId, batchHash, numItems, numWallets, settledAt]
    );

    // NOTE: The actual item ownership and cash deltas are not in the event
    // (by design - we only emit summaries). The off-chain engine must store
    // the full batch details in a separate table that the indexer can query.
    // For now, we'll need to query the off-chain batch storage.

    logger.info("Batch indexed", { batchId });
  }

  /**
   * Handle NetWindowSubmitted event - store window metadata
   */
  private async handleNetWindowSubmitted(
    event: NetWindowSubmittedEvent
  ): Promise<void> {
    const windowId = event.windowId.toNumber();
    const root = Buffer.from(event.root);
    const tradeCount = event.tradeCount.toNumber();
    const volumeLamports = event.volumeLamports.toNumber();
    const submittedAt = new Date(event.submittedAt.toNumber() * 1000);

    logger.info("Processing NetWindowSubmitted", {
      windowId,
      tradeCount,
      volumeLamports,
    });

    // Store window metadata (for audit/debugging)
    await query(
      `INSERT INTO net_windows (window_id, engine, root, trade_count, volume_lamports, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (window_id) DO NOTHING`,
      [
        windowId,
        event.engine.toBase58(),
        root,
        tradeCount,
        volumeLamports,
        submittedAt,
      ]
    ).catch(async () => {
      // Create table if it doesn't exist
      await query(`
        CREATE TABLE IF NOT EXISTS net_windows (
          window_id BIGINT PRIMARY KEY,
          engine TEXT NOT NULL,
          root BYTEA NOT NULL,
          trade_count BIGINT NOT NULL,
          volume_lamports BIGINT NOT NULL,
          submitted_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      // Retry insert
      await query(
        `INSERT INTO net_windows (window_id, engine, root, trade_count, volume_lamports, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          windowId,
          event.engine.toBase58(),
          root,
          tradeCount,
          volumeLamports,
          submittedAt,
        ]
      );
    });
  }

  /**
   * Update item ownership from a batch (called by off-chain engine after settlement)
   */
  async updateItemOwnership(
    batchId: number,
    items: Array<{ itemId: number; gameId: number; owner: string }>
  ): Promise<void> {
    for (const item of items) {
      // Get previous owner for history
      const prevOwner = await query(
        `SELECT owner_wallet FROM item_ownership WHERE item_id = $1 AND game_id = $2`,
        [item.itemId, item.gameId]
      ).then((r) => r.rows[0]?.owner_wallet || null);

      // Update ownership
      await query(
        `INSERT INTO item_ownership (item_id, game_id, owner_wallet, batch_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id, game_id) 
         DO UPDATE SET owner_wallet = $3, batch_id = $4, updated_at = NOW()`,
        [item.itemId, item.gameId, item.owner, batchId]
      );

      // Record history
      await query(
        `INSERT INTO item_history (item_id, game_id, from_wallet, to_wallet, batch_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.itemId, item.gameId, prevOwner, item.owner, batchId]
      );
    }
  }

  /**
   * Update wallet balances from a batch (called by off-chain engine after settlement)
   */
  async updateWalletBalances(
    batchId: number,
    gameId: number,
    deltas: Array<{ wallet: string; deltaLamports: number }>
  ): Promise<void> {
    for (const delta of deltas) {
      await query(
        `INSERT INTO wallet_balances (wallet, game_id, balance_lamports, last_batch_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wallet, game_id)
         DO UPDATE SET 
           balance_lamports = wallet_balances.balance_lamports + $3,
           last_batch_id = $4,
           updated_at = NOW()`,
        [delta.wallet, gameId, delta.deltaLamports, batchId]
      );
    }
  }

  /**
   * Stop the indexer
   */
  stop(): void {
    this.isRunning = false;
    logger.info("Indexer stopped");
  }
}

