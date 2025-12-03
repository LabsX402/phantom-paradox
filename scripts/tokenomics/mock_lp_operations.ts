/**
 * Mock LP Pool Operations
 * 
 * Simulate swaps, LP growth, and other pool operations for testing
 * 
 * Usage:
 *   npx ts-node mock_lp_operations.ts status
 *   npx ts-node mock_lp_operations.ts swap-buy 0.1
 *   npx ts-node mock_lp_operations.ts swap-sell 1000000
 *   npx ts-node mock_lp_operations.ts add-fees 0.5
 *   npx ts-node mock_lp_operations.ts lp-growth
 *   npx ts-node mock_lp_operations.ts simulate-day 10
 */

import * as fs from 'fs';

const PDOX_DECIMALS = 9;
const LAMPORTS_PER_SOL = 1_000_000_000;

interface MockPool {
  solReserve: number;
  pdoxReserve: number;
  totalLpTokens: number;
  currentPrice: number;
  feeBps: number;
  accumulatedFees: { sol: number; pdox: number };
  totalSwapVolume: number;
  swapCount: number;
  lpGrowthConfig: {
    minFeeThreshold: number;
    lastGrowthTimestamp: number;
    totalFeesUsedForGrowth: number;
  };
  lastUpdated: string;
}

function loadPool(): MockPool {
  return JSON.parse(fs.readFileSync('PDOX_MOCK_LP_POOL.json', 'utf-8'));
}

function savePool(pool: MockPool) {
  pool.lastUpdated = new Date().toISOString();
  fs.writeFileSync('PDOX_MOCK_LP_POOL.json', JSON.stringify(pool, null, 2));
}

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4);
}

function formatPdox(raw: number): string {
  return (raw / (10 ** PDOX_DECIMALS)).toLocaleString();
}

// ============================================================================
// OPERATIONS
// ============================================================================

function showStatus() {
  const pool = loadPool();
  console.log('\n=== PDOX Mock LP Pool Status ===\n');
  console.log(`SOL Reserve:     ${formatSol(pool.solReserve)} SOL`);
  console.log(`PDOX Reserve:    ${formatPdox(pool.pdoxReserve)} PDOX`);
  console.log(`Price:           1 SOL = ${pool.currentPrice.toLocaleString()} PDOX`);
  console.log(`LP Tokens:       ${pool.totalLpTokens.toExponential(2)}`);
  console.log(`\nFees Accumulated:`);
  console.log(`  SOL:           ${formatSol(pool.accumulatedFees.sol)} SOL`);
  console.log(`  PDOX:          ${formatPdox(pool.accumulatedFees.pdox)} PDOX`);
  console.log(`\nStats:`);
  console.log(`  Total Volume:  ${formatSol(pool.totalSwapVolume)} SOL`);
  console.log(`  Swap Count:    ${pool.swapCount}`);
  console.log(`  Fees for LP:   ${formatSol(pool.lpGrowthConfig.totalFeesUsedForGrowth)} SOL`);
  console.log(`  Last Updated:  ${pool.lastUpdated}`);
}

function swapBuy(solAmount: number) {
  const pool = loadPool();
  const solLamports = solAmount * LAMPORTS_PER_SOL;
  
  // Calculate fee (in SOL)
  const fee = solLamports * pool.feeBps / 10000;
  const solIn = solLamports - fee;
  
  // Constant product: (x + dx) * (y - dy) = x * y
  // dy = y * dx / (x + dx)
  const pdoxOut = (pool.pdoxReserve * solIn) / (pool.solReserve + solIn);
  
  // Update reserves
  pool.solReserve += solIn;
  pool.pdoxReserve -= pdoxOut;
  pool.accumulatedFees.sol += fee;
  pool.totalSwapVolume += solLamports;
  pool.swapCount++;
  
  // Update price
  pool.currentPrice = Math.round(pool.pdoxReserve / pool.solReserve);
  
  savePool(pool);
  
  console.log(`\n✅ Swap Buy Executed`);
  console.log(`   In:    ${formatSol(solLamports)} SOL`);
  console.log(`   Out:   ${formatPdox(pdoxOut)} PDOX`);
  console.log(`   Fee:   ${formatSol(fee)} SOL`);
  console.log(`   Price: 1 SOL = ${pool.currentPrice.toLocaleString()} PDOX`);
}

