import dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";
import { logger } from "./logger";

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;

let pool: Pool | null = null;
let dbConnected = false;

export async function initDatabase(): Promise<boolean> {
  if (!connectionString) {
    logger.error("[DB] DATABASE_URL not set. Cannot start.");
    process.exit(1);
  }

  try {
    pool = new Pool({
      connectionString,
    });
    
    // Test connection
    await pool.query("SELECT 1");
    dbConnected = true;
    logger.info("[DB] Connected to Postgres");
    return true;
  } catch (error) {
    logger.error("[DB] Failed to connect to Postgres", { error });
    process.exit(1);
  }
}

export function isDatabaseConnected(): boolean {
  return dbConnected;
}

export const query = async (text: string, params?: any[]) => {
  if (!pool || !dbConnected) {
    throw new Error("Database not connected");
  }
  return pool.query(text, params);
};

/**
 * Get the database pool (for transaction support)
 */
export function getPool(): Pool | null {
  return pool;
}

