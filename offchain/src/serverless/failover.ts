/**
 * Multi-Provider Failover System
 * Provides redundancy across Vercel, AWS, GCP
 */

import { logger } from "../shared/logger";

export enum Provider {
  VERCEL = "vercel",
  AWS = "aws",
  GCP = "gcp",
}

interface ProviderConfig {
  name: Provider;
  enabled: boolean;
  endpoint?: string;
  healthCheck?: string;
  priority: number; // Lower = higher priority
}

const providers: ProviderConfig[] = [
  {
    name: Provider.VERCEL,
    enabled: process.env.VERCEL_ENABLED !== "false",
    endpoint: process.env.VERCEL_ENDPOINT,
    healthCheck: process.env.VERCEL_HEALTH_CHECK,
    priority: 1,
  },
  {
    name: Provider.AWS,
    enabled: process.env.AWS_ENABLED !== "false",
    endpoint: process.env.AWS_ENDPOINT,
    healthCheck: process.env.AWS_HEALTH_CHECK,
    priority: 2,
  },
  {
    name: Provider.GCP,
    enabled: process.env.GCP_ENABLED !== "false",
    endpoint: process.env.GCP_ENDPOINT,
    healthCheck: process.env.GCP_HEALTH_CHECK,
    priority: 3,
  },
].filter(p => p.enabled)
  .sort((a, b) => a.priority - b.priority);

let currentProvider: ProviderConfig | null = null;
let providerFailures: Map<Provider, number> = new Map();

/**
 * Check provider health
 */
async function checkProviderHealth(provider: ProviderConfig): Promise<boolean> {
  if (!provider.healthCheck) {
    return true; // Assume healthy if no health check
  }

  try {
    const response = await fetch(provider.healthCheck, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    return response.ok;
  } catch (error) {
    logger.warn(`[Failover] Provider ${provider.name} health check failed`, { error });
    return false;
  }
}

/**
 * Get current active provider
 */
export async function getActiveProvider(): Promise<ProviderConfig> {
  // If current provider is healthy, use it
  if (currentProvider) {
    const healthy = await checkProviderHealth(currentProvider);
    if (healthy) {
      return currentProvider;
    }
    
    // Mark as failed
    const failures = providerFailures.get(currentProvider.name) || 0;
    providerFailures.set(currentProvider.name, failures + 1);
    logger.warn(`[Failover] Provider ${currentProvider.name} unhealthy, switching...`);
  }

  // Find next healthy provider
  for (const provider of providers) {
    const failures = providerFailures.get(provider.name) || 0;
    
    // Skip if too many failures (circuit breaker)
    if (failures >= 3) {
      logger.warn(`[Failover] Provider ${provider.name} has too many failures, skipping`);
      continue;
    }

    const healthy = await checkProviderHealth(provider);
    if (healthy) {
      currentProvider = provider;
      providerFailures.set(provider.name, 0); // Reset failure count
      logger.info(`[Failover] Using provider: ${provider.name}`);
      return provider;
    }
  }

  // All providers failed - use first one anyway (best effort)
  if (providers.length > 0) {
    currentProvider = providers[0];
    logger.error(`[Failover] All providers unhealthy, using ${currentProvider.name} as fallback`);
    return currentProvider;
  }

  throw new Error("No providers available");
}

/**
 * Execute request with failover
 */
export async function executeWithFailover<T>(
  fn: (provider: ProviderConfig) => Promise<T>
): Promise<T> {
  const maxRetries = providers.length;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const provider = await getActiveProvider();
      return await fn(provider);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`[Failover] Attempt ${attempt + 1} failed`, {
        provider: currentProvider?.name,
        error: lastError.message,
      });

      // Mark current provider as failed
      if (currentProvider) {
        const failures = providerFailures.get(currentProvider.name) || 0;
        providerFailures.set(currentProvider.name, failures + 1);
        currentProvider = null; // Force re-selection
      }

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error("All providers failed");
}

/**
 * Reset provider failure counts (for recovery)
 */
export function resetProviderFailures(provider?: Provider) {
  if (provider) {
    providerFailures.set(provider, 0);
  } else {
    providerFailures.clear();
  }
}

/**
 * Get provider status
 */
export function getProviderStatus(): {
  current: Provider | null;
  providers: Array<{ name: Provider; failures: number; enabled: boolean }>;
} {
  return {
    current: currentProvider?.name || null,
    providers: providers.map(p => ({
      name: p.name,
      failures: providerFailures.get(p.name) || 0,
      enabled: p.enabled,
    })),
  };
}

