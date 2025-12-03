import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FIXED: Use correct path
const LIB_PATH = path.join(__dirname, 'programs/phantomgrid_gaming/src/lib.rs');

const LOGIC_NETTING = `
    // 1. COLLECT PROTOCOL FEE (π-Standard)
    // The engine calculates the fee based on Chaos/Entropy. We sweep it here.
    if pi_fee > 0 {
        // Transfer from Vault -> Treasury
        // Simple accounting update (Gas efficient)
        ctx.accounts.config.protocol_fees_accumulated = ctx.accounts.config.protocol_fees_accumulated
            .checked_add(pi_fee).ok_or(PgError::Overflow)?;
    }

    // 2. EXECUTE NETTING (The Muscle)
    for delta in cash_deltas.iter() {
        // Find the correct account (Manual Graph Loading)
        let account_info = ctx.remaining_accounts.iter()
            .find(|acc| {
                // Try to deserialize as PlayerLedger and check authority
                if let Ok(mut ledger_data) = acc.try_borrow_data() {
                    if let Ok(ledger) = PlayerLedger::try_deserialize(&mut &ledger_data[..]) {
                        return ledger.authority == delta.owner;
                    }
                }
                false
            })
            .ok_or(PgError::InvalidAmount)?;
            
        let mut ledger_data = account_info.try_borrow_mut_data()?;
        let mut ledger = PlayerLedger::try_deserialize(&mut &ledger_data[..])?;

        if delta.delta_lamports > 0 {
            // Credit
            ledger.available = ledger.available.checked_add(delta.delta_lamports as u64).ok_or(PgError::Overflow)?;
        } else if delta.delta_lamports < 0 {
            // Debit
            let debit = delta.delta_lamports.abs() as u64;
            require!(ledger.available >= debit, PgError::InsufficientCredits);
            ledger.available = ledger.available.checked_sub(debit).ok_or(PgError::Overflow)?;
        }
        
        // Write back
        let mut writer = &mut ledger_data[..];
        ledger.try_serialize(&mut writer)?;
    }
`;

const LOGIC_ZK = `
    // ZK Verification (Keccak256)
    let mut current_hash = *leaf;
    for sibling in proof.iter() {
        let combined = if current_hash <= *sibling {
            [current_hash.as_ref(), sibling.as_ref()].concat()
        } else {
            [sibling.as_ref(), current_hash.as_ref()].concat()
        };
        let hash_result = anchor_lang::solana_program::keccak::hash(&combined);
        current_hash = hash_result.to_bytes();
    }
    require!(current_hash == *root, PgError::InvalidMerkleProof);
    Ok(())
`;

function main() {
    console.log('⚠️  WARNING: This script will modify lib.rs');
    console.log('⚠️  Most of this logic is already implemented!');
    console.log('⚠️  Proceeding anyway...\n');
    
    let content = fs.readFileSync(LIB_PATH, 'utf-8');

    // 1. Upgrade settle_net_batch Signature (Add pi_fee)
    const oldSignature = /pub fn settle_net_batch\s*\([\s\S]*?royalty_distribution: Vec<\(Pubkey, u64\)>,\s*\) -> Result<\(\)> \{/;
    const newSignature = `pub fn settle_net_batch(
        ctx: Context<SettleNetBatch>,
        batch_id: u64,
        batch_hash: [u8; 32], // Hash of batch for auditability (computed off-chain)
        items: Vec<SettledItemData>,
        cash_deltas: Vec<NetDeltaData>,
        royalty_distribution: Vec<(Pubkey, u64)>, // (agent_id, royalty_lamports)
        pi_fee: u64, // π-Standard protocol fee
    ) -> Result<()> {`;
    
    if (oldSignature.test(content)) {
        content = content.replace(oldSignature, newSignature);
        console.log('✅ Updated settle_net_batch signature to include pi_fee');
    } else {
        console.log('⚠️  Could not find exact signature match - may already be modified');
    }

    // 2. Inject Netting Logic (replace the TODO section)
    const nettingPattern = /\/\/ Process cash deltas[\s\S]*?\/\/ 1\. Process Cash Deltas \(The "Netting" Muscle\)[\s\S]*?ledger\.try_serialize\(&mut writer\)\?;/;
    if (nettingPattern.test(content)) {
        // Find the section and replace with enhanced version
        const beforeNetting = content.indexOf('// Process cash deltas');
        const afterNetting = content.indexOf('// ======================================================================', content.indexOf('// ROYALTY DISTRIBUTION'));
        
        if (beforeNetting !== -1 && afterNetting !== -1) {
            const before = content.substring(0, beforeNetting);
            const after = content.substring(afterNetting);
            content = before + LOGIC_NETTING + '\n\n        ' + after;
            console.log('✅ Injected enhanced netting logic with pi_fee');
        }
    } else {
        console.log('⚠️  Could not find netting section to replace');
    }

    // 3. ZK Logic is already implemented in verify_merkle_proof() - skip
    console.log('ℹ️  ZK verification already exists in verify_merkle_proof() - skipping');

    // 4. Marketplace already exists - skip
    console.log('ℹ️  AgentRegistry already exists in instructions/marketplace.rs - skipping');

    // Write back
    fs.writeFileSync(LIB_PATH, content);
    console.log('\n✅ LOGIC INJECTED: Netting + Fees enhanced.');
    console.log('⚠️  NOTE: You must update off-chain code to pass pi_fee parameter!');
}

main();

