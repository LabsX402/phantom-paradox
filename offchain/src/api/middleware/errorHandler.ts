/**
 * Error Handler Middleware
 * 
 * Centralized error handling and sanitization
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../../shared/logger";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Main error handler middleware
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log full error server-side
  logger.error("API Error", {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params,
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });
  
  // Determine if production mode
  const isProduction = process.env.NODE_ENV === "production";
  
  // Handle AppError (known errors)
  if (err instanceof AppError) {
    const response: any = {
      error: err.errorCode,
      message: err.message,
    };
    
    // Include details in non-production or if explicitly provided
    if (!isProduction || err.details) {
      response.details = err.details;
    }
    
    res.status(err.statusCode).json(response);
    return;
  }
  
  // Handle known error types
  let statusCode = 500;
  let message = "Internal server error";
  let errorCode = "internal_error";
  
  // Database errors
  if (err.message.includes("duplicate key") || err.message.includes("unique constraint")) {
    statusCode = 409;
    message = "Resource already exists";
    errorCode = "conflict";
  } else if (err.message.includes("not found") || err.message.includes("does not exist")) {
    statusCode = 404;
    message = "Resource not found";
    errorCode = "not_found";
  } else if (err.message.includes("insufficient") || err.message.includes("balance")) {
    statusCode = 400;
    message = "Insufficient funds";
    errorCode = "insufficient_funds";
  } else if (err.message.includes("unauthorized") || err.message.includes("permission")) {
    statusCode = 403;
    message = "Unauthorized";
    errorCode = "unauthorized";
  } else if (err.message.includes("validation") || err.message.includes("invalid")) {
    statusCode = 400;
    message = "Invalid input";
    errorCode = "validation_error";
  } else if (err.message.includes("timeout")) {
    statusCode = 504;
    message = "Request timeout";
    errorCode = "timeout";
  }
  
  // Build response
  const response: any = {
    error: errorCode,
    message,
  };
  
  // In development, include more details (but still sanitized)
  if (!isProduction) {
    response.details = err.message;
    // Only include first few lines of stack trace
    if (err.stack) {
      response.stack = err.stack.split("\n").slice(0, 5).map((line: string) => 
        line.trim()
      );
    }
  }
  
  res.status(statusCode).json(response);
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  res.status(404).json({
    error: "not_found",
    message: "Endpoint not found",
    path: req.path,
  });
}

/**
 * Async error wrapper (for route handlers)
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

