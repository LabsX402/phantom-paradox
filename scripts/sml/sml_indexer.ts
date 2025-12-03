/**
 * SML DATA INDEXER
 * ================
 * 
 * Indexes on-chain SmlTrainingRecord accounts and exports to JSON
 * for Python ML training pipeline.
 * 
 * Flow:
 * 1. Fetch all SmlTrainingRecord accounts from Solana
 * 2. Parse and validate data
 * 3. Export to training_data.json
 * 4. Trigger Python training pipeline
 */

import {
  Connection,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Program ID (update with actual deployed program ID)
const PROGRAM_ID = new PublicKey('PhNT0MPRD0X0000000000000000000000000000000');

// Account discriminators (first 8 bytes of sha256("account:AccountName"))
const SML_TRAINING_RECORD_DISCRIMINATOR = Buffer.from([
  // Calculate from: sha256("account:SmlTrainingRecord")[0:8]
  0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0
]);

interface SmlTrainingData {
  case_id: string;
  job_category: number;
  dispute_category: number;
  amount_tier: number;
  evidence_quality_a: number;
  evidence_quality_b: number;
  response_time_a: number;
  response_time_b: number;
  prior_disputes_a: number;
  prior_disputes_b: number;
  votes: boolean[];
  confidences: number[];
  final_verdict: number;
  auto_resolved: boolean;
  consensus_strength: number;
}

async function fetchSmlTrainingRecords(connection: Connection): Promise<SmlTrainingData[]> {
  console.log('📥 Fetching SML training records from Solana...');
  
  // Fetch all program accounts
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      // Filter by account discriminator (first 8 bytes)
      {
        memcmp: {
          offset: 0,
          bytes: SML_TRAINING_RECORD_DISCRIMINATOR.toString('base64'),
        },
      },
    ],
  });
  
  console.log(`   Found ${accounts.length} SML training records`);
  
  const trainingData: SmlTrainingData[] = [];
  
  for (const { pubkey, account } of accounts) {
    try {
      // Parse account data (skip 8-byte discriminator)
      const data = account.data.slice(8);
      
      // Parse fields (adjust offsets based on actual struct layout)
      const record: SmlTrainingData = {
        case_id: pubkey.toBase58(),
        job_category: data.readUInt16LE(32), // After case pubkey
        dispute_category: data.readUInt8(34),
        amount_tier: data.readUInt8(35),
        evidence_quality_a: data.readUInt8(36),
        evidence_quality_b: data.readUInt8(37),
        response_time_a: data.readUInt16LE(38),
        response_time_b: data.readUInt16LE(40),
        prior_disputes_a: data.readUInt8(42),
        prior_disputes_b: data.readUInt8(43),
        votes: Array.from(data.slice(44, 54)).map(v => v === 1),
        confidences: Array.from(data.slice(54, 64)),
        final_verdict: data.readUInt8(64),
        auto_resolved: data.readUInt8(65) === 1,
        consensus_strength: data.readUInt8(66),
      };
      
      trainingData.push(record);
    } catch (e) {
      console.log(`   ⚠️ Failed to parse record ${pubkey.toBase58()}: ${e}`);
    }
  }
  
  return trainingData;
}

async function exportTrainingData(data: SmlTrainingData[], outputPath: string) {
  console.log(`💾 Exporting ${data.length} records to ${outputPath}...`);
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log('   ✅ Export complete');
}

async function triggerTraining(dataPath: string) {
  console.log('🧠 Triggering SML training pipeline...');
  
  try {
    // Run Python training script
    const result = execSync(`python dispute_sml_model.py --train ${dataPath}`, {
      encoding: 'utf-8',
      cwd: __dirname,
    });
    console.log(result);
  } catch (e) {
    console.log(`   ⚠️ Training failed: ${e}`);
  }
}

// ============================================================================
// MOCK DATA FOR TESTING (before on-chain deployment)
// ============================================================================

function generateMockTrainingData(count: number): SmlTrainingData[] {
  const data: SmlTrainingData[] = [];
  
  for (let i = 0; i < count; i++) {
    const evidenceA = Math.floor(Math.random() * 80) + 20;
    const evidenceB = Math.floor(Math.random() * 80) + 20;
    
    // Simulate realistic verdict correlation
    let verdict: number;
    if (evidenceA > evidenceB + 30) {
      verdict = 1; // Party A wins
    } else if (evidenceB > evidenceA + 30) {
      verdict = 2; // Party B wins
    } else {
      verdict = Math.random() > 0.5 ? 3 : (Math.random() > 0.5 ? 4 : 5); // Split/Partial
    }
    
    data.push({
      case_id: `mock_case_${i}`,
      job_category: Math.floor(Math.random() * 20),
      dispute_category: Math.floor(Math.random() * 8),
      amount_tier: Math.floor(Math.random() * 5),
      evidence_quality_a: evidenceA,
      evidence_quality_b: evidenceB,
      response_time_a: Math.floor(Math.random() * 72) + 1,
      response_time_b: Math.floor(Math.random() * 72) + 1,
      prior_disputes_a: Math.floor(Math.random() * 5),
      prior_disputes_b: Math.floor(Math.random() * 5),
      votes: Array.from({ length: 10 }, () => Math.random() > 0.5),
      confidences: Array.from({ length: 10 }, () => Math.floor(Math.random() * 50) + 50),
      final_verdict: verdict,
      auto_resolved: Math.random() > 0.3,
      consensus_strength: Math.floor(Math.random() * 40) + 60,
    });
  }
  
  return data;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('=' .repeat(60));
  console.log('SML DATA INDEXER');
  console.log('=' .repeat(60));
  
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const outputPath = process.env.OUTPUT_PATH || 'training_data.json';
  const useMock = process.env.USE_MOCK === 'true' || true; // Default to mock for testing
  
  console.log(`\nRPC: ${rpcUrl}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Mode: ${useMock ? 'MOCK DATA' : 'ON-CHAIN'}`);
  
  let trainingData: SmlTrainingData[];
  
  if (useMock) {
    // Generate mock data for testing
    console.log('\n📊 Generating mock training data...');
    trainingData = generateMockTrainingData(500);
    console.log(`   Generated ${trainingData.length} mock records`);
  } else {
    // Fetch real data from Solana
    const connection = new Connection(rpcUrl, 'confirmed');
    trainingData = await fetchSmlTrainingRecords(connection);
  }
  
  // Export data
  await exportTrainingData(trainingData, outputPath);
  
  // Trigger training (optional)
  if (process.env.AUTO_TRAIN === 'true') {
    await triggerTraining(outputPath);
  }
  
  console.log('\n✅ Indexer complete!');
  console.log(`   Records: ${trainingData.length}`);
  console.log(`   Output: ${outputPath}`);
}

main().catch(console.error);

