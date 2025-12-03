#!/usr/bin/env ts-node
/**
 * Cost model calculator
 * Computes transaction costs for different scenarios
 * 
 * Usage:
 *   npx ts-node src/stress/metrics_cost_model.ts --auctions 1000 --players 5000 --bids 20000 --solPrice 126
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { calculateCostMetrics, formatMetrics, exportMetrics } from './shared/metrics';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('auctions', {
      type: 'number',
      default: 1000,
      describe: 'Number of auctions'
    })
    .option('players', {
      type: 'number',
      default: 5000,
      describe: 'Number of players'
    })
    .option('bids', {
      type: 'number',
      default: 20000,
      describe: 'Number of bids'
    })
    .option('solPrice', {
      type: 'number',
      default: 126,
      describe: 'SOL price in USD'
    })
    .option('export', {
      type: 'string',
      describe: 'Export path for JSON metrics'
    })
    .help()
    .argv;
  
  console.log('📊 Calculating cost metrics...\n');
  
  const metrics = calculateCostMetrics(
    argv.auctions,
    argv.players,
    argv.bids,
    argv.solPrice
  );
  
  console.log(formatMetrics(metrics));
  
  // Export if requested
  if (argv.export) {
    const exportPath = path.resolve(__dirname, '../..', argv.export);
    exportMetrics(metrics, exportPath);
  } else {
    // Default export location
    const logsDir = path.resolve(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const defaultPath = path.join(
      logsDir,
      `cost_model_${argv.auctions}_auctions.json`
    );
    exportMetrics(metrics, defaultPath);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

