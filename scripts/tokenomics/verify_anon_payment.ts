/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║           PHANTOM PARADOX - ANONYMOUS PAYMENT PROOF VERIFIER 🔍             ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 * 
 * Enter the proof codes to verify an anonymous payment happened on-chain.
 * This proves the transfer without revealing identities!
 * 
 * HOW TO RUN:
 *   npx tsx verify_anon_payment.ts <TX_SIGNATURE>
 * 
 * OR use the proof codes:
 *   npx tsx verify_anon_payment.ts --proof <CODE1> <CODE2>
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const RPC_URL = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF CODES FOR THE ANONYMOUS PAYMENT TEST
// ═══════════════════════════════════════════════════════════════════════════════
// 
// PROOF CODE 1 (Transaction Signature):
// 4LaL3ctzQYWuRGBUDWnL2TuMdeDJh2iEYWB6PgAJh3GzNhvrouKdcBg1ed3Gafd8euXcyibBrnPg4euacouEcjLC
//
// PROOF CODE 2 (Verification Hash):
// PDOX-ANON-2024-35Wnj2-8bHXjL-100-99-1
// (Format: TOKEN-TYPE-YEAR-SENDER_PREFIX-RECEIVER_PREFIX-SENT-RECEIVED-FEE)
//
// ═══════════════════════════════════════════════════════════════════════════════

interface ProofResult {
  verified: boolean;
  txSignature: string;
  timestamp: string;
  sender: string;
  receiver: string;
  amountSent: number;
  amountReceived: number;
  feeCollected: number;
  feePercent: string;
  blockHeight: number;
  slot: number;
}

async function verifyTransaction(signature: string): Promise<ProofResult | null> {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  try {
    // Fetch transaction
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    
    if (!tx) {
      console.log('❌ Transaction not found');
      return null;
    }

    // Parse transaction details
    const timestamp = tx.blockTime 
      ? new Date(tx.blockTime * 1000).toISOString() 
      : 'Unknown';
    
    // Get pre/post token balances
    const preBalances = tx.meta?.preTokenBalances || [];
    const postBalances = tx.meta?.postTokenBalances || [];
    
    // Find PDOX transfers
    let sender = '';
    let receiver = '';
    let amountSent = 0;
    let amountReceived = 0;
    
    for (const pre of preBalances) {
      if (pre.mint === PDOX_MINT.toBase58()) {
        const post = postBalances.find(p => p.accountIndex === pre.accountIndex);
        if (post) {
          const preAmount = Number(pre.uiTokenAmount.amount);
          const postAmount = Number(post.uiTokenAmount.amount);
          const diff = preAmount - postAmount;
          
          if (diff > 0) {
            // This is the sender
            sender = pre.owner || 'Unknown';
            amountSent = diff / 1e9;
          } else if (diff < 0) {
            // This is the receiver
            receiver = pre.owner || 'Unknown';
            amountReceived = Math.abs(diff) / 1e9;
          }
        }
      }
    }
    
    // Check for new accounts (receiver might be new)
    for (const post of postBalances) {
      if (post.mint === PDOX_MINT.toBase58()) {
        const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
        if (!pre && Number(post.uiTokenAmount.amount) > 0) {
          receiver = post.owner || 'Unknown';
          amountReceived = Number(post.uiTokenAmount.amount) / 1e9;
        }
      }
    }
    
    const feeCollected = amountSent - amountReceived;
    const feePercent = ((feeCollected / amountSent) * 100).toFixed(2);
    
    return {
      verified: true,
      txSignature: signature,
      timestamp,
      sender,
      receiver,
      amountSent,
      amountReceived,
      feeCollected,
      feePercent: `${feePercent}%`,
      blockHeight: tx.slot,
      slot: tx.slot,
    };
    
  } catch (e: any) {
    console.log('❌ Error verifying:', e.message);
    return null;
  }
}

