/**
 * Serverless Redis Adapter
 * Supports Upstash Redis (serverless) and ElastiCache Serverless
 */

import { logger } from "../shared/logger";

let redisClient: any = undefined;
let redisConnected = false;

const REDIS_TYPE = process.env.REDIS_TYPE || "upstash"; // "upstash" | "elasticache" | "memory"

/**
 * Initialize Upstash Redis (serverless)
 */
async function initUpstash(): Promise<boolean> {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!upstashUrl || !upstashToken) {
    logger.warn("[Redis Serverless] Upstash credentials not set");
    return false;
  }

  try {
    // Upstash uses REST API (no persistent connection needed)
    redisClient = {
      url: upstashUrl,
      token: upstashToken,
      type: "upstash",
    };
    
    // Test connection
    const response = await fetch(`${upstashUrl}/ping`, {
      headers: {
        Authorization: `Bearer ${upstashToken}`,
      },
    });
    
    if (response.ok) {
      redisConnected = true;
      logger.info("[Redis Serverless] Connected to Upstash Redis");
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error("[Redis Serverless] Failed to connect to Upstash", { error });
    return false;
  }
}

/**
 * Initialize ElastiCache Serverless
 */
async function initElastiCache(): Promise<boolean> {
  try {
    // ElastiCache Serverless uses AWS SDK
    const { ElastiCacheClient } = await import("@aws-sdk/client-elasticache");
    const client = new ElastiCacheClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    
    redisClient = {
      client,
      type: "elasticache",
    };
    
    logger.info("[Redis Serverless] ElastiCache client initialized");
    return true;
  } catch (error) {
    logger.error("[Redis Serverless] Failed to initialize ElastiCache", { error });
    return false;
  }
}

/**
 * In-memory Redis (for local dev/testing)
 */
function initMemory(): boolean {
  const memoryStore: Map<string, { value: any; expires?: number }> = new Map();
  
  redisClient = {
    type: "memory",
    store: memoryStore,
    get: async (key: string) => {
      const item = memoryStore.get(key);
      if (!item) return null;
      if (item.expires && item.expires < Date.now()) {
        memoryStore.delete(key);
        return null;
      }
      return item.value;
    },
    set: async (key: string, value: any, options?: { EX?: number }) => {
      const expires = options?.EX ? Date.now() + options.EX * 1000 : undefined;
      memoryStore.set(key, { value, expires });
    },
    del: async (key: string) => {
      memoryStore.delete(key);
    },
  };
  
  redisConnected = true;
  logger.info("[Redis Serverless] Using in-memory Redis (dev mode)");
  return true;
}

/**
 * Initialize Redis based on REDIS_TYPE
 */
export async function initRedis(): Promise<boolean> {
  if (REDIS_TYPE === "elasticache") {
    return await initElastiCache();
  } else if (REDIS_TYPE === "upstash") {
    return await initUpstash();
  } else {
    return initMemory();
  }
}

export function isRedisConnected(): boolean {
  return redisConnected;
}

/**
 * Get Redis client
 */
export function getRedisClient() {
  return redisClient;
}

/**
 * Redis operations (compatible with standard Redis client)
 */
export async function redisGet(key: string): Promise<string | null> {
  if (!redisClient) return null;
  
  if (redisClient.type === "upstash") {
    const response = await fetch(`${redisClient.url}/get/${encodeURIComponent(key)}`, {
      headers: {
        Authorization: `Bearer ${redisClient.token}`,
      },
    });
    const data = await response.json();
    return data.result || null;
  }
  
  if (redisClient.type === "memory") {
    return await redisClient.get(key);
  }
  
  return null;
}

export async function redisSet(key: string, value: string, options?: { EX?: number }): Promise<void> {
  if (!redisClient) return;
  
  if (redisClient.type === "upstash") {
    const exParam = options?.EX ? `?EX=${options.EX}` : "";
    await fetch(`${redisClient.url}/set/${encodeURIComponent(key)}${exParam}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisClient.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });
  }
  
  if (redisClient.type === "memory") {
    await redisClient.set(key, value, options);
  }
}

export async function redisDel(key: string): Promise<void> {
  if (!redisClient) return;
  
  if (redisClient.type === "upstash") {
    await fetch(`${redisClient.url}/del/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisClient.token}`,
      },
    });
  }
  
  if (redisClient.type === "memory") {
    await redisClient.del(key);
  }
}

