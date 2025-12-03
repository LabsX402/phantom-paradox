#!/usr/bin/env ts-node
/**
 * Pre-flight checks before running stress tests
 * Verifies environment, git status, and tool versions
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface PreflightResult {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; message: string }>;
}

function runCommand(cmd: string, cwd?: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, { 
      cwd, 
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    return { success: true, output: output.trim() };
  } catch (error: any) {
    return { success: false, output: error.message || String(error) };
  }
}

function checkGitStatus(): { passed: boolean; message: string } {
  const repoRoot = path.resolve(__dirname, '../../..');
  const result = runCommand('git status --porcelain', repoRoot);
  
  if (!result.success) {
    // Git check is optional - not a blocker if not in a git repo
    return { passed: true, message: 'Git check skipped (not in git repo)' };
  }
  
  if (result.output.trim().length > 0) {
    return { 
      passed: false, 
      message: `Uncommitted changes detected:\n${result.output}` 
    };
  }
  
  return { passed: true, message: 'Git working directory is clean' };
}

function checkSolanaConfig(): { passed: boolean; message: string } {
  const result = runCommand('solana config get');
  if (!result.success) {
    return { passed: false, message: `Solana CLI not found or error: ${result.output}` };
  }
  
  const hasKeypair = result.output.includes('Keypair Path:');
  const hasRpcUrl = result.output.includes('RPC URL:');
  
  if (!hasKeypair || !hasRpcUrl) {
    return { passed: false, message: 'Solana config incomplete. Run: solana config set' };
  }
  
  return { passed: true, message: 'Solana config valid' };
}

function checkAnchorVersion(): { passed: boolean; message: string } {
  const result = runCommand('anchor --version');
  if (!result.success) {
    return { passed: false, message: `Anchor not found: ${result.output}` };
  }
  
  const version = result.output.trim();
  return { passed: true, message: `Anchor version: ${version}` };
}

function checkNodeVersions(): { passed: boolean; message: string } {
  const nodeResult = runCommand('node -v');
  const npmResult = runCommand('npm -v');
  
  if (!nodeResult.success || !npmResult.success) {
    return { 
      passed: false, 
      message: `Node/npm check failed: ${nodeResult.output || npmResult.output}` 
    };
  }
  
  return { 
    passed: true, 
    message: `Node: ${nodeResult.output}, npm: ${npmResult.output}` 
  };
}

function checkEnvFile(): { passed: boolean; message: string } {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) {
    return { 
      passed: true, // Optional - env vars can be set via process.env
      message: '.env file not found (optional - can use process.env)' 
    };
  }
  
  return { passed: true, message: '.env file exists' };
}

async function main() {
  console.log('🔍 Running pre-flight checks...\n');
  
  const checks: Array<{ name: string; passed: boolean; message: string }> = [];
  
  // Git status
  const gitCheck = checkGitStatus();
  checks.push({ name: 'Git Status', ...gitCheck });
  
  // Solana config
  const solanaCheck = checkSolanaConfig();
  checks.push({ name: 'Solana Config', ...solanaCheck });
  
  // Anchor version
  const anchorCheck = checkAnchorVersion();
  checks.push({ name: 'Anchor Version', ...anchorCheck });
  
  // Node/npm versions
  const nodeCheck = checkNodeVersions();
  checks.push({ name: 'Node/npm Versions', ...nodeCheck });
  
  // Env file
  const envCheck = checkEnvFile();
  checks.push({ name: 'Environment File', ...envCheck });
  
  // Print results
  console.log('Results:');
  checks.forEach(check => {
    const icon = check.passed ? '✅' : '❌';
    console.log(`${icon} ${check.name}: ${check.message}`);
  });
  
  const allPassed = checks.every(c => c.passed);
  
  if (allPassed) {
    console.log('\n✅ All pre-flight checks passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some pre-flight checks failed. Fix issues before proceeding.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Pre-flight check error:', err);
  process.exit(1);
});