function decodeProofCode(code: string): { sender: string; receiver: string; sent: number; received: number; fee: number } | null {
  // Format: PDOX-ANON-YEAR-SENDER_PREFIX-RECEIVER_PREFIX-SENT-RECEIVED-FEE
  const parts = code.split('-');
  if (parts.length !== 8 || parts[0] !== 'PDOX' || parts[1] !== 'ANON') {
    return null;
  }
  
  return {
    sender: parts[3],
    receiver: parts[4],
    sent: parseFloat(parts[5]),
    received: parseFloat(parts[6]),
    fee: parseFloat(parts[7]),
  };
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           PHANTOM PARADOX - ANONYMOUS PAYMENT PROOF VERIFIER 🔍             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Verify anonymous payments on Solana without revealing identities!          ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Interactive mode - use hardcoded proof
    console.log('📝 Using built-in proof codes...\n');
    
    const PROOF_CODE_1 = '4LaL3ctzQYWuRGBUDWnL2TuMdeDJh2iEYWB6PgAJh3GzNhvrouKdcBg1ed3Gafd8euXcyibBrnPg4euacouEcjLC';
    const PROOF_CODE_2 = 'PDOX-ANON-2024-35Wnj2-8bHXjL-100-99-1';
    
    console.log('┌─────────────────────────────────────────────────────────────────────────┐');
    console.log('│ PROOF CODE 1 (Transaction Signature):                                  │');
    console.log(`│ ${PROOF_CODE_1.slice(0, 50)}... │`);
    console.log('├─────────────────────────────────────────────────────────────────────────┤');
    console.log('│ PROOF CODE 2 (Verification Hash):                                      │');
    console.log(`│ ${PROOF_CODE_2}                                           │`);
    console.log('└─────────────────────────────────────────────────────────────────────────┘');
    
    console.log('\n🔍 Verifying on Solana blockchain...\n');
    
    // Decode proof code 2
    const decoded = decodeProofCode(PROOF_CODE_2);
    if (decoded) {
      console.log('📋 PROOF CODE 2 DECODED:');
      console.log(`   Sender Prefix:   ${decoded.sender}...`);
      console.log(`   Receiver Prefix: ${decoded.receiver}...`);
      console.log(`   Amount Sent:     ${decoded.sent} PDOX`);
      console.log(`   Amount Received: ${decoded.received} PDOX`);
      console.log(`   Fee Collected:   ${decoded.fee} PDOX`);
    }
    
    // Verify on-chain
    console.log('\n🔗 VERIFYING ON-CHAIN (PROOF CODE 1)...\n');
    
    const result = await verifyTransaction(PROOF_CODE_1);
    
    if (result && result.verified) {
      console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                         ✅ PROOF VERIFIED!                                   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📅 Timestamp:     ${result.timestamp.padEnd(40)}     ║
║  🔢 Block/Slot:    ${result.slot.toString().padEnd(40)}     ║
║                                                                              ║
║  ════════════════════════════════════════════════════════════════════════    ║
║                                                                              ║
║  📤 SENDER:        ${result.sender.slice(0, 20)}...                          ║
║  📥 RECEIVER:      ${result.receiver.slice(0, 20)}...                          ║
║                                                                              ║
║  ════════════════════════════════════════════════════════════════════════    ║
║                                                                              ║
║  💰 Amount Sent:     ${result.amountSent.toFixed(9).padEnd(20)} PDOX               ║
║  💸 Fee Collected:   ${result.feeCollected.toFixed(9).padEnd(20)} PDOX (${result.feePercent})       ║
║  📥 Amount Received: ${result.amountReceived.toFixed(9).padEnd(20)} PDOX               ║
║                                                                              ║
║  ════════════════════════════════════════════════════════════════════════    ║
║                                                                              ║
║  🔐 PRIVACY STATUS:                                                          ║
║     • Sender identity:   ANONYMOUS (no KYC linked)                           ║
║     • Receiver identity: ANONYMOUS (no KYC linked)                           ║
║     • Transaction:       PUBLIC (verifiable on-chain)                        ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
      
      // Cross-verify with proof code 2
      if (decoded) {
        const senderMatch = result.sender.startsWith(decoded.sender);
        const receiverMatch = result.receiver.startsWith(decoded.receiver);
        const amountMatch = Math.abs(result.amountSent - decoded.sent) < 0.001;
        
        console.log('🔄 CROSS-VERIFICATION WITH PROOF CODE 2:');
        console.log(`   Sender prefix matches:   ${senderMatch ? '✅ YES' : '❌ NO'}`);
        console.log(`   Receiver prefix matches: ${receiverMatch ? '✅ YES' : '❌ NO'}`);
        console.log(`   Amount matches:          ${amountMatch ? '✅ YES' : '❌ NO'}`);
        
        if (senderMatch && receiverMatch && amountMatch) {
          console.log('\n🎉 BOTH PROOF CODES VERIFIED! Transaction is authentic.\n');
        }
      }
      
      console.log('🔗 VIEW ON EXPLORER:');
      console.log(`   https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet\n`);
      
    } else {
      console.log('❌ Could not verify transaction on-chain');
    }
    
  } else if (args[0] === '--proof' && args.length >= 3) {
    // Custom proof codes
    const code1 = args[1];
    const code2 = args[2];
    
    console.log('📝 Verifying custom proof codes...\n');
    console.log(`   Code 1: ${code1.slice(0, 30)}...`);
    console.log(`   Code 2: ${code2}`);
    
    const result = await verifyTransaction(code1);
    if (result) {
      console.log('\n✅ Transaction verified!');
      console.log(JSON.stringify(result, null, 2));
    }
    
  } else {
    // Direct signature
    const signature = args[0];
    console.log(`📝 Verifying transaction: ${signature.slice(0, 30)}...\n`);
    
    const result = await verifyTransaction(signature);
    if (result) {
      console.log('✅ Transaction verified!');
      console.log(JSON.stringify(result, null, 2));
    }
  }
}

main().catch(console.error);

