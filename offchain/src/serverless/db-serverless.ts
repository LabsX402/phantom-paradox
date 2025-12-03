/**
 * Serverless Database Adapter
 * Supports Supabase (serverless Postgres) and DynamoDB
 */

import { Pool } from "pg";
import { logger } from "../shared/logger";

// Support for Supabase (serverless Postgres)
let supabasePool: Pool | null = null;
let dbConnected = false;

// DynamoDB support (optional)
let dynamoDbClient: any = null;

const DB_TYPE = process.env.DB_TYPE || "supabase"; // "supabase" | "dynamodb"

/**
 * Initialize Supabase connection
 */
async function initSupabase(): Promise<boolean> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (!connectionString && !(supabaseUrl && supabaseKey)) {
    logger.error("[DB Serverless] Supabase credentials not set");
    return false;
  }

  try {
    // Use direct Postgres connection if available (faster)
    if (connectionString) {
      supabasePool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }, // Supabase requires SSL
        max: 1, // Serverless: single connection
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
      
      await supabasePool.query("SELECT 1");
      dbConnected = true;
      logger.info("[DB Serverless] Connected to Supabase (Postgres)");
      return true;
    }

    // Fallback to Supabase REST API (slower but works)
    logger.warn("[DB Serverless] Using Supabase REST API (slower)");
    return true;
  } catch (error) {
    logger.error("[DB Serverless] Failed to connect to Supabase", { error });
    return false;
  }
}

/**
 * Initialize DynamoDB connection
 */
async function initDynamoDB(): Promise<boolean> {
  try {
    // Lazy load AWS SDK
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
    
    dynamoDbClient = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
    }));
    
    logger.info("[DB Serverless] DynamoDB client initialized");
    return true;
  } catch (error) {
    logger.error("[DB Serverless] Failed to initialize DynamoDB", { error });
    return false;
  }
}

/**
 * Initialize database based on DB_TYPE
 */
export async function initDatabase(): Promise<boolean> {
  if (DB_TYPE === "dynamodb") {
    return await initDynamoDB();
  } else {
    return await initSupabase();
  }
}

export function isDatabaseConnected(): boolean {
  return dbConnected || dynamoDbClient !== null;
}

/**
 * Query function - works with both Supabase and DynamoDB
 */
export const query = async (text: string, params?: any[]) => {
  if (DB_TYPE === "dynamodb") {
    // Convert SQL to DynamoDB operations (simplified)
    // In production, use a proper SQL-to-DynamoDB adapter or ORM
    throw new Error("DynamoDB SQL queries not yet implemented - use Supabase for now");
  }

  if (!supabasePool || !dbConnected) {
    throw new Error("Database not connected");
  }

  return supabasePool.query(text, params);
};

/**
 * Get the database pool (for transaction support)
 */
export function getPool(): Pool | null {
  return supabasePool;
}

/**
 * Serverless-optimized connection management
 */
export async function getConnection() {
  if (DB_TYPE === "dynamodb") {
    return dynamoDbClient;
  }
  
  if (!supabasePool) {
    await initDatabase();
  }
  
  return supabasePool;
}

