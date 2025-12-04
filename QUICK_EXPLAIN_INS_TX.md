# Quick Explanation: INS vs TX (30 seconds)

## The Simple Answer

**INS (Intents)** = User requests (off-chain)  
**TX (Transactions)** = On-chain settlements (batched)

**Why batch?** 1000 intents → 1 transaction = 1000x cheaper & faster

---

## The Analogy

**Traditional:** Each payment = 1 transaction = $0.0005 fee  
**Our System:** 1000 payments = 1 batch = $0.0005 total fee

Like a bank clearing checks at end of day instead of one-by-one.

---

## The Flow

```
1. Users submit intents (off-chain, free, instant)
   ↓
2. Netting engine collects & processes (cancels out intermediate trades)
   ↓
3. Batch settlement (1 transaction for 1000+ intents)
```

---

## Key Benefits

- 💰 **1000x cheaper** - Batch vs individual
- ⚡ **1000x faster** - Parallel processing
- 🔒 **More private** - Statistical mixing
- 📈 **Unlimited scale** - Off-chain processing

---

## Real Example

**10,000 users want to pay:**
- ❌ Without batching: 10,000 transactions = $5.00, 66 minutes
- ✅ With batching: 1 transaction = $0.0005, 0.5 seconds

---

## Technical (One Sentence)

Intents are signed off-chain messages that get netted together and settled in batches on-chain using Merkle compression.

---

**Full explanation:** See `EXPLAIN_INS_VS_TX.md`

