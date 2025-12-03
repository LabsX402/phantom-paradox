import dotenv from "dotenv";
dotenv.config();
import { createClient } from "redis";
import { logger } from "./logger";

const url = process.env.REDIS_URL;

// Only create client if URL is provided
export let redisClient: ReturnType<typeof createClient> | undefined = undefined;
export let redisConnected = false;

if (url && url.trim() !== "") {
  try {
    redisClient = createClient({ url });
  } catch (error) {
    logger.warn("[Redis] Failed to create client", { error });
  }
}

export async function initRedis(): Promise<boolean> {
  if (!redisClient) {
    if (process.env.NODE_ENV === "production") {
      logger.error("[Redis] REDIS_URL not set. Cannot start in production.");
      process.exit(1);
    } else {
      logger.warn("[Redis] REDIS_URL not set. Redis features disabled.");
      return false;
    }
  }

  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    redisConnected = true;
    logger.info("[Redis] Connected");
    return true;
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      logger.error("[Redis] Failed to connect", { error });
      process.exit(1);
    } else {
      logger.warn("[Redis] Failed to connect (dev mode, rate limiting disabled)", { error });
      redisConnected = false;
      return false;
    }
  }
}

export function isRedisConnected(): boolean {
  return redisConnected && redisClient?.isOpen === true;
}

