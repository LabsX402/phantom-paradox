/**
 * API Authentication & Rate Limiting Middleware
 * 
 * Provides:
 * - API key authentication (per-game)
 * - Rate limiting (per IP, per API key)
 * - Request logging for abuse detection
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../../shared/logger";
import { redisClient, isRedisConnected } from "../../shared/redis";
import { ExtendedRequest } from "./types";

// API key validation (in production, store in DB/Redis)
const VALID_API_KEYS = new Set<string>(
  (process.env.API_KEYS || "").split(",").filter(Boolean)
);

// Rate limit config
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS_PER_IP = 100;
const RATE_LIMIT_MAX_REQUESTS_PER_KEY = 1000;

/**
 * Extract API key from request
 */
function getApiKey(req: Request): string | null {
  // Check header first
  const headerKey = req.headers["x-api-key"] as string;
  if (headerKey) return headerKey;

  // Check query param (less secure, but convenient for testing)
  const queryKey = req.query.apiKey as string;
  if (queryKey) return queryKey;

  return null;
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
    (req.headers["x-real-ip"] as string) ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

/**
 * Rate limiting check
 */
async function checkRateLimit(
  identifier: string,
  maxRequests: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (!redisClient || !isRedisConnected()) {
    // Fail open if Redis is not available
    return { allowed: true, remaining: maxRequests, resetAt: Date.now() + RATE_LIMIT_WINDOW_MS };
  }

  const key = `rate_limit:${identifier}`;
  const now = Date.now();

  try {
    const count = await redisClient.incr(key);
    if (count === 1) {
      // First request in window, set expiry
      await redisClient.expire(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    }

    const ttl = await redisClient.ttl(key);
    const resetAt = now + (ttl * 1000);

    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetAt,
    };
  } catch (error) {
    logger.error("Rate limit check failed", { error, identifier });
    // Fail open (allow request) if Redis is down
    return { allowed: true, remaining: maxRequests, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }
}

/**
 * API key authentication middleware
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = getApiKey(req);

  if (!apiKey) {
    res.status(401).json({
      error: "unauthorized",
      message: "API key required. Provide X-API-Key header or apiKey query param.",
    });
    return;
  }

  // In production, validate against database
  // For now, check against env var
  if (!VALID_API_KEYS.has(apiKey) && process.env.NODE_ENV === "production") {
    res.status(401).json({
      error: "unauthorized",
      message: "Invalid API key",
    });
    return;
  }

  // Attach API key to request for downstream use
  (req as ExtendedRequest).apiKey = apiKey;
  next();
}

/**
 * Rate limiting middleware
 */
export async function rateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Check if rate limiting is enabled
  const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== "false";
  
  // If rate limiting is disabled or Redis is not connected, skip rate limiting
  if (!rateLimitEnabled || !isRedisConnected() || !redisClient) {
    next();
    return;
  }

  const ip = getClientIp(req);
  const apiKey = getApiKey(req);

  // Check IP rate limit
  const ipLimit = await checkRateLimit(`ip:${ip}`, RATE_LIMIT_MAX_REQUESTS_PER_IP);
  if (!ipLimit.allowed) {
    res.status(429).json({
      error: "rate_limit_exceeded",
      message: "Too many requests from this IP",
      resetAt: ipLimit.resetAt,
    });
    return;
  }

  // Check API key rate limit (if provided)
  let keyLimit = { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS_PER_KEY, resetAt: Date.now() + RATE_LIMIT_WINDOW_MS };
  if (apiKey) {
    keyLimit = await checkRateLimit(
      `key:${apiKey}`,
      RATE_LIMIT_MAX_REQUESTS_PER_KEY
    );
    if (!keyLimit.allowed) {
      res.status(429).json({
        error: "rate_limit_exceeded",
        message: "Too many requests for this API key",
        resetAt: keyLimit.resetAt,
      });
      return;
    }
  }

  // Add rate limit headers
  res.setHeader("X-RateLimit-Remaining", apiKey ? keyLimit.remaining : ipLimit.remaining);
  res.setHeader("X-RateLimit-Reset", apiKey ? keyLimit.resetAt : ipLimit.resetAt);

  next();
}

/**
 * Request logging middleware (for abuse detection)
 */
export function logRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const ip = getClientIp(req);
  const apiKey = getApiKey(req);
  const startTime = Date.now();

  // Log request
  logger.info("API request", {
    method: req.method,
    path: req.path,
    ip,
    apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : null,
    userAgent: req.headers["user-agent"],
  });

  // Log response when finished
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    logger.info("API response", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip,
    });
  });

  next();
}

/**
 * Multi-tenant safety middleware - ensures gameId scoping
 */
export function requireGameId(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const gameId = req.params.gameId || req.body.gameId;

  if (!gameId) {
    res.status(400).json({
      error: "missing_game_id",
      message: "gameId is required",
    });
    return;
  }

  // Validate gameId is numeric
  if (isNaN(Number(gameId))) {
    res.status(400).json({
      error: "invalid_game_id",
      message: "gameId must be a number",
    });
    return;
  }

  // Attach to request for downstream use
  (req as ExtendedRequest).gameId = Number(gameId);
  next();
}

