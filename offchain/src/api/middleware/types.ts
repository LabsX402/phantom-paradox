/**
 * Extended Express Request types for middleware
 */
import { Request } from "express";

export interface ExtendedRequest extends Request {
  apiKey?: string;
  gameId?: number;
}

