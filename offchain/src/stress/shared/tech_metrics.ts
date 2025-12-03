/**
 * Technical metrics collection for bottleneck detection
 */

import { Pool } from 'pg';
import * as os from 'os';

export interface TechMetrics {
  memory: {
    heapUsed: number[];
    heapTotal: number[];
    external: number[];
    rss: number[];
    peakHeapUsed: number;
    peakRSS: number;
  };
  dbMetrics: {
    queryTimes: number[];
    slowQueries: Array<{ query: string; time: number; timestamp: number }>;
    connectionPool: Array<{ total: number; idle: number; waiting: number; timestamp: number }>;
    avgQueryTime: number;
    p95QueryTime: number;
    p99QueryTime: number;
    peakQueryTime: number;
    totalQueries: number;
  };
  batchMetrics: {
    batchSize: number[];
    batchTime: number[];
    throughput: number[];
    avgBatchTime: number;
    peakBatchTime: number;
  };
  systemMetrics: {
    cpuUsage: number[];
    loadAverage: number[];
    timestamp: number[];
  };
  bottlenecks: Array<{
    type: 'memory' | 'database' | 'cpu' | 'network' | 'batch';
    location: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    details: any;
    timestamp: number;
  }>;
}

/**
 * Capture current memory usage
 */
export function captureMemory(): { heapUsed: number; heapTotal: number; external: number; rss: number } {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    rss: usage.rss
  };
}

/**
 * Get connection pool stats from pg Pool
 */
export async function getPoolStats(pool: Pool): Promise<{ total: number; idle: number; waiting: number }> {
  // @ts-ignore - accessing internal pool stats
  const poolStats = pool.totalCount !== undefined ? {
    total: pool.totalCount || 0,
    idle: pool.idleCount || 0,
    waiting: pool.waitingCount || 0
  } : {
    total: 0,
    idle: 0,
    waiting: 0
  };
  
  return poolStats;
}

/**
 * Detect bottlenecks from collected metrics
 */
export function detectBottlenecks(metrics: {
  memory?: { peakRSS?: number; peakHeapUsed?: number };
  dbMetrics?: {
    avgQueryTime?: number;
    p95QueryTime?: number;
    p99QueryTime?: number;
    peakQueryTime?: number;
    slowQueries?: any[];
    connectionPool?: any[];
    totalQueries?: number;
  };
  batchMetrics?: {
    avgBatchTime?: number;
    peakBatchTime?: number;
    avgBatchSize?: number;
  };
}): Array<{
  type: string;
  location: string;
  severity: string;
  details: any;
}> {
  const bottlenecks: Array<{ type: string; location: string; severity: string; details: any }> = [];
  
  // Memory bottleneck detection
  if (metrics.memory?.peakRSS) {
    const peakRSSGB = metrics.memory.peakRSS / (1024 * 1024 * 1024);
    if (peakRSSGB > 8) {
      bottlenecks.push({
        type: 'memory',
        location: 'heap',
        severity: peakRSSGB > 16 ? 'critical' : peakRSSGB > 12 ? 'high' : 'medium',
        details: { peakRSSGB, threshold: 8 }
      });
    }
  }
  
  // Database bottleneck detection
  if (metrics.dbMetrics) {
    const { avgQueryTime, p95QueryTime, peakQueryTime, slowQueries } = metrics.dbMetrics;
    
    if (avgQueryTime > 500) {
      bottlenecks.push({
        type: 'database',
        location: 'query_performance',
        severity: avgQueryTime > 2000 ? 'critical' : avgQueryTime > 1000 ? 'high' : 'medium',
        details: { avgQueryTime, threshold: 500 }
      });
    }
    
    if (p95QueryTime > 2000) {
      bottlenecks.push({
        type: 'database',
        location: 'p95_query_time',
        severity: p95QueryTime > 5000 ? 'critical' : 'high',
        details: { p95QueryTime, threshold: 2000 }
      });
    }
    
    if (slowQueries && slowQueries.length > 10) {
      bottlenecks.push({
        type: 'database',
        location: 'slow_queries',
        severity: slowQueries.length > 50 ? 'critical' : slowQueries.length > 25 ? 'high' : 'medium',
        details: { slowQueryCount: slowQueries.length, threshold: 10 }
      });
    }
  }
  
  // Batch processing bottleneck
  if (metrics.batchMetrics) {
    const { avgBatchTime, peakBatchTime } = metrics.batchMetrics;
    
    if (avgBatchTime > 5000) {
      bottlenecks.push({
        type: 'batch',
        location: 'batch_processing',
        severity: avgBatchTime > 10000 ? 'critical' : avgBatchTime > 7000 ? 'high' : 'medium',
        details: { avgBatchTime, threshold: 5000 }
      });
    }
  }
  
  // Connection pool exhaustion
  if (metrics.dbMetrics?.connectionPool) {
    const recentPools = metrics.dbMetrics.connectionPool.slice(-10);
    const highWaiting = recentPools.filter(p => p.waiting > 5);
    
    if (highWaiting.length > 5) {
      bottlenecks.push({
        type: 'database',
        location: 'connection_pool',
        severity: 'high',
        details: { waitingConnections: highWaiting.map(p => p.waiting), threshold: 5 }
      });
    }
  }
  
  return bottlenecks;
}

/**
 * Calculate percentiles from array
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get system CPU usage (approximate)
 */
export function getSystemMetrics(): { cpuUsage: number; loadAverage: number[] } {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  
  // Simple CPU usage approximation
  let totalIdle = 0;
  let totalTick = 0;
  
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }
  
  const cpuUsage = ((totalTick - totalIdle) / totalTick) * 100;
  
  return {
    cpuUsage,
    loadAverage: loadAvg
  };
}