function swapSell(pdoxAmount: number) {
  const pool = loadPool();
  const pdoxRaw = pdoxAmount * (10 ** PDOX_DECIMALS);
  
  // Calculate output
  const solOut = (pool.solReserve * pdoxRaw) / (pool.pdoxReserve + pdoxRaw);
  const fee = solOut * pool.feeBps / 10000;
  const solOutAfterFee = solOut - fee;
  
  // Update reserves
  pool.pdoxReserve += pdoxRaw;
  pool.solReserve -= solOutAfterFee;
  pool.accumulatedFees.sol += fee;
  pool.totalSwapVolume += solOut;
  pool.swapCount++;
  
  // Update price
  pool.currentPrice = Math.round(pool.pdoxReserve / pool.solReserve);
  
  savePool(pool);
  
  console.log(`\n✅ Swap Sell Executed`);
  console.log(`   In:    ${formatPdox(pdoxRaw)} PDOX`);
  console.log(`   Out:   ${formatSol(solOutAfterFee)} SOL`);
  console.log(`   Fee:   ${formatSol(fee)} SOL`);
  console.log(`   Price: 1 SOL = ${pool.currentPrice.toLocaleString()} PDOX`);
}

function addFees(solAmount: number) {
  const pool = loadPool();
  const fee = solAmount * LAMPORTS_PER_SOL;
  pool.accumulatedFees.sol += fee;
  savePool(pool);
  
  console.log(`\n✅ Added ${formatSol(fee)} SOL to accumulated fees`);
  console.log(`   Total fees: ${formatSol(pool.accumulatedFees.sol)} SOL`);
}

function executeLpGrowth() {
  const pool = loadPool();
  
  const minThreshold = pool.lpGrowthConfig.minFeeThreshold;
  if (pool.accumulatedFees.sol < minThreshold) {
    console.log(`\n❌ Not enough fees. Have ${formatSol(pool.accumulatedFees.sol)} SOL, need ${formatSol(minThreshold)} SOL`);
    return;
  }
  
  const solFees = pool.accumulatedFees.sol;
  
  // Calculate PDOX to add to maintain ratio
  const currentRatio = pool.pdoxReserve / pool.solReserve;
  const pdoxToAdd = solFees * currentRatio;
  
  // Add to reserves
  const oldSol = pool.solReserve;
  const oldPdox = pool.pdoxReserve;
  
  pool.solReserve += solFees;
  pool.pdoxReserve += pdoxToAdd;
  
  // Mint LP tokens proportionally
  const lpRatio = solFees / oldSol;
  const newLpTokens = pool.totalLpTokens * lpRatio;
  pool.totalLpTokens += newLpTokens;
  
  // Track growth
  pool.lpGrowthConfig.totalFeesUsedForGrowth += solFees;
  pool.lpGrowthConfig.lastGrowthTimestamp = Date.now();
  
  // Reset accumulated fees
  pool.accumulatedFees.sol = 0;
  
  savePool(pool);
  
  console.log(`\n✅ LP Growth Executed!`);
  console.log(`   SOL Added:    ${formatSol(solFees)} SOL`);
  console.log(`   PDOX Minted:  ${formatPdox(pdoxToAdd)} PDOX`);
  console.log(`   LP Minted:    ${newLpTokens.toExponential(2)}`);
  console.log(`\n   New Reserves:`);
  console.log(`   SOL:  ${formatSol(pool.solReserve)} SOL (${((pool.solReserve/oldSol - 1) * 100).toFixed(2)}% increase)`);
  console.log(`   PDOX: ${formatPdox(pool.pdoxReserve)} PDOX`);
  console.log(`   Price unchanged: 1 SOL = ${pool.currentPrice.toLocaleString()} PDOX`);
}

