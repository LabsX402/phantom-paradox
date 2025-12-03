# 🔐 AGENT MEMO: PHANTOM PARADOX

**READ THIS + RULES.md BEFORE ANY WORK**

---

## WHAT IS PHANTOM PARADOX?

A **hyper-scale, privacy-preserving payment and gaming marketplace** on Solana that combines:
- **CEX-like speed** (instant soft-state, <500ms)
- **DeFi self-custody** (user owns funds, on-chain vaults)
- **Mixer-like privacy** (batch settlement, ghost traffic)
- **Economic self-defense** (dynamic fees, LP protection)

**NOT** just a mixer. It's a full marketplace + payment rail + gaming infrastructure.

---

## CORE TECH STACK

### On-Chain (Rust/Anchor)
- **Program ID:** `2R6Lus9psfB2dREDuC79ayfwd4peVfqG3Q42ca2iFhNV`
- **Location:** `programs/phantomgrid_gaming/src/lib.rs`
- **Size:** ~6500 lines, 1.25MB compiled

### Off-Chain (TypeScript/Node)
- **Location:** `offchain/src/`
- **Services:** API, Netting Engine, Listener, Indexer, Sentinel

### Token
- **PDOX Token:** `4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF`
- **Type:** Token-2022 with 3% transfer fee
- **Supply:** 1B

---

## KEY FEATURES (NOT ALL ON LANDING PAGE YET)

### 1. WRAITH NETTING ENGINE
- Batches 1M+ intents into 1 on-chain TX
- O(N) linear netting algorithm
- Graph-based conflict resolution
- **Cost:** $0.00001 per intent (vs $0.10-$1 for traditional ZK)

### 2. TEMPORAL PARADOX (Soft/Hard Confirmation)
- **Soft State:** User sees funds INSTANTLY (off-chain)
- **Hard State:** On-chain confirmation follows
- Money appears in receiver wallet BEFORE sender tx fully confirms
- If sender double-spends → soft state cancelled, no loss

### 3. SESSION KEYS (Wallet-less Trading)
- User connects Phantom wallet ONCE
- Registers temporary session key (24h, 100 SOL limit)
- Signs intents with session key (no wallet popup)
- **UX:** CEX-like speed with self-custody security

### 4. POLTERGEIST (Ghost Traffic)
- Injects 10+ ghost wallets per batch
- Real trades hidden among fake ones
- Impossible to distinguish signal from noise
- Anonymity set: 1000+ per batch

### 5. HYDRA SHARDS (Rotating PDAs)
- 1000+ BlackMirror vault addresses
- Rotate every epoch (hourly)
- Funds scatter across shards before settlement
- Chainalysis tags old addresses → they're already empty

### 6. BLACKMIRROR VAULT
- LP-funded liquidity pool
- Breaks on-chain link between sender/receiver
- Sender → Intent → Vault → Receiver
- No direct A→B transaction visible

### 7. MERKLE COMPRESSION
- Batch of 1M intents = 1 Merkle root on-chain
- Zero rent (no accounts created)
- DA layer backup (IPFS/Arweave)

### 8. SENTINEL (Solvency Monitor)
- Real-time LP health monitoring
- Pyth oracle price feeds
- Auto-pause on insolvency detection
- Circuit breakers (Armageddon mode)

### 9. ZK PROOF CODES
- Sender gets 2 codes after payment
- CODE 1 (public): encrypted tx details
- CODE 2 (private): decryption key
- Together = proof of payment without blockchain lookup

### 10. AGENT ROYALTIES (AI Agents)
- AI agents can create listings
- Earn 0.05% royalty on volume
- Tracked in netting engine
- Paid out in settlement

---

## SPEED CLAIMS (REAL DATA)

| Scale | Intents | Time | Status |
|-------|---------|------|--------|
| Micro | 10K | <500ms | ✅ TESTED |
| Small | 100K | <2s | ✅ TESTED |
| Medium | 1M | <10s | NEXT |
| Large | 10M | <60s | PENDING |
| XL | 100M | <5min | THEORETICAL |
| Insane | 1B | <30min | THEORETICAL |

---

## COST CLAIMS (REAL DATA)

| Method | Cost/TX | 1000 TXs |
|--------|---------|----------|
| Traditional ZK | $0.10-$1.00 | $100-$1,000 |
| Tornado style | $5-$50 | $5K-$50K |
| Solana direct | $0.00025 | $0.25 (visible) |
| **Phantom Paradox** | **$0.00001** | **$0.01** |

---

## REAL TX PROOFS (DEVNET)

