#!/usr/bin/env ts-node
/**
 * Setup script for local validator testing
 * 
 * Usage:
 *   npx ts-node src/stress/setup_localnet.ts
 */

import { execSync } from 'child_process';
import * as path from 'path';

async function main() {
  console.log('🔧 Setting up localnet environment...\n');
  
  const repoRoot = path.resolve(__dirname, '../../../Nodezero_engine');
  
  try {
    // 1. Check if validator is running
    console.log('1. Checking if validator is running...');
    try {
      execSync('solana config get', { stdio: 'pipe' });
      console.log('✅ Solana CLI configured');
    } catch (e) {
      console.log('❌ Solana CLI not configured. Run: solana config set');
      process.exit(1);
    }
    
    // 2. Airdrop to deployer
    console.log('\n2. Airdropping SOL to deployer...');
    try {
      execSync('solana airdrop 10', { stdio: 'inherit' });
      console.log('✅ Airdrop successful');
    } catch (e) {
      console.log('⚠️  Airdrop failed (validator may not be running)');
      console.log('   Start validator with: solana-test-validator --reset');
    }
    
    // 3. Build program
    console.log('\n3. Building program...');
    execSync(
      'anchor build -p phantomgrid_gaming --no-default-features --features core',
      { cwd: repoRoot, stdio: 'inherit' }
    );
    console.log('✅ Build successful');
    
    // 4. Deploy to localnet
    console.log('\n4. Deploying to localnet...');
    execSync(
      'anchor deploy -p phantomgrid_gaming --provider.cluster localnet --no-default-features --features core',
      { cwd: repoRoot, stdio: 'inherit' }
    );
    console.log('✅ Deployment successful');
    
    console.log('\n✅ Localnet setup complete!');
    console.log('\nNext steps:');
    console.log('  1. Run pre-flight checks: npx ts-node src/stress/preflight.ts');
    console.log('  2. Run build checks: npx ts-node src/stress/build_check.ts');
    console.log('  3. Run scenarios: npx ts-node src/stress/scenario_small.ts');
    
  } catch (error: any) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