function simulateDay(volumeMultiplier: number = 10) {
  console.log(`\n📊 Simulating a day of trading (volume multiplier: ${volumeMultiplier}x)\n`);
  
  // Simulate 50 trades
  const numTrades = 50;
  const baseVolume = 0.02; // 0.02 SOL average per trade
  
  for (let i = 0; i < numTrades; i++) {
    const pool = loadPool();
    const isBuy = Math.random() > 0.5;
    const volume = baseVolume * volumeMultiplier * (0.5 + Math.random());
    
    if (isBuy) {
      const solLamports = volume * LAMPORTS_PER_SOL;
      const fee = solLamports * pool.feeBps / 10000;
      const solIn = solLamports - fee;
      const pdoxOut = (pool.pdoxReserve * solIn) / (pool.solReserve + solIn);
      
      pool.solReserve += solIn;
      pool.pdoxReserve -= pdoxOut;
      pool.accumulatedFees.sol += fee;
      pool.totalSwapVolume += solLamports;
      pool.swapCount++;
      pool.currentPrice = Math.round(pool.pdoxReserve / pool.solReserve);
      
      savePool(pool);
    } else {
      const pdoxVolume = volume * pool.currentPrice / LAMPORTS_PER_SOL;
      const pdoxRaw = pdoxVolume * (10 ** PDOX_DECIMALS);
      const solOut = (pool.solReserve * pdoxRaw) / (pool.pdoxReserve + pdoxRaw);
      const fee = solOut * pool.feeBps / 10000;
      const solOutAfterFee = solOut - fee;
      
      pool.pdoxReserve += pdoxRaw;
      pool.solReserve -= solOutAfterFee;
      pool.accumulatedFees.sol += fee;
      pool.totalSwapVolume += solOut;
      pool.swapCount++;
      pool.currentPrice = Math.round(pool.pdoxReserve / pool.solReserve);
      
      savePool(pool);
    }
  }
  
  console.log(`✅ Simulation complete! ${numTrades} trades executed.`);
  showStatus();
}

// ============================================================================
// CLI
// ============================================================================

const args = process.argv.slice(2);
const cmd = args[0];
const arg1 = parseFloat(args[1]) || 0.1;

switch (cmd) {
  case 'status':
    showStatus();
    break;
  case 'swap-buy':
    swapBuy(arg1);
    break;
  case 'swap-sell':
    swapSell(arg1);
    break;
  case 'add-fees':
    addFees(arg1);
    break;
  case 'lp-growth':
    executeLpGrowth();
    break;
  case 'simulate-day':
    simulateDay(arg1);
    break;
  default:
    console.log(`
Mock LP Pool Operations

Usage:
  npx ts-node mock_lp_operations.ts <command> [args]

Commands:
  status              Show pool status
  swap-buy <sol>      Swap SOL for PDOX (e.g., swap-buy 0.1)
  swap-sell <pdox>    Swap PDOX for SOL (e.g., swap-sell 1000000)
  add-fees <sol>      Manually add fees (e.g., add-fees 0.5)
  lp-growth           Execute LP growth (if enough fees)
  simulate-day <mult> Simulate a day of trading (volume multiplier)

Examples:
  npx ts-node mock_lp_operations.ts status
  npx ts-node mock_lp_operations.ts swap-buy 0.1
  npx ts-node mock_lp_operations.ts swap-sell 1000000
  npx ts-node mock_lp_operations.ts add-fees 0.5
  npx ts-node mock_lp_operations.ts lp-growth
  npx ts-node mock_lp_operations.ts simulate-day 10
`);
}

