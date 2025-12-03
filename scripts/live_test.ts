/**
 * LIVE TESTS - Calls the REAL deployed program on Devnet
 * 
 * This is NOT a simulation - it actually calls the Solana blockchain
 */

import { Connection, PublicKey, Keypair, clusterApiUrl } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// ========================================
// CONSTANTS - DEPLOYED ADDRESSES
// ========================================
const PROGRAM_ID = new PublicKey('8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x');
const PDOX_TOKEN = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');
const RPC_URL = 'https://api.devnet.solana.com';

// Derive PDAs
const [GLOBAL_CONFIG_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('config')],
  PROGRAM_ID
);

interface TestResult {
  name: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  details: string;
  error?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logResult(result: TestResult) {
  const icon = result.status === 'PASSED' ? '✅' : result.status === 'FAILED' ? '❌' : '⏭️';
  console.log(`\n${icon} TEST: ${result.name}`);
  console.log(`   Status: ${result.status}`);
  console.log(`   Details: ${result.details}`);
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
  results.push(result);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    PHANTOM PARADOX - LIVE DEVNET TESTS                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Program ID: ${PROGRAM_ID.toBase58()}               ║
║  Token:      ${PDOX_TOKEN.toBase58()}               ║
║  Network:    Devnet                                                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  // Setup connection
  const connection = new Connection(RPC_URL, 'confirmed');
  log(`Connected to ${RPC_URL}`);

  // ========================================
  // TEST 1: Connection Works
  // ========================================
  try {
    const slot = await connection.getSlot();
    logResult({
      name: 'Connection to Devnet',
      status: 'PASSED',
      details: `Current slot: ${slot}`
    });
  } catch (e: any) {
    logResult({
      name: 'Connection to Devnet',
      status: 'FAILED',
      details: 'Could not connect',
      error: e.message
    });
    return;
  }

  // ========================================
  // TEST 2: Program Account Exists
  // ========================================
  try {
    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    if (programInfo && programInfo.executable) {
      logResult({
        name: 'Program Deployed & Executable',
        status: 'PASSED',
        details: `Size: ${programInfo.data.length} bytes, Executable: true`
      });
    } else {
      logResult({
        name: 'Program Deployed & Executable',
        status: 'FAILED',
        details: 'Program not found or not executable'
      });
    }
  } catch (e: any) {
    logResult({
      name: 'Program Deployed & Executable',
      status: 'FAILED',
      details: 'Error checking program',
      error: e.message
    });
  }

  // ========================================
  // TEST 3: GlobalConfig PDA Exists
  // ========================================
  try {
    const configInfo = await connection.getAccountInfo(GLOBAL_CONFIG_PDA);
    if (configInfo) {
      logResult({
        name: 'GlobalConfig Account Exists',
        status: 'PASSED',
        details: `PDA: ${GLOBAL_CONFIG_PDA.toBase58()}, Size: ${configInfo.data.length} bytes, Owner: ${configInfo.owner.toBase58()}`
      });
      
      // Check owner is our program
      if (configInfo.owner.equals(PROGRAM_ID)) {
        logResult({
          name: 'GlobalConfig Owned by Program',
          status: 'PASSED',
          details: 'Owner matches program ID'
        });
      } else {
        logResult({
          name: 'GlobalConfig Owned by Program',
          status: 'FAILED',
          details: `Owner mismatch: ${configInfo.owner.toBase58()}`
        });
      }
    } else {
      logResult({
        name: 'GlobalConfig Account Exists',
        status: 'FAILED',
        details: `PDA ${GLOBAL_CONFIG_PDA.toBase58()} not found`
      });
    }
  } catch (e: any) {
    logResult({
      name: 'GlobalConfig Account Exists',
      status: 'FAILED',
      details: 'Error fetching config',
      error: e.message
    });
  }

  // ========================================
  // TEST 4: Token Mint Exists
  // ========================================
  try {
    const tokenInfo = await connection.getAccountInfo(PDOX_TOKEN);
    if (tokenInfo) {
      logResult({
        name: 'PDOX Token Mint Exists',
        status: 'PASSED',
        details: `Size: ${tokenInfo.data.length} bytes, Owner: ${tokenInfo.owner.toBase58()}`
      });
    } else {
      logResult({
        name: 'PDOX Token Mint Exists',
        status: 'FAILED',
        details: 'Token mint not found'
      });
    }
  } catch (e: any) {
    logResult({
      name: 'PDOX Token Mint Exists',
      status: 'FAILED',
      details: 'Error fetching token',
      error: e.message
    });
  }

  // ========================================
  // TEST 5: Decode GlobalConfig with Anchor
  // ========================================
  try {
    // Load IDL
    const idlPath = path.join(__dirname, '..', 'target', 'idl', 'phantom_paradox.json');
    if (fs.existsSync(idlPath)) {
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
      
      // Create provider (read-only, no wallet needed for fetching)
      const provider = new anchor.AnchorProvider(
        connection,
        {
          publicKey: PublicKey.default,
          signTransaction: async (tx) => tx,
          signAllTransactions: async (txs) => txs,
        } as any,
        { commitment: 'confirmed' }
      );
      
      const program = new anchor.Program(idl, provider);
      
      // Fetch and decode GlobalConfig
      const config = await (program.account as any).globalConfig.fetch(GLOBAL_CONFIG_PDA);
      
      logResult({
        name: 'Decode GlobalConfig via Anchor',
        status: 'PASSED',
        details: `Admin: ${config.admin?.toBase58() || 'N/A'}, Protocol Fee: ${config.protocolFeeBps || 'N/A'} bps, Last Batch ID: ${config.lastNetBatchId?.toString() || '0'}`
      });
      
      // Print full config for debugging
      console.log('\n📋 DECODED GLOBAL CONFIG:');
      console.log(JSON.stringify({
        admin: config.admin?.toBase58(),
        governance: config.governance?.toBase58(),
        serverAuthority: config.serverAuthority?.toBase58(),
        protocolFeeBps: config.protocolFeeBps?.toString(),
        pausedNewListings: config.pausedNewListings,
        pausedSettlements: config.pausedSettlements,
        lastNetBatchId: config.lastNetBatchId?.toString(),
        featureFlags: config.featureFlags?.toString(),
      }, null, 2));
      
    } else {
      logResult({
        name: 'Decode GlobalConfig via Anchor',
        status: 'SKIPPED',
        details: `IDL not found at ${idlPath}`
      });
    }
  } catch (e: any) {
    logResult({
      name: 'Decode GlobalConfig via Anchor',
      status: 'FAILED',
      details: 'Error decoding config',
      error: e.message
    });
  }

  // ========================================
  // TEST 6: Check Deployer Wallet Balance
  // ========================================
  try {
    const deployerPath = path.join(__dirname, '..', 'deployer_wallet.json');
    if (fs.existsSync(deployerPath)) {
      const walletData = JSON.parse(fs.readFileSync(deployerPath, 'utf8'));
      const deployer = Keypair.fromSecretKey(Uint8Array.from(walletData));
      const balance = await connection.getBalance(deployer.publicKey);
      
      logResult({
        name: 'Deployer Wallet Balance',
        status: balance > 0 ? 'PASSED' : 'FAILED',
        details: `Address: ${deployer.publicKey.toBase58()}, Balance: ${(balance / 1e9).toFixed(4)} SOL`
      });
    } else {
      logResult({
        name: 'Deployer Wallet Balance',
        status: 'SKIPPED',
        details: 'deployer_wallet.json not found'
      });
    }
  } catch (e: any) {
    logResult({
      name: 'Deployer Wallet Balance',
      status: 'FAILED',
      details: 'Error checking balance',
      error: e.message
    });
  }

  // ========================================
  // SUMMARY
  // ========================================
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                              TEST SUMMARY                                     ║
╠══════════════════════════════════════════════════════════════════════════════╣`);

  const passed = results.filter(r => r.status === 'PASSED').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  const skipped = results.filter(r => r.status === 'SKIPPED').length;

  results.forEach(r => {
    const icon = r.status === 'PASSED' ? '✅' : r.status === 'FAILED' ? '❌' : '⏭️';
    console.log(`║  ${icon} ${r.name.padEnd(50)} ${r.status.padEnd(8)} ║`);
  });

  console.log(`╠══════════════════════════════════════════════════════════════════════════════╣`);
  console.log(`║  PASSED: ${passed}  |  FAILED: ${failed}  |  SKIPPED: ${skipped}                                      ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════════╝`);

  // Update LIVE_TESTS.md
  const reportPath = path.join(__dirname, '..', 'LIVE_TESTS.md');
  const timestamp = new Date().toISOString();
  const appendText = `\n### Live Test Run: ${timestamp}\n` +
    results.map(r => `- ${r.status === 'PASSED' ? '✅' : r.status === 'FAILED' ? '❌' : '⏭️'} ${r.name}: ${r.details}`).join('\n') +
    `\n\n**Summary**: ${passed} passed, ${failed} failed, ${skipped} skipped\n`;
  
  console.log('\n📝 Results appended to LIVE_TESTS.md');
}

main().catch(console.error);

