# ANCHOR FIX LOG - Phantom Paradox

**Purpose:** Track all Anchor program fixes, attempts, and status for future agents/developers.

**Last Updated:** 2025-11-30  
**Current Status:** ✅ BUILD SUCCESSFUL - READY FOR DEPLOYMENT

---

## ✅ RESOLVED ISSUES (Build Date: 2025-11-30)

All stack overflow errors have been **FIXED** using the `Box<Account>` strategy:

| Function | Stack Size | Max Allowed | Exceeded By | Status |
|----------|-----------|-------------|-------------|--------|
| `InitializeHydra` | 4104 | 4096 | 8 bytes | ✅ FIXED |
| `ExecuteCommitment` | 4248 | 4096 | 152 bytes | ✅ FIXED |
| `CreateListing` | 4168 | 4096 | 72 bytes | ✅ FIXED |
| `BuyFixed` | 4664 | 4096 | 568 bytes | ✅ FIXED |
| `FinalizeAuction` | 4712 | 4096 | 616 bytes | ✅ FIXED |
| `buy_fixed` | N/A | N/A | Frame overwrite | ✅ FIXED |
| `finalize_auction_settlement` | 4104 | 4096 | 8+ bytes | ✅ FIXED |

---

## 📋 FIX STRATEGY

### Root Cause
Solana BPF has a **4KB stack limit per function call**. The Anchor account structs with many accounts (especially with `init`, `init_if_needed`, seed derivation, and token constraints) generate large stack frames.

### Solution: Box Large Accounts
Use `Box<Account<'info, T>>` to move large account data to the heap instead of stack:

```rust
// BEFORE (stack allocated):
pub config: Account<'info, GlobalConfig>,

// AFTER (heap allocated):
pub config: Box<Account<'info, GlobalConfig>>,
```

### Files to Modify
1. `programs/phantomgrid_gaming/src/lib.rs` - BuyFixed, CreateListing, FinalizeAuction
2. `programs/phantomgrid_gaming/src/instructions/hydra.rs` - InitializeHydra, ExecuteCommitment

---

## 📝 FIX ATTEMPTS LOG

### Attempt 1: 2025-11-30 - Box Account Strategy ✅ SUCCESS
**Agent:** Claude Opus 4.5  
**Approach:** Add `Box<>` wrapper to large accounts in problematic structs  
**Status:** ✅ COMPLETE

**Changes Made:**
1. ✅ Create this fix log document
2. ✅ Fix `InitializeHydra` - Boxed `hydra_index` and `commitment_queue`
3. ✅ Fix `ExecuteCommitment` - Boxed `hydra_index`, `commitment_queue`, `hydra_shard`
4. ✅ Fix `CreateListing` - Boxed `config`, `game`, `seller_ledger`, `listing`
5. ✅ Fix `BuyFixed` - Boxed `config`, `game`, `listing`, `buyer_ledger`, `seller_ledger`, `royalty_recipient_ledger`
6. ✅ Fix `FinalizeAuction` - Boxed `config`, `game`, `listing`, `winner_ledger`, `seller_ledger`, `royalty_recipient_ledger`
7. ✅ Verify clean build with no stack errors

**Result:** ✅ SUCCESS - Build completed with no stack overflow errors!

**Files Modified:**
- `programs/phantomgrid_gaming/src/instructions/hydra.rs` - Lines 307-330 (InitializeHydra), 538-588 (ExecuteCommitment)
- `programs/phantomgrid_gaming/src/lib.rs` - Lines 6868-6925 (CreateListing), 7088-7157 (BuyFixed), 7159-7231 (FinalizeAuction)

---

## 🔧 DETAILED FIX INSTRUCTIONS

### Fix #1: InitializeHydra (hydra.rs)
Location: `programs/phantomgrid_gaming/src/instructions/hydra.rs:307-330`

