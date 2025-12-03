/**
 * Monitoring & Observability
 * Sentry for errors, Prometheus for metrics
 */

import { logger } from "../shared/logger";

// Sentry integration (optional)
let sentryInitialized = false;

export async function initSentry() {
  const sentryDsn = process.env.SENTRY_DSN;
  if (!sentryDsn) {
    logger.warn("[Monitoring] Sentry DSN not set, skipping initialization");
    return;
  }

  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV || "production",
      tracesSampleRate: 0.1, // 10% of transactions
    });
    sentryInitialized = true;
    logger.info("[Monitoring] Sentry initialized");
  } catch (error) {
    logger.warn("[Monitoring] Failed to initialize Sentry", { error });
  }
}

export function captureException(error: Error, context?: any) {
  if (sentryInitialized) {
    try {
      const Sentry = require("@sentry/node");
      Sentry.captureException(error, { extra: context });
    } catch (e) {
      logger.warn("[Monitoring] Failed to capture exception in Sentry", { error: e });
    }
  }
  logger.error("[Monitoring] Exception captured", { error, context });
}

// Prometheus metrics (simple implementation)
const metrics: Map<string, number> = new Map();

export function incrementMetric(name: string, value: number = 1) {
  const current = metrics.get(name) || 0;
  metrics.set(name, current + value);
}

export function setMetric(name: string, value: number) {
  metrics.set(name, value);
}

export function getMetric(name: string): number {
  return metrics.get(name) || 0;
}

export function getMetrics(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of metrics.entries()) {
    result[key] = value;
  }
  return result;
}

export function resetMetrics() {
  metrics.clear();
}

// Performance monitoring
export function trackPerformance(name: string, fn: () => Promise<any>): Promise<any> {
  const start = Date.now();
  return fn()
    .then(result => {
      const duration = Date.now() - start;
      incrementMetric(`${name}_duration_ms`, duration);
      incrementMetric(`${name}_count`, 1);
      return result;
    })
    .catch(error => {
      incrementMetric(`${name}_errors`, 1);
      captureException(error instanceof Error ? error : new Error(String(error)), { name });
      throw error;
    });
}

// Production alerts configuration
export interface AlertConfig {
  name: string;
  threshold: number;
  severity: "critical" | "warning" | "info";
  condition: (value: number) => boolean;
}

export const PRODUCTION_ALERTS: AlertConfig[] = [
  {
    name: "ColdStartTooLong",
    threshold: 2000, // 2 seconds
    severity: "critical",
    condition: (value) => value > 2000,
  },
  {
    name: "NettingSlow",
    threshold: 5000, // 5ms per intent * 1000 intents
    severity: "warning",
    condition: (value) => value > 5000,
  },
  {
    name: "FailoverTriggered",
    threshold: 1,
    severity: "warning",
    condition: (value) => value >= 1,
  },
  {
    name: "IPFSGatewayFail",
    threshold: 3,
    severity: "critical",
    condition: (value) => value >= 3,
  },
  {
    name: "HighErrorRate",
    threshold: 0.05, // 5%
    severity: "warning",
    condition: (value) => value > 0.05,
  },
  {
    name: "DatabaseConnectionFail",
    threshold: 1,
    severity: "critical",
    condition: (value) => value >= 1,
  },
];

/**
 * Check and trigger alerts
 */
export function checkAlerts(): Array<{ alert: AlertConfig; value: number; triggered: boolean }> {
  const results: Array<{ alert: AlertConfig; value: number; triggered: boolean }> = [];
  
  for (const alert of PRODUCTION_ALERTS) {
    let value = 0;
    
    // Get metric value based on alert name
    switch (alert.name) {
      case "ColdStartTooLong":
        value = getMetric("cold_start_duration_ms");
        break;
      case "NettingSlow":
        value = getMetric("netting_duration_ms");
        break;
      case "FailoverTriggered":
        value = getMetric("failover_count");
        break;
      case "IPFSGatewayFail":
        value = getMetric("ipfs_gateway_failures");
        break;
      case "HighErrorRate":
        const errors = getMetric("api_errors");
        const total = getMetric("api_count");
        value = total > 0 ? errors / total : 0;
        break;
      case "DatabaseConnectionFail":
        value = getMetric("database_connection_failures");
        break;
    }
    
    const triggered = alert.condition(value);
    results.push({ alert, value, triggered });
    
    if (triggered && sentryInitialized) {
      try {
        const Sentry = require("@sentry/node");
        Sentry.captureMessage(`Alert triggered: ${alert.name}`, {
          level: alert.severity === "critical" ? "error" : "warning",
          extra: {
            threshold: alert.threshold,
            actualValue: value,
            alertName: alert.name,
          },
        });
        logger.warn(`[Monitoring] Alert triggered: ${alert.name}`, {
          value,
          threshold: alert.threshold,
          severity: alert.severity,
        });
      } catch (error) {
        logger.warn("[Monitoring] Failed to send alert to Sentry", { error });
      }
    }
  }
  
  return results;
}

// Health check with metrics
export function getHealthCheck(): {
  status: "healthy" | "degraded" | "unhealthy";
  metrics: Record<string, number>;
  alerts: Array<{ alert: AlertConfig; value: number; triggered: boolean }>;
  timestamp: string;
} {
  const errorRate = getMetric("api_errors") / (getMetric("api_count") || 1);
  const avgLatency = getMetric("api_duration_ms") / (getMetric("api_count") || 1);
  
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  
  if (errorRate > 0.1 || avgLatency > 5000) {
    status = "unhealthy";
  } else if (errorRate > 0.05 || avgLatency > 2000) {
    status = "degraded";
  }
  
  const alerts = checkAlerts();
  
  return {
    status,
    metrics: getMetrics(),
    alerts,
    timestamp: new Date().toISOString(),
  };
}

