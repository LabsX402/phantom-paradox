# GITPAGE_INFO.md — Consolidated Status Document

**Created:** 2025-11-30  
**Purpose:** Single source of truth for token, TestLabs, simulation, and GitHub Pages status

---

## 🌐 GITHUB PAGES

### URLs
| Resource | URL |
|----------|-----|
| **Main Site** | https://labsx402.github.io/test |
| **Simulation** | https://labsx402.github.io/test/docs/sim.html |
| **TestLabs** | https://labsx402.github.io/test/docs/test.html |
| **Token Docs** | https://labsx402.github.io/test/docs/token.html |
| **Repository** | https://github.com/LabsX402/test (private) |

### Live Pages

| Page | File | Purpose | Status |
|------|------|---------|--------|
| Landing | `index.html` | Main hero, devnet ticker, benchmarks | ✅ LIVE |
| Simulation | `docs/sim.html` | 24/7 PDOX/SOL trading simulation | ✅ LIVE |
| TestLabs | `docs/test.html` | Compression, netting, anonymity tests | ✅ LIVE |
| Token Docs | `docs/token.html` | Degen-friendly token explainer | ✅ LIVE |
| API | `docs/api.html` | AI-friendly verification endpoints | ✅ LIVE |
| Anonymity | `docs/anonymity.html` | Layer explainer | ✅ LIVE |
| Compression | `docs/compression.html` | Merkle tree explainer | ✅ LIVE |
| Compare | `docs/compare.html` | ZK comparison table | ✅ LIVE |
| Verify | `docs/verify.html` | TX verification guide | ✅ LIVE |

---

## 🪙 PDOX TOKEN SPECIFICATIONS

### Core Info
| Property | Value |
|----------|-------|
| **Name** | PDOX (Paradox Token) |
| **Standard** | Solana Token-2022 |
| **Mint** | `4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF` |
| **Decimals** | 9 |
| **Hard Cap** | 1,000,000,000 (1B) |
| **Transfer Fee** | 3% (descending to 1% over time) |