**Current:**
```rust
pub struct InitializeHydra<'info> {
    pub hydra_index: Account<'info, HydraIndex>,
    pub commitment_queue: Account<'info, CommitmentQueue>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**Fix:** Box both init accounts (they have largest space requirements)

### Fix #2: ExecuteCommitment (hydra.rs)
Location: `programs/phantomgrid_gaming/src/instructions/hydra.rs:538-588`

**Current:** 8 accounts with token operations  
**Fix:** Box `hydra_index`, `commitment_queue`, `hydra_shard`, token accounts

### Fix #3: CreateListing (lib.rs)
Location: `programs/phantomgrid_gaming/src/lib.rs:6868-6925`

**Current:** 12 accounts with init operations  
**Fix:** Box `config`, `game`, `seller_ledger`, `listing`

### Fix #4: BuyFixed (lib.rs)
Location: `programs/phantomgrid_gaming/src/lib.rs:7088-7157`

**Current:** 11 accounts with init_if_needed  
**Fix:** Box `config`, `game`, `listing`, `buyer_ledger`, `seller_ledger`, `royalty_recipient_ledger`

### Fix #5: FinalizeAuction (lib.rs)
Location: `programs/phantomgrid_gaming/src/lib.rs:7159-7231`

**Current:** 13 accounts with init_if_needed  
**Fix:** Box `config`, `game`, `listing`, `winner_ledger`, `seller_ledger`, `royalty_recipient_ledger`

---

## ⚠️ IMPORTANT NOTES FOR FUTURE AGENTS

1. **DO NOT deploy with stack overflow errors** - These cause undefined behavior at runtime!
2. **The build exits with code 0** but shows errors - This is misleading, the program will fail!
3. **Box accounts change access syntax** - Use `ctx.accounts.config.as_ref()` instead of direct access
4. **InterfaceAccount cannot be boxed directly** - May need different approach for token accounts
5. **Test after each fix** - Run `anchor build` and check for remaining errors

---

## 🎯 VERIFICATION CHECKLIST

After applying fixes, verify:
- [x] `anchor build` completes with NO stack overflow errors ✅ (2025-11-30)
- [x] All 5 problematic structs are fixed ✅ (2025-11-30)
- [x] No new compilation errors introduced ✅ (2025-11-30)
- [x] Deployed to devnet ✅ (2025-11-30) - Program ID: `oMBTXLR4ZdxKHi17vEMrh8Kdt9gDYdPPqA7NBkaY9vq`

---

## 📚 REFERENCE

### Solana Stack Limit
- BPF stack limit: 4096 bytes per call frame
- Exceeding this causes undefined behavior (not a compile error!)
- Use `Box<>` to move large data to heap

### Anchor Boxing Pattern
```rust
#[derive(Accounts)]
pub struct MyInstruction<'info> {
    #[account(mut)]
    pub large_account: Box<Account<'info, LargeStruct>>,
}
```

### Accessing Boxed Accounts
```rust
// In handler function:
let account = &ctx.accounts.large_account;  // Auto-derefs
// OR
let account = ctx.accounts.large_account.as_ref();
```

---

## 🔄 DEPLOYMENT HISTORY

| Date | Version | Network | Status | TX/Program ID |
|------|---------|---------|--------|--------------|
| Previous | v2.0.0 | Devnet | CLOSED | `8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x` |
| 2025-11-30 | v2.0.1 | Devnet | CLOSED | `oMBTXLR4ZdxKHi17vEMrh8Kdt9gDYdPPqA7NBkaY9vq` |
| 2025-11-30 | v2.0.2 | Devnet | CLOSED | `2R6Lus9psfB2dREDuC79ayfwd4peVfqG3Q42ca2iFhNV` |
| 2025-11-30 | **v3.0.0** | Devnet | ✅ **LIVE + IDL** | `7j4qvD77zadbvrKYmahMQbFS5f8tEseW9kj62LYuWmer` |

**Deploy TX:** `22nA19rTqfatoNCvMWR3vUf44u7yQc4jsYcCoG47eXEcGP8wQsGAEpL4KQq6cF6kEP387XEX8iJKuE1xX7FgRvAK`
**IDL Account:** `FDnuHMzje5EsyWqJUiTScbUJwBfQUgmD5B6VKG1qC5xS`

---

## 🏊 LP POOL HISTORY

| Date | Platform | Pool ID | TX | Status |
|------|----------|---------|----|----|
| 2025-11-30 | Meteora DLMM | N/A | N/A | ❌ Token-2022 not supported on devnet |
| 2025-11-30 | Raydium CLMM (v1) | `3kScidMNvzT6m5bXn8VwEP3CrzdA57DngzpDDbSn9Jvc` | `4aUcFMrFJBxainDaGwUUYg6YtX4zBrvKkEgN6Mcf4jRxo16GZQWR7A485vMRXuNEtJVFZEYTijrqywHtgECCapJX` | ⚠️ OLD TOKEN |
| 2025-11-30 | **Raydium CLMM (v2)** | `DKdARvMSzUaFhRELRxe323xQvohqdVGnHHbtr8CbPSDU` | `36Ph82ypNrqDRPhcDegez35HX2Aej2LsviR4jWYnt6a6WiirdBkyiw7xuUKLGmbs27m1Z8DFYVPLRDXhGSjGN3CJ` | ✅ **ACTIVE** |

**Pool V2 Details (Current):**
- Pool ID: `DKdARvMSzUaFhRELRxe323xQvohqdVGnHHbtr8CbPSDU`
- SOL Vault: `2vaGXhZgyvJgWbUptZ5vp1qHw6TFxXM5xwGTcRPeieag`
- PDOX Vault: `CneDEaEB25Wv1LSGtixCfji3AwKVGXgp3HuKUaoZbi2C`
- Pair: SOL/PDOX V2 (Token-2022)
- PDOX V2 Mint: `5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B`
- Price: 1 SOL = 1,000,000 PDOX
- Fee: 0.25%
- Tick Spacing: 64
- Program: Raydium CLMM Devnet (`devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH`)

**Note:** Pool V1 used old token with incorrect 1B pre-minted supply. Pool V2 uses correct PDOX V2 token with 10M initial supply.

---

## 📞 HANDOFF NOTES

If you're a new agent picking this up:

1. **Read this entire document first**
2. **Check the "Current Blockers" section** for what needs fixing
3. **Look at "Fix Attempts Log"** to see what's been tried
4. **Follow the "Detailed Fix Instructions"** 
5. **Update this document** as you make progress
6. **Document what DIDN'T work** so others don't repeat mistakes

---

*This document is the single source of truth for Anchor fixes.*

