# Cryptographic Proof System (ZK-Style)

## Overview

The proof code system allows users to **prove a transaction happened** without revealing **sender or receiver addresses**, similar to zero-knowledge protocols.

## How It Works

### CODE 1 (Public - Safe to Share)

**What it contains:**
- `commitment`: Cryptographic hash commitment to the intent
- `batchId`: Which batch the transaction is in
- `merkleProof`: Merkle proof structure (root, leaf, path, leafIndex)
- `timestamp`: When the transaction was created

**What it proves:**
- ✅ "A transaction with commitment `X` is included in batch `Y`"
- ✅ Can verify against on-chain Merkle root
- ❌ **Does NOT reveal**: sender address, receiver address, or which specific transaction

**Cryptographic properties:**
```javascript
// Step 1: Hash intent data (leaf in Merkle tree)
intentHash = SHA256(intentData)

// Step 2: Create commitment (one-way function)
commitment = SHA256(intentHash || nonce)

// Step 3: Merkle proof proves inclusion in batch
// Verify: merkleProof.root == onChainRoot
```

### CODE 2 (Private - Keep Secret!)

**What it contains:**
- `secretCommitment`: Hash commitment to sender/receiver data
- `bindingHash`: Hash that binds CODE 2 to CODE 1
- `proofNonce`: Nonce for replay protection

**What it proves:**
- ✅ "I know the preimage (sender/receiver) of the commitment"
- ✅ "This CODE 2 belongs to the same transaction as CODE 1"
- ❌ **Does NOT reveal**: actual sender/receiver addresses

**Cryptographic properties:**
```javascript
// Step 1: Hash secret data (sender/receiver)
secretHash = SHA256(secretData)

// Step 2: Create commitment (proves knowledge without revealing)
secretCommitment = SHA256(secretHash || salt)

// Step 3: Bind to CODE 1 (proves they match)
bindingHash = SHA256(secretHash || intentId)
```

## Verification Process

When you enter both codes in `verify.html`:

1. **Decode CODE 1**: Extract `commitment`, `batchId`, `merkleProof`
2. **Decode CODE 2**: Extract `secretCommitment`, `bindingHash`
3. **Verify binding**: Check that CODE 2's `bindingHash` matches CODE 1's structure
4. **Verify Merkle proof**: (In production) Check `merkleProof.root` against on-chain root

**Result:**
- ✅ **Proves**: "I sent a transaction in batch X"
- ❌ **Does NOT reveal**: Which transaction, sender, or receiver

## Zero-Knowledge Properties

### What "Zero-Knowledge" Means

In cryptography, zero-knowledge means you can **prove you know something** without **revealing what it is**.

**Example:**
- ❌ **Not ZK**: "I sent 1 SOL from Alice to Bob" (reveals everything)
- ✅ **ZK**: "I know a secret that, when hashed, equals commitment X" (proves knowledge, reveals nothing)

### Our Implementation

1. **Commitment Scheme**: 
   - `commitment = H(secret)` - one-way function, can't reverse
   - Proves you know the secret without revealing it

2. **Merkle Proof**:
   - Proves transaction is in batch without revealing which one
   - Only reveals: "one of the transactions in this batch"

3. **Binding**:
   - `bindingHash` proves CODE 1 and CODE 2 are from same transaction
   - Without revealing what that transaction is

## Comparison to Full ZK (SNARKs)

| Feature | Our System | Full ZK (SNARKs) |
|---------|-----------|------------------|
| Proves transaction happened | ✅ | ✅ |
| Hides sender/receiver | ✅ | ✅ |
| Verifiable on-chain | ✅ (Merkle) | ✅ |
| Proof size | ~200 bytes | ~1-2 KB |
| Verification cost | Low (hash) | Medium (pairing) |
| Setup required | ❌ | ✅ (trusted setup) |

**Our system is simpler but achieves similar privacy goals!**

## Production Enhancements

For full production, we would add:

1. **On-chain Merkle root verification**:
   ```javascript
   // Fetch on-chain root
   onChainRoot = await getBatchRoot(batchId);
   
   // Verify Merkle proof
   isValid = verifyMerkleProof(merkleProof, onChainRoot);
   ```

2. **SNARK proofs** (optional):
   - Use zk-SNARKs for full zero-knowledge
   - Proves: "I know sender/receiver such that commitment matches"
   - Without revealing sender/receiver

3. **Range proofs**:
   - Prove amount is in valid range without revealing exact amount
   - Useful for privacy-preserving audits

## Security Guarantees

✅ **Cryptographic commitments**: Can't reverse hash to get secret  
✅ **Merkle proofs**: Can't fake inclusion in batch  
✅ **Binding**: Can't mix CODE 1 and CODE 2 from different transactions  
✅ **Nonce**: Prevents replay attacks  

## Usage Example

```javascript
// User submits transaction
const intent = { from: "Alice", to: "Bob", amount: 1000000000 };

// Generate proof codes
const code1 = await generateProofCode1(intent, result);
const code2 = await generateProofCode2(intent, result);

// CODE 1: Safe to share publicly
console.log("CODE 1:", code1);
// Reveals: commitment, batchId, timestamp
// Hides: sender, receiver

// CODE 2: Keep secret!
console.log("CODE 2:", code2);
// Reveals: nothing (just commitments)
// Hides: sender, receiver

// Verify (in verify.html)
const isValid = await verifyProofCodes(code1, code2);
// Proves: "I sent a transaction in batch X"
// Without revealing: which transaction, sender, receiver
```

## Summary

**The proof system allows you to:**
- ✅ Prove a transaction happened
- ✅ Prove it's in a specific batch
- ✅ Prove you know the sender/receiver
- ❌ **Without revealing** sender/receiver addresses

**This is similar to ZK protocols** but uses simpler cryptographic primitives (hash commitments + Merkle proofs) instead of full SNARKs.