### Initial LP Configuration
| Parameter | Value |
|-----------|-------|
| **Starting SOL** | 5 SOL (~$680) |
| **Starting PDOX** | 10,000,000 (1% of supply) |
| **Initial Price** | $0.000068 per PDOX |
| **Starting MC** | ~$68,000 |
| **LP Platform** | Meteora DLMM (simulation only - devnet doesn't support Token-2022) |

### Token Distribution (Mint-as-you-go)
| Allocation | % | Amount | Status |
|------------|---|--------|--------|
| LP (circulating) | 1% | 10M | ✅ At TGE |
| Dev Team | 3% | 30M cap | 🔒 Vests slowly from 0 |
| DAO Treasury | 5% | 50M cap | 🔒 Vests slowly from 0 |
| Future LP Growth | ~91% | — | 🔄 Minted as SOL accumulates |

### Fee Distribution
| Destination | Normal Mode | DEFCON Mode |
|-------------|-------------|-------------|
| LP Growth | 70% | 80-90% |
| Burn | 15% | 5-10% |
| Treasury | 15% | 5-10% |

### LP Growth Mechanism (CORRECT LOGIC)
```
1. BUY trade → fee in PDOX → burn/treasury portions
2. SELL trade → fee in SOL → accumulates in vault
3. Vault threshold reached → mint matching PDOX at ratio
4. Add BOTH SOL + PDOX to LP → ratio maintained!
5. LP value can only INCREASE (no dilution)
```

### Armageddon Defense System
| Level | Trigger | Response |
|-------|---------|----------|
| DEFCON-3 | LP drops 50% from peak | 80% fees → LP |
| DEFCON-2 | LP drops 75% from peak | 85% fees → LP |
| DEFCON-1 | LP drops 90% from peak | 90% fees → LP (MAX) |

### LP Lock (Progressive Timelock)
| Phase | Duration | Notice Required |
|-------|----------|-----------------|
| Phase 1 | 0-3 days | 12 hours |
| Phase 2 | 3-15 days | 15 days |
| Phase 3 | 15+ days | 30 days |

Features:
- Snapshot before any withdrawal announcement
- Holder balances recorded
- Can restore from snapshot if relaunch needed

---

## 🧪 TESTLABS STATUS

### Compression Test
| Feature | Status | Notes |
|---------|--------|-------|
| Upload JSON intents | ✅ Done | User provides their own file |
| Compute Merkle root | ✅ Done | SHA-256 in browser |
| Batch size recommendation | ✅ Done | Suggests optimal batches |
| Verification code | ✅ Done | JS snippet for local verify |

### Netting Test
| Feature | Status | Notes |
|---------|--------|-------|
| Input sample transfers | ✅ Done | Random or user-defined |
| Compute net positions | ✅ Done | Shows reduction % |
| Settlement simulation | ✅ Done | Before/after comparison |

### Anonymity Test
| Feature | Status | Notes |
|---------|--------|-------|
| Tier selection | ✅ Done | STANDARD/MAX/PARADOX |
| Ghost injection sim | ✅ Done | Visual layers |
| Trace attempt sim | ✅ Done | Shows why tracing fails |
| Probability math | ✅ Done | 1-(1/set_size) formula |

### Cost Calculator
| Feature | Status | Notes |
|---------|--------|-------|
| Batch size input | ✅ Done | 1-1M intents |
| Per-TX cost | ✅ Done | Comparison with ZK |
| Total cost | ✅ Done | Shows savings |

### On-Chain Proofs
| TX Type | Status | Notes |
|---------|--------|-------|
| Program Deployment | ✅ Fresh TX | Nov 30, 2025 |
| PDOX Token Mint | ✅ Fresh TX | Nov 30, 2025 |
| Batch Netting | ✅ Fresh TX | Nov 30, 2025 |
| Anonymous Payment | ✅ Fresh TX | Nov 30, 2025 |

### What's NOT Real (Demo Only)
- Wallet connect is READ-ONLY simulation
- BlackMirror transfer is simulation (no real TX sent)
- All "DEMO" tagged modules are client-side only

---

## 📊 SIMULATION STATUS

### Current Configuration
| Setting | Value |
|---------|-------|
| Initial SOL | 5 |
| Initial PDOX | 10,000,000 |
| SOL Price | $136 |
| Fee Rate | 3% (300 bps) |
| Max Trade | 5% of pool |
| LP Floor | 5 SOL (initial - can never go below) |

### Features ✅ Done
- [x] Constant product AMM (x*y=k)
- [x] Real-time price chart
- [x] Live trades list
- [x] Events log
- [x] Market stats (MC, LP value, volume)
- [x] Token supply tracking (minted, burned, vested)
- [x] Fee vault display (SOL pending injection)
- [x] "Held by Traders" display
- [x] User-injected events (HYPE 1-5, FUD 1-5)
- [x] Event queue with cooldowns
- [x] Armageddon detection & panel
- [x] Armageddon tab with history
- [x] Chart timeframes (10s to ALL)
- [x] LocalStorage persistence
- [x] Dev/DAO slow vesting simulation

### Logic Fixes Applied
- [x] LP can never drop below initial (no phantom sells)
- [x] Sells limited to tokens actually bought
- [x] Fee vault: SOL accumulates, then injects with matching PDOX
- [x] Ratio maintained during LP growth
- [x] Armageddon based on peak LP drop (not initial)

---

## 🔗 ON-CHAIN RESOURCES

### Program (v2.0.2)
| Property | Value |
|----------|-------|
| **Program ID** | `2R6Lus9psfB2dREDuC79ayfwd4peVfqG3Q42ca2iFhNV` |
| **IDL Account** | `FDnuHMzje5EsyWqJUiTScbUJwBfQUgmD5B6VKG1qC5xS` |
| **Network** | Devnet |
| **Status** | ✅ Deployed + IDL uploaded |
| **Deploy TX** | `22nA19rTqfatoNCvMWR3vUf44u7yQc4jsYcCoG47eXEcGP8wQsGAEpL4KQq6cF6kEP387XEX8iJKuE1xX7FgRvAK` |
| **Deployer** | `3XBBYhqcV5fdF1j8Bs97wcAbj9AYEeVHcxZipaFcefr3` |

### Token
| Property | Value |
|----------|-------|
| **Mint** | `4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF` |
| **Standard** | Token-2022 |
| **Transfer Fee** | 3% (300 bps) |
| **Decimals** | 9 |
| **Total Supply** | 1,000,000,000 (1B) |

### Key PDAs
| PDA | Status |
|-----|--------|
| GlobalConfig | ✅ Exists |
| Treasury | ✅ Exists |
| Vault | ✅ Exists |

---

## ❌ WHAT'S NOT DONE / MISSING

### Token SDK
- [ ] Mainnet deployment (blocked by Meteora Token-2022 devnet support)
- [ ] Real LP pool creation (Meteora devnet = "Unsupported token mint")
- [ ] LP lock contract deployment
- [ ] Armageddon contract deployment
- [ ] Transfer hook implementation

### TestLabs
- [ ] Real on-chain tests (currently simulation/demo)
- [ ] Wallet signature for real TX
- [ ] Backend API integration
- [ ] Batch submission to actual netting engine

### Simulation
- [ ] Real devnet pool integration (blocked)
- [ ] WebSocket live price feed
- [ ] Multi-session sync (currently per-browser)

### Infrastructure
- [ ] Mainnet readiness audit
- [ ] Third-party security audit
- [ ] Rate limiting / abuse prevention
- [ ] Analytics dashboard

---

## 🚫 BLOCKED BY EXTERNAL FACTORS

| Blocker | Impact | Workaround |
|---------|--------|------------|
| Meteora devnet no Token-2022 | Can't create real LP pool | Using simulation |
| Mainnet not ready | Can't deploy production | Devnet only |
| No audit budget | Can't get third-party audit | Internal review |

---

## 📁 FILE STRUCTURE (PUBLIC REPO)

```
test/
├── index.html           # Landing page
├── README.md            # Minimal readme
├── .gitignore           # Excludes all source code
└── docs/
    ├── sim.html         # Trading simulation
    ├── test.html        # TestLabs
    ├── token.html       # Token docs (degen version)
    ├── api.html         # AI-friendly API
    ├── anonymity.html   # Layer explainer
    ├── compression.html # Merkle explainer
    ├── compare.html     # ZK comparison
    └── verify.html      # TX verification
```

---

## 🔐 SECURITY REMINDERS

From `RULES.md`:
```
✅ Show WHAT it does
❌ Never show HOW it works
```

**Never expose:**
- Source code
- Algorithm internals
- Private keys
- API keys
- Infrastructure details
- Database schemas

**OK to share:**
- Architecture diagrams (boxes & arrows)
- Performance claims (numbers)
- On-chain TX signatures
- Marketing copy

---

## 📝 HOW TO UPDATE

```powershell
cd "F:\Devnet production"
git add docs/ index.html api/
git commit -m "description"
git push origin main
```

Changes live in ~1 minute at https://labsx402.github.io/test

---

## 🆕 RECENT UPDATES (2025-11-30)

### Frontend Test Page (`docs/test.html`)
- ✅ **API Integration**: `/api/intents/submit` endpoint accepts intents
- ✅ **Temporal Netting Engine**: Prominently displayed throughout pipeline
- ✅ **Proof Codes**: ZK-style verification codes (CODE 1 + CODE 2)
- ✅ **Pipeline Status**: Shows all components (Intent → Netting → Merkle → Keccak → Ghosts → Vault → Hydra)
- ✅ **Anonymity Levels**: Fixed to match documentation (standard=10, max=100, paradox=10000)
- ✅ **No Direct Transfers**: All transactions go through netting pipeline
- ✅ **Intent Tracking**: Intent ID, Batch ID displayed
- ✅ **Verification**: Enter codes at `docs/verify.html` to prove transaction

### API Endpoint (`api/intents/submit.js`)
- ✅ **Vercel Serverless**: Ready for deployment
- ✅ **Intent Queueing**: Accepts intents, returns queued status
- ✅ **Pipeline Info**: Returns netting, merkle, keccak, ghosts, vault, hydra status
- ✅ **CORS Enabled**: Works from GitHub Pages

### Verification Page (`docs/verify.html`)
- ✅ **Enhanced Verification**: Decodes CODE 1, verifies CODE 2
- ✅ **Transaction Details**: Shows intent_id, batch_id, amount, mode, timestamp
- ✅ **Proof Validation**: Confirms transaction was included in netting batch

---

*Last updated: 2025-11-30*

