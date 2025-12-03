/**
 * Input Validation Middleware
 * 
 * Provides request validation for API routes
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../../shared/logger";
import { PublicKey } from "@solana/web3.js";

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "array" | "object" | "bigint";
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: any) => boolean | string; // Return true if valid, or error message string
  location?: "body" | "query" | "params"; // Where to look for the field
}

/**
 * Validate request based on rules
 */
export function validate(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];
    
    for (const rule of rules) {
      const location = rule.location || "body";
      const source = location === "body" ? req.body : location === "query" ? req.query : req.params;
      const value = source[rule.field];
      
      // Check required
      if (rule.required && (value === undefined || value === null || value === "")) {
        errors.push(`${rule.field} is required`);
        continue;
      }
      
      // Skip validation if optional and not provided
      if (!rule.required && (value === undefined || value === null || value === "")) {
        continue;
      }
      
      // Check type
      if (rule.type) {
        let actualType: string;
        if (Array.isArray(value)) {
          actualType = "array";
        } else if (typeof value === "bigint" || (typeof value === "string" && /^\d+n$/.test(value))) {
          actualType = "bigint";
        } else {
          actualType = typeof value;
        }
        
        if (actualType !== rule.type) {
          // Try to coerce if it's a number string
          if (rule.type === "number" && typeof value === "string" && !isNaN(Number(value))) {
            source[rule.field] = Number(value);
            continue;
          }
          errors.push(`${rule.field} must be of type ${rule.type}, got ${actualType}`);
          continue;
        }
      }
      
      // Check min/max for numbers
      if (rule.type === "number" && typeof value === "number") {
        if (rule.min !== undefined && value < rule.min) {
          errors.push(`${rule.field} must be at least ${rule.min}`);
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push(`${rule.field} must be at most ${rule.max}`);
        }
      }
      
      // Check string length
      if (rule.type === "string" && typeof value === "string") {
        if (rule.min !== undefined && value.length < rule.min) {
          errors.push(`${rule.field} must be at least ${rule.min} characters`);
        }
        if (rule.max !== undefined && value.length > rule.max) {
          errors.push(`${rule.field} must be at most ${rule.max} characters`);
        }
        
        // Check pattern
        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push(`${rule.field} format is invalid`);
        }
      }
      
      // Custom validation
      if (rule.custom) {
        const result = rule.custom(value);
        if (result !== true) {
          errors.push(result || `${rule.field} validation failed`);
        }
      }
    }
    
    if (errors.length > 0) {
      logger.warn("Validation failed", {
        path: req.path,
        errors,
        body: req.body,
      });
      
      res.status(400).json({
        error: "validation_failed",
        message: "Input validation failed",
        errors,
      });
      return;
    }
    
    next();
  };
}

/**
 * Sanitize string input (remove dangerous characters)
 */
export function sanitizeString(value: string): string {
  if (typeof value !== "string") {
    return value;
  }
  return value.trim().replace(/[<>]/g, "");
}

/**
 * Validate Solana public key
 */
export function validatePubkey(pubkey: string): boolean | string {
  try {
    new PublicKey(pubkey);
    return true;
  } catch {
    return `${pubkey} is not a valid Solana public key`;
  }
}

/**
 * Validate numeric string (for bigint inputs)
 */
export function validateNumericString(value: string): boolean | string {
  if (typeof value !== "string") {
    return "must be a string";
  }
  if (!/^\d+$/.test(value)) {
    return "must be a numeric string";
  }
  return true;
}

/**
 * Common validation rules
 */
export const commonRules = {
  pubkey: (field: string, required = true): ValidationRule => ({
    field,
    required,
    type: "string",
    custom: (value) => validatePubkey(value),
  }),
  
  numericString: (field: string, required = true): ValidationRule => ({
    field,
    required,
    type: "string",
    custom: (value) => validateNumericString(value),
  }),
  
  number: (field: string, min?: number, max?: number, required = true): ValidationRule => ({
    field,
    required,
    type: "number",
    min,
    max,
  }),
  
  string: (field: string, minLength?: number, maxLength?: number, required = true): ValidationRule => ({
    field,
    required,
    type: "string",
    min: minLength,
    max: maxLength,
  }),
};