| Test | TX Signature |
|------|--------------|
| Netting Settlement | `5b1MtoyP1BRVn7SgfQtKCTyHDE1mfFD4k1oC8DtJmjnexrSWaBRvxJ1HgP6GYFYwZmzoVNpfwW2cVuLF1HVo9YJo` |
| Anonymous Payment | `32YDUGw5kSsMSJ8KvdAwaAAKxJEA3YLnN8dvjx5DCb6cy49xXPa4NkpAeE5K7y3LDogyiFxSBDBgHcwkhGsxeTvh` |
| Token Transfer | `4LaL3ctzQYWuRGBUDWnL2TuMdeDJh2iEYWB6PgAJh3GzNhvrouKdcBg1ed3Gafd8euXcyibBrnPg4euacouEcjLC` |

---

## ARCHITECTURE FLOW

```
User connects Phantom Wallet
         │
         ▼
    [Session Key Registration]
         │
         ▼
User signs intent with session key (no wallet popup)
         │
         ▼
    ┌────────────────────────────────────┐
    │          WRAITH ENGINE             │
    │  ┌──────────────────────────────┐  │
    │  │ Intent Queue (Redis/DB)      │  │
    │  └──────────────┬───────────────┘  │
    │                 ▼                  │
    │  ┌──────────────────────────────┐  │
    │  │ Poltergeist (Ghost Inject)   │  │
    │  └──────────────┬───────────────┘  │
    │                 ▼                  │
    │  ┌──────────────────────────────┐  │
    │  │ Hydra Shards (1000+ PDAs)    │  │
    │  └──────────────┬───────────────┘  │
    │                 ▼                  │
    │  ┌──────────────────────────────┐  │
    │  │ Netting Engine (Graph)       │  │
    │  └──────────────┬───────────────┘  │
    │                 ▼                  │
    │  ┌──────────────────────────────┐  │
    │  │ Merkle Compression           │  │
    │  └──────────────────────────────┘  │
    └────────────────┬───────────────────┘
                     │
                     ▼
    ┌────────────────────────────────────┐
    │      ON-CHAIN PROGRAM              │
    │  settle_net_batch() / settle_state_root()  │
    │  - Verify batch ID (replay protection)     │
    │  - Apply cash deltas                       │
    │  - Distribute royalties                    │
    │  - Collect protocol fees                   │
    └────────────────────────────────────┘
                     │
                     ▼
    User sees INSTANT result (soft state)
    + On-chain confirmation (hard state)
```

---

## MISSING FROM LANDING PAGE

The current `labsx402.github.io/test` page needs:

1. **Session Keys / Wallet Connect** - "Connect once, trade forever"
2. **Temporal Paradox** - "Money arrives before it's sent"
3. **Nano Payments** - "$0.00001 per transaction"
4. **Agent Royalties** - "AI agents earn 0.05%"
5. **Soft/Hard State** - "Instant UX + on-chain security"
6. **Sentinel Monitoring** - "Real-time solvency checks"
7. **LP Protection** - "Rug-resistant liquidity"
8. **Token-2022** - "3% auto fee on transfers"

---

## KEY FILES

| Purpose | Location |
|---------|----------|
| Main Program | `programs/phantomgrid_gaming/src/lib.rs` |
| Netting Engine | `offchain/src/netting/engine.ts` |
| Fast Netting | `offchain/src/netting/fastGraph.ts` |
| Poltergeist | `offchain/src/netting/poltergeist.ts` |
| Merkle Settlement | `offchain/src/netting/compressedSettlement.ts` |
| Session Keys | `offchain/src/netting/session.ts` |
| Sentinel | `offchain/src/sentinel/sentinel.ts` |
| Hydra Manager | `offchain/src/hydra/manager.ts` |
| API Server | `offchain/src/api/server.ts` |

---

## WHAT TO TELL USERS

**Elevator Pitch:**
> "Phantom Paradox is anonymous payments on Solana. 1M transactions settle in 1 on-chain TX for $0.01 total. Your wallet never touches the receiver's wallet. Untraceable by design."

**Technical Pitch:**
> "Off-chain netting engine batches intents, injects ghost traffic, scatters across 1000+ rotating PDAs, compresses to Merkle root, settles atomically. CEX speed, DeFi custody, mixer privacy."

---

## CURRENT STATUS

- **Network:** Devnet (ready for mainnet)
- **Program:** Deployed & verified
- **Token:** Minted (PDOX)
- **Tests:** Core functionality passing
- **GitHub:** `labsx402.github.io/test` (landing page only)

---

## REMEMBER

1. **Read RULES.md** - No secrets, no IPs, no implementation details
2. **Show WHAT, not HOW** - Features yes, algorithms no
3. **Real data only** - Use actual TX signatures, not made up
4. **Landing page is PUBLIC** - Anyone can see it
5. **Source code is LOCAL** - Never push to GitHub

---

*Last updated: 2025-11-30*

