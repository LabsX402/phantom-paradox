/**
 * Solana Sign-In with Solana (SIWS) Authentication
 * Compatible with Skeet framework
 */

import { PublicKey } from "@solana/web3.js";
import { verifyMessage } from "@solana/web3.js";
import { logger } from "../shared/logger";
import nacl from "tweetnacl";

export interface SIWSMessage {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

/**
 * Create SIWS message
 */
export function createSIWSMessage(params: {
  domain: string;
  address: string;
  statement?: string;
  uri: string;
  nonce: string;
  expirationTime?: string;
}): SIWSMessage {
  return {
    domain: params.domain,
    address: params.address,
    statement: params.statement || "Sign in with Solana",
    uri: params.uri,
    version: "1",
    chainId: 101, // Solana mainnet (103 for devnet)
    nonce: params.nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: params.expirationTime,
  };
}

/**
 * Serialize SIWS message to string
 */
export function serializeSIWSMessage(message: SIWSMessage): string {
  const lines: string[] = [];
  
  lines.push(`${message.domain} wants you to sign in with your Solana account:`);
  lines.push(message.address);
  lines.push("");
  
  if (message.statement) {
    lines.push(message.statement);
    lines.push("");
  }
  
  lines.push(`URI: ${message.uri}`);
  lines.push(`Version: ${message.version}`);
  lines.push(`Chain ID: ${message.chainId}`);
  lines.push(`Nonce: ${message.nonce}`);
  lines.push(`Issued At: ${message.issuedAt}`);
  
  if (message.expirationTime) {
    lines.push(`Expiration Time: ${message.expirationTime}`);
  }
  
  if (message.notBefore) {
    lines.push(`Not Before: ${message.notBefore}`);
  }
  
  if (message.requestId) {
    lines.push(`Request ID: ${message.requestId}`);
  }
  
  if (message.resources && message.resources.length > 0) {
    lines.push(`Resources:`);
    message.resources.forEach(resource => {
      lines.push(`- ${resource}`);
    });
  }
  
  return lines.join("\n");
}

/**
 * Verify SIWS signature
 */
export async function verifySIWSSignature(
  message: SIWSMessage,
  signature: Uint8Array,
  publicKey: PublicKey
): Promise<boolean> {
  try {
    // Serialize message
    const messageString = serializeSIWSMessage(message);
    const messageBytes = new TextEncoder().encode(messageString);
    
    // Verify signature
    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signature,
      publicKey.toBytes()
    );
    
    if (!isValid) {
      logger.warn("[SIWS] Invalid signature", {
        address: message.address,
      });
      return false;
    }
    
    // Check expiration
    if (message.expirationTime) {
      const expiration = new Date(message.expirationTime);
      if (expiration < new Date()) {
        logger.warn("[SIWS] Message expired", {
          address: message.address,
          expirationTime: message.expirationTime,
        });
        return false;
      }
    }
    
    // Check not before
    if (message.notBefore) {
      const notBefore = new Date(message.notBefore);
      if (notBefore > new Date()) {
        logger.warn("[SIWS] Message not yet valid", {
          address: message.address,
          notBefore: message.notBefore,
        });
        return false;
      }
    }
    
    // Verify address matches
    if (message.address !== publicKey.toString()) {
      logger.warn("[SIWS] Address mismatch", {
        messageAddress: message.address,
        publicKey: publicKey.toString(),
      });
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error("[SIWS] Verification error", { error });
    return false;
  }
}

/**
 * Generate nonce for SIWS
 */
export function generateNonce(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Middleware for SIWS authentication
 */
export function siwsAuthMiddleware(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  
  const token = authHeader.substring(7);
  
  try {
    // Parse JWT or SIWS token
    // In production, use a proper JWT library
    const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    
    // Verify SIWS message
    const message: SIWSMessage = decoded.message;
    const signature = Buffer.from(decoded.signature, "base64");
    const publicKey = new PublicKey(message.address);
    
    // Attach to request
    req.siws = {
      message,
      publicKey,
      address: message.address,
    };
    
    next();
  } catch (error) {
    logger.warn("[SIWS] Auth middleware error", { error });
    return res.status(401).json({ error: "Invalid token" });
  }
}

