/**
 * ======================================================================
 * MEGA SCALE BENCHMARKS - 10K to 1 BILLION INTENTS
 * ======================================================================
 * 
 * Full-scale stress testing of the Wraith Netting Engine.
 * 
 * Scale Levels:
 *   - 10K     (Micro)      - Baseline
 *   - 100K    (Small)      - Current max tested
 *   - 1M      (Medium)     - Target for v1
 *   - 10M     (Large)      - Enterprise scale
 *   - 100M    (XL)         - Theoretical
 *   - 1B      (Insane)     - Maximum chaos
 * 
 * Usage:
 *   npx ts-node src/scripts/megaScaleBenchmark.ts [scale]
 *   
 *   Scales: micro, small, medium, large, xl, insane, all
 *   
 *   Examples:
 *     npx ts-node src/scripts/megaScaleBenchmark.ts micro    # 10K only
 *     npx ts-node src/scripts/megaScaleBenchmark.ts medium   # 1M test
 *     npx ts-node src/scripts/megaScaleBenchmark.ts all      # Full suite
 */

import dotenv from "dotenv";
dotenv.config();

import { logger } from "../shared/logger";
import { Keypair } from "@solana/web3.js";
import { v4 as uuidv4 } from "uuid";
import { performance } from "perf_hooks";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Enable test mode
if (!process.env.ALLOW_UNSIGNED_INTENTS) {
  process.env.ALLOW_UNSIGNED_INTENTS = "true";
}

import { TradeIntent, SessionKeyPolicy } from "../netting/types";
import { registerSessionKeyPolicy } from "../netting/session";
import { runFastNetting } from "../netting/fastGraph";

// ============================================================
// SCALE DEFINITIONS
// ============================================================

interface ScaleConfig {
  name: string;
  intents: number;
  targetTimeMs: number;
  description: string;
}

const SCALES: Record<string, ScaleConfig> = {
  micro: {
    name: "Micro",
    intents: 10_000,
    targetTimeMs: 500,
    description: "Baseline test - 10K intents",
  },
  small: {
    name: "Small",
    intents: 100_000,
    targetTimeMs: 2_000,
    description: "Current max tested - 100K intents",
  },
  medium: {
    name: "Medium",
    intents: 1_000_000,
    targetTimeMs: 10_000,
    description: "V1 target - 1M intents",
  },
  large: {
    name: "Large",
    intents: 10_000_000,
    targetTimeMs: 60_000,
    description: "Enterprise scale - 10M intents",
  },
  xl: {
    name: "XL",
    intents: 100_000_000,
    targetTimeMs: 300_000, // 5 min
    description: "Theoretical max - 100M intents",
  },
  insane: {
    name: "Insane",
    intents: 1_000_000_000,
    targetTimeMs: 1_800_000, // 30 min
    description: "Maximum chaos - 1B intents",
  },
};

// ============================================================
// BENCHMARK RESULT TYPES
// ============================================================

interface BenchmarkResult {
  scale: string;
  intents: number;
  targetTimeMs: number;
  actualTimeMs: number;
  passed: boolean;
  intentsPerSecond: number;
  memoryBeforeMB: number;
  memoryAfterMB: number;
  memoryPeakMB: number;
  memoryPerIntentKB: number;
  cpuTimeMs: number;
  numItemsSettled: number;
  numWallets: number;
  compressionRatio: number;
  timestamp: string;
  error?: string;
}

// ============================================================
// UTILITIES
// ============================================================

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toString();
}

