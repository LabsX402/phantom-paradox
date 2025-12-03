/**
 * ======================================================================
 * STATE ROOT INDEXER LISTENER (Standalone Service)
 * ======================================================================
 * 
 * Standalone service to run the state root indexer.
 * 
 * Usage: npm run indexer:state-root
 */

import dotenv from "dotenv";
dotenv.config();

import { initDatabase } from "../shared/db";
import { startStateRootIndexer } from "./stateRootIndexer";
import { logger } from "../shared/logger";

(async () => {
  try {
    logger.info("[INDEXER] Initializing database...");
    await initDatabase();
    
    logger.info("[INDEXER] Starting state root indexer...");
    await startStateRootIndexer();
    
    logger.info("[INDEXER] State root indexer running. Listening for StateRootSettled events...");
    
    // Keep process alive
    process.on("SIGINT", () => {
      logger.info("[INDEXER] Shutting down...");
      process.exit(0);
    });
    
    process.on("SIGTERM", () => {
      logger.info("[INDEXER] Shutting down...");
      process.exit(0);
    });
  } catch (error) {
    logger.error("[INDEXER] Failed to start state root indexer", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
})();

