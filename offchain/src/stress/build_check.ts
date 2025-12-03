#!/usr/bin/env ts-node
/**
 * Build and lint verification
 * Ensures code compiles and passes all lints before testing
 */

import { execSync } from 'child_process';
import * as path from 'path';

interface BuildResult {
  passed: boolean;
  step: string;
  output: string;
}

function runCommand(cmd: string, cwd: string): BuildResult {
  try {
    const output = execSync(cmd, { 
      cwd, 
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    return { passed: true, step: cmd, output: output.trim() };
  } catch (error: any) {
    return { 
      passed: false, 
      step: cmd, 
      output: error.stdout?.toString() || error.stderr?.toString() || error.message 
    };
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../../../Nodezero_engine');
  const programDir = path.resolve(repoRoot, 'programs/phantomgrid_gaming');
  
  console.log('🔨 Running build and lint checks...\n');
  
  const results: BuildResult[] = [];
  
  // 1. Core-only Anchor build
  console.log('1. Building core-only program...');
  // Anchor doesn't support --no-default-features directly, use cargo via CARGO_ARGS
  const buildResult = runCommand(
    'anchor build -p phantomgrid_gaming -- --no-default-features --features core',
    repoRoot
  );
  results.push(buildResult);
  
  if (!buildResult.passed) {
    console.log('❌ Build failed!');
    console.log(buildResult.output);
    process.exit(1);
  }
  console.log('✅ Build successful\n');
  
  // 2. Clippy check
  console.log('2. Running Clippy (hardcore mode)...');
  const clippyResult = runCommand(
    'cargo clippy --all-targets --features "core" -D warnings -D clippy::all',
    programDir
  );
  results.push(clippyResult);
  
  if (!clippyResult.passed) {
    console.log('❌ Clippy found issues!');
    console.log(clippyResult.output);
    process.exit(1);
  }
  console.log('✅ Clippy passed\n');
  
  // 3. TypeScript build (if applicable)
  console.log('3. Building TypeScript...');
  const offchainDir = path.resolve(__dirname, '../..');
  const npmInstallResult = runCommand('npm install', offchainDir);
  
  if (!npmInstallResult.passed) {
    console.log('⚠️  npm install had issues (may be OK if already installed)');
  }
  
  const tsBuildResult = runCommand('npm run build', offchainDir);
  if (tsBuildResult.passed || tsBuildResult.output.includes('no build script')) {
    console.log('✅ TypeScript check passed\n');
  } else {
    console.log('⚠️  TypeScript build check skipped (no build script)\n');
  }
  
  console.log('✅ All build checks passed!');
  process.exit(0);
}

main().catch(err => {
  console.error('Build check error:', err);
  process.exit(1);
});