function formatTime(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(2)} min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)} s`;
  return `${ms.toFixed(2)} ms`;
}

function getMemoryUsage(): { heapMB: number; rssMB: number } {
  const mem = process.memoryUsage();
  return {
    heapMB: mem.heapUsed / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
  };
}

// ============================================================
// INTENT GENERATOR (Optimized for scale)
// ============================================================

function* generateIntentsStreaming(
  numIntents: number,
  numWallets: number,
  numItems: number,
  sessionKeys: Map<string, { keypair: Keypair; policy: SessionKeyPolicy }>
): Generator<TradeIntent> {
  const wallets = Array.from(sessionKeys.keys());
  let count = 0;

  while (count < numIntents) {
    for (let itemIdx = 0; itemIdx < numItems && count < numIntents; itemIdx++) {
      const itemId = `item_${itemIdx}`;
      
      for (let w = 0; w < wallets.length - 1 && count < numIntents; w++) {
        const fromWallet = wallets[w];
        const toWallet = wallets[w + 1];
        const session = sessionKeys.get(fromWallet);
        
        if (!session) continue;
        
        yield {
          id: uuidv4(),
          sessionPubkey: session.policy.sessionPubkey,
          ownerPubkey: fromWallet,
          itemId,
          from: fromWallet,
          to: toWallet,
          amountLamports: BigInt(100_000_000), // 0.1 SOL
          nonce: count,
          signature: `sig_${count}`,
          createdAt: Math.floor(Date.now() / 1000),
          intentType: "TRADE",
        };
        
        count++;
        
        // Progress every 1M
        if (count % 1_000_000 === 0) {
          console.log(`  [GEN] ${formatNumber(count)} intents generated...`);
        }
      }
    }
  }
}

function generateIntentsBatch(
  numIntents: number,
  batchSize: number = 100_000
): TradeIntent[] {
  console.log(`  [GEN] Generating ${formatNumber(numIntents)} intents...`);
  
  // Calculate optimal wallet/item counts
  const numWallets = Math.min(1000, Math.max(100, Math.ceil(numIntents / 1000)));
  const numItems = Math.min(10000, Math.max(1000, Math.ceil(numIntents / 100)));
  
  // Create session keys
  const sessionKeys = new Map<string, { keypair: Keypair; policy: SessionKeyPolicy }>();
  
  for (let i = 0; i < numWallets; i++) {
    const w = Keypair.generate();
    const s = Keypair.generate();
    const policy: SessionKeyPolicy = {
      ownerPubkey: w.publicKey.toBase58(),
      sessionPubkey: s.publicKey.toBase58(),
      maxVolumeLamports: BigInt(1_000_000_000_000_000),
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 365,
      allowedActions: ["TRADE", "BID", "BUY_NOW"],
      createdAt: Math.floor(Date.now() / 1000),
    };
    registerSessionKeyPolicy(policy);
    sessionKeys.set(w.publicKey.toBase58(), { keypair: s, policy });
  }
  
  // Generate using streaming generator
  const intents: TradeIntent[] = [];
  const generator = generateIntentsStreaming(numIntents, numWallets, numItems, sessionKeys);
  
  for (const intent of generator) {
    intents.push(intent);
  }
  
  console.log(`  [GEN] ✅ Generated ${formatNumber(intents.length)} intents`);
  return intents;
}

// ============================================================
// BENCHMARK RUNNER
// ============================================================

async function runBenchmark(scale: ScaleConfig): Promise<BenchmarkResult> {
  const timestamp = new Date().toISOString();
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🚀 BENCHMARK: ${scale.name} (${formatNumber(scale.intents)} intents)`);
  console.log(`   Target: < ${formatTime(scale.targetTimeMs)}`);
  console.log(`${"=".repeat(70)}\n`);
  
  const memBefore = getMemoryUsage();
  let memPeak = memBefore.rssMB;
  
  try {
    // Generate intents
    console.log(`[1/3] Generating intents...`);
    const genStart = performance.now();
    const intents = generateIntentsBatch(scale.intents);
    const genTime = performance.now() - genStart;
    console.log(`      ✅ Generation: ${formatTime(genTime)}`);
    
    // Update peak memory
    const memAfterGen = getMemoryUsage();
    memPeak = Math.max(memPeak, memAfterGen.rssMB);
    
    // Force GC if available
    if (global.gc) {
      console.log(`[2/3] Running GC...`);
      global.gc();
    }
    
    // Run netting
    console.log(`[3/3] Running netting...`);
    const nettingStart = performance.now();
    const cpuBefore = process.cpuUsage();
    
    const result = runFastNetting(intents);
    
    const nettingTime = performance.now() - nettingStart;
    const cpuAfter = process.cpuUsage(cpuBefore);
    const cpuTimeMs = (cpuAfter.user + cpuAfter.system) / 1000;
    
    // Final memory
    const memAfter = getMemoryUsage();
    memPeak = Math.max(memPeak, memAfter.rssMB);
    
    // Calculate metrics
    const passed = nettingTime <= scale.targetTimeMs;
    const intentsPerSecond = Math.round(scale.intents / (nettingTime / 1000));
    const compressionRatio = result.numItemsSettled > 0 
      ? result.numIntents / result.numItemsSettled 
      : 0;
    const memoryPerIntentKB = (memPeak - memBefore.rssMB) * 1024 / scale.intents;
    
    // Log result
    console.log(`\n📊 RESULTS:`);
    console.log(`   Netting Time: ${formatTime(nettingTime)}`);
    console.log(`   Target:       ${formatTime(scale.targetTimeMs)}`);
    console.log(`   Status:       ${passed ? "✅ PASSED" : "❌ FAILED"}`);
    console.log(`   Throughput:   ${formatNumber(intentsPerSecond)} intents/sec`);
    console.log(`   Compression:  ${compressionRatio.toFixed(2)}x`);
    console.log(`   Memory Peak:  ${memPeak.toFixed(2)} MB`);
    console.log(`   Memory/Intent: ${memoryPerIntentKB.toFixed(4)} KB`);
    
    return {
      scale: scale.name,
      intents: scale.intents,
      targetTimeMs: scale.targetTimeMs,
      actualTimeMs: nettingTime,
      passed,
      intentsPerSecond,
      memoryBeforeMB: memBefore.rssMB,
      memoryAfterMB: memAfter.rssMB,
      memoryPeakMB: memPeak,
      memoryPerIntentKB,
      cpuTimeMs,
      numItemsSettled: result.numItemsSettled,
      numWallets: result.numWallets,
      compressionRatio,
      timestamp,
    };
    
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(`\n❌ ERROR: ${errMsg}`);
    
    return {
      scale: scale.name,
      intents: scale.intents,
      targetTimeMs: scale.targetTimeMs,
      actualTimeMs: -1,
      passed: false,
      intentsPerSecond: 0,
      memoryBeforeMB: memBefore.rssMB,
      memoryAfterMB: 0,
      memoryPeakMB: memPeak,
      memoryPerIntentKB: 0,
      cpuTimeMs: 0,
      numItemsSettled: 0,
      numWallets: 0,
      compressionRatio: 0,
      timestamp,
      error: errMsg,
    };
  }
}

