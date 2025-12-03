/**
 * Indexer Service - Main entry point for running the indexer
 * 
 * This service can be run as a standalone process or integrated into the main API server.
 */

import dotenv from "dotenv";
dotenv.config();

import { Connection, clusterApiUrl } from "@solana/web3.js";
import { Indexer } from "./indexer";
import { initializeIndexer, startIndexer } from "./integration";
import { logger } from "../shared/logger";

const RPC_URL = process.env.SOLANA_RPC_URL || process.env.RPC_URL || clusterApiUrl("devnet");

async function main() {
  logger.info("Starting PhantomGrid Indexer Service...");

  try {
    // Initialize connection
    const connection = new Connection(RPC_URL, "confirmed");
    logger.info(`Connected to Solana: ${RPC_URL}`);

    // Initialize indexer
    await initializeIndexer(connection);
    logger.info("Indexer initialized");

    // Start indexing
    await startIndexer();
    logger.info("Indexer started and listening for events");

    // Keep process alive
    process.on("SIGINT", () => {
      logger.info("Shutting down indexer...");
      const indexer = require("./integration").getIndexer();
      if (indexer) {
        indexer.stop();
      }
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      logger.info("Shutting down indexer...");
      const indexer = require("./integration").getIndexer();
      if (indexer) {
        indexer.stop();
      }
      process.exit(0);
    });
  } catch (error) {
    logger.error("Fatal error in indexer service", { error });
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    logger.error("Unhandled error", { error });
    process.exit(1);
  });
}

export { main as runIndexerService };

