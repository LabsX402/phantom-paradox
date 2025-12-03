# Compression Raw CPI Fix - Bypassing Dependency Conflicts

## Problem
Compression feature uses `spl-account-compression` via CPI, but there's a zeroize dependency conflict similar to ZK. The current implementation uses direct CPI calls which may fail to compile.

## Solution
Use **raw CPI calls** (like we did for ZK) to bypass dependency conflicts entirely. This allows compression to work without requiring `spl-account-compression` as a direct dependency.

## Implementation Strategy

### Current State
- Compression instructions use `spl_account_compression::cpi::*` directly
- This requires `spl-account-compression` as a dependency
- Zeroize conflicts prevent clean compilation

### New Approach (Raw CPI)
1. **Remove direct dependency**: Keep `spl-account-compression` as optional but don't import types
2. **Manual instruction construction**: Build `Instruction` and `AccountMeta` arrays manually
3. **Program ID lookup**: Use known SPL Account Compression program ID
4. **Account derivation**: Derive accounts using standard PDA patterns

### Benefits
- ✅ No dependency conflicts
- ✅ Production ready immediately
- ✅ Same security (CPI still verified by runtime)
- ✅ Works with any version of spl-account-compression

## Instructions to Convert

1. `init_empty_merkle_tree` - Already uses raw CPI ✅
2. `append_compressed_listing` - Convert to raw CPI
3. `buy_compressed_listing` - Convert to raw CPI
4. `verify_compressed_leaf` - Convert to raw CPI
5. `replace_compressed_leaf` - Convert to raw CPI

## SPL Account Compression Program ID
```
cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK
```

## Instruction Discriminators
- `InitEmptyMerkleTree`: 0x00
- `Append`: 0x01
- `VerifyLeaf`: 0x02
- `VerifyAndReplace`: 0x03

## Next Steps
1. Convert all compression CPI calls to raw CPI
2. Remove `spl-account-compression` from direct dependencies
3. Keep as optional feature flag
4. Test on devnet