// ============================================================
// REPORT GENERATOR
// ============================================================

function generateReport(results: BenchmarkResult[]): string {
  const lines: string[] = [];
  
  lines.push("# 🔮 ZK NARC - Mega Scale Benchmark Report");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**System:** ${os.cpus()[0]?.model || "Unknown"} (${os.cpus().length} cores)`);
  lines.push(`**RAM:** ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
  lines.push(`**Node:** ${process.version}`);
  lines.push("");
  
  // Summary table
  lines.push("## 📊 Results Summary");
  lines.push("");
  lines.push("| Scale | Intents | Target | Actual | Status | Throughput | Memory |");
  lines.push("|-------|---------|--------|--------|--------|------------|--------|");
  
  for (const r of results) {
    const status = r.passed ? "✅ PASS" : (r.error ? "❌ ERROR" : "❌ FAIL");
    const actual = r.actualTimeMs > 0 ? formatTime(r.actualTimeMs) : "N/A";
    const throughput = r.intentsPerSecond > 0 ? `${formatNumber(r.intentsPerSecond)}/s` : "N/A";
    const memory = r.memoryPeakMB > 0 ? `${r.memoryPeakMB.toFixed(0)} MB` : "N/A";
    
    lines.push(`| ${r.scale} | ${formatNumber(r.intents)} | ${formatTime(r.targetTimeMs)} | ${actual} | ${status} | ${throughput} | ${memory} |`);
  }
  
  lines.push("");
  
  // Detailed results
  lines.push("## 📋 Detailed Results");
  lines.push("");
  
  for (const r of results) {
    lines.push(`### ${r.scale} (${formatNumber(r.intents)} intents)`);
    lines.push("");
    lines.push(`- **Status:** ${r.passed ? "✅ PASSED" : "❌ FAILED"}`);
    lines.push(`- **Target Time:** ${formatTime(r.targetTimeMs)}`);
    lines.push(`- **Actual Time:** ${r.actualTimeMs > 0 ? formatTime(r.actualTimeMs) : "N/A"}`);
    lines.push(`- **Throughput:** ${r.intentsPerSecond > 0 ? `${formatNumber(r.intentsPerSecond)} intents/sec` : "N/A"}`);
    lines.push(`- **Compression:** ${r.compressionRatio.toFixed(2)}x`);
    lines.push(`- **Items Settled:** ${formatNumber(r.numItemsSettled)}`);
    lines.push(`- **Wallets:** ${formatNumber(r.numWallets)}`);
    lines.push(`- **Memory Peak:** ${r.memoryPeakMB.toFixed(2)} MB`);
    lines.push(`- **Memory/Intent:** ${r.memoryPerIntentKB.toFixed(4)} KB`);
    lines.push(`- **CPU Time:** ${formatTime(r.cpuTimeMs)}`);
    
    if (r.error) {
      lines.push(`- **Error:** \`${r.error}\``);
    }
    
    lines.push("");
  }
  
  // Scaling analysis
  const successfulResults = results.filter(r => r.passed && r.actualTimeMs > 0);
  if (successfulResults.length >= 2) {
    lines.push("## 📈 Scaling Analysis");
    lines.push("");
    
    // Calculate scaling factor
    const first = successfulResults[0];
    const last = successfulResults[successfulResults.length - 1];
    const intentScale = last.intents / first.intents;
    const timeScale = last.actualTimeMs / first.actualTimeMs;
    const complexity = timeScale / intentScale;
    
    lines.push(`- **Intent Scale:** ${formatNumber(first.intents)} → ${formatNumber(last.intents)} (${intentScale.toFixed(1)}x)`);
    lines.push(`- **Time Scale:** ${formatTime(first.actualTimeMs)} → ${formatTime(last.actualTimeMs)} (${timeScale.toFixed(1)}x)`);
    lines.push(`- **Complexity Factor:** ${complexity.toFixed(3)}x (1.0 = perfect O(N) linear)`);
    lines.push("");
    
    if (complexity < 1.5) {
      lines.push("**Analysis:** 🟢 Excellent linear scaling - O(N) complexity maintained");
    } else if (complexity < 2.0) {
      lines.push("**Analysis:** 🟡 Good scaling - Minor overhead at scale");
    } else {
      lines.push("**Analysis:** 🔴 Scaling issues - Memory or CPU bottleneck detected");
    }
    lines.push("");
  }
  
  lines.push("---");
  lines.push("");
  lines.push("*Generated by `megaScaleBenchmark.ts` - ZK NARC Proof Engine*");
  
  return lines.join("\n");
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║              🔮 ZK NARC - MEGA SCALE BENCHMARKS                  ║");
  console.log("║                   10K to 1 BILLION Intents                       ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("");
  
  // Parse args
  const arg = (process.argv[2] || "micro").toLowerCase();
  
  let scalesToRun: ScaleConfig[] = [];
  
  if (arg === "all") {
    scalesToRun = Object.values(SCALES);
  } else if (SCALES[arg]) {
    scalesToRun = [SCALES[arg]];
  } else {
    console.log(`Unknown scale: ${arg}`);
    console.log(`Available: ${Object.keys(SCALES).join(", ")}, all`);
    process.exit(1);
  }
  
  console.log(`🎯 Running ${scalesToRun.length} benchmark(s):`);
  for (const s of scalesToRun) {
    console.log(`   - ${s.name}: ${formatNumber(s.intents)} intents`);
  }
  console.log("");
  
  // Run benchmarks
  const results: BenchmarkResult[] = [];
  
  for (const scale of scalesToRun) {
    const result = await runBenchmark(scale);
    results.push(result);
    
    // Cooldown between tests
    if (scalesToRun.length > 1) {
      console.log("\n⏳ Cooldown (5s)...");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  // Generate report
  console.log("\n📝 Generating report...");
  const report = generateReport(results);
  
  const reportPath = path.join(__dirname, "..", "..", "MEGA_SCALE_BENCHMARK.md");
  fs.writeFileSync(reportPath, report);
  console.log(`   ✅ Report saved: ${reportPath}`);
  
  // Save raw results as JSON
  const jsonPath = path.join(__dirname, "..", "..", "MEGA_SCALE_BENCHMARK.json");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`   ✅ JSON saved: ${jsonPath}`);
  
  // Final summary
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║                      📊 FINAL SUMMARY                            ║");
  console.log("╠══════════════════════════════════════════════════════════════════╣");
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  for (const r of results) {
    const status = r.passed ? "✅" : "❌";
    const time = r.actualTimeMs > 0 ? formatTime(r.actualTimeMs) : "ERROR";
    console.log(`║  ${status} ${r.scale.padEnd(10)} ${formatNumber(r.intents).padStart(8)} intents in ${time.padStart(10)} ║`);
  }
  
  console.log("╠══════════════════════════════════════════════════════════════════╣");
  console.log(`║  PASSED: ${passed}/${results.length}    FAILED: ${failed}/${results.length}                                ║`);
  console.log("╚══════════════════════════════════════════════════════════════════╝");
  console.log("");
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});

