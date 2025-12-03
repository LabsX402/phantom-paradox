# GITPAGE.md — GitHub Pages Documentation

**READ FIRST:** `RULES.md` (security), `AGENT_MEMO.md` (project details)

---

## What Is This?

Public landing page for **Phantom Paradox** hosted at:
- **URL:** https://labsx402.github.io/test
- **Repo:** https://github.com/LabsX402/test (private)

This is the ONLY public-facing code. Everything else stays local.

---

## What's Live

### Main Page (`index.html`)
- Hero: PHANTOM PARADOX branding
- Live Devnet Ticker: slot, block, TPS, epoch (real-time from public RPC)
- Navigation to docs pages
- Full comparison table (speed + cost + anonymity %)
- Benchmark with optimal batch size analysis
- On-chain proof links (real devnet TXs)
- Architecture diagram (Chain Breaker flow)

### Docs Pages (`/docs/`)

| Page | Purpose |
|------|---------|
| `anonymity.html` | How layers work (Vault → Poltergeist → Hydra → Merkle) |
| `compression.html` | Merkle tree diagram, cost savings table |
| `compare.html` | Honest comparison vs ZK (Zcash, Tornado, Light Protocol) |
| `test.html` | **Interactive test page** — Phantom wallet connect, send TX, get proof codes |

---

## What's NOT on GitPage (stays local)

- Source code (Rust, TypeScript)
- Config files (Anchor.toml, Cargo.toml)
- Wallet files
- API keys
- Implementation details
- Algorithm internals

See `RULES.md` for full list.

---

## Branding

- **Name:** PHANTOM PARADOX (not ZK NARC)
- **Tagline:** "anonymous payments on solana"
- **Aesthetic:** Dark theme, JetBrains Mono, terminal/coder style
- **No emojis** (or minimal)

---

## Key Data Points (from real tests)

### Anonymity Tiers
| Tier | Ghosts | Anonymity % | Speed | Cost |
|------|--------|-------------|-------|------|
| STANDARD | 10 | 91.6% | ~500ms | $0.00001 |
| MAX | 100+ | 99.9% | ~2s | $0.00001 |
| PARADOX | 10 layers | 99.999997% | ~12s | $0.026 |

### Optimal Batch Sizes
| Intents | Time | μs/intent | Verdict |
|---------|------|-----------|---------|
| 10K | 109ms | 10.9μs | instant |
| 100K | 847ms | 8.5μs | **optimal** |
| 1M | 8.2s | 8.2μs | good |
| 10M | 94s | 9.4μs | diminishing |

### Real TX Proofs (devnet)
- Netting: `5b1MtoyP1BRVn7SgfQtKCTyHDE1mfFD4k1oC8DtJmjnexrSWaBRvxJ1HgP6GYFYwZmzoVNpfwW2cVuLF1HVo9YJo`
- Anon Payment: `32YDUGw5kSsMSJ8KvdAwaAAKxJEA3YLnN8dvjx5DCb6cy49xXPa4NkpAeE5K7y3LDogyiFxSBDBgHcwkhGsxeTvh`
- Paradox: `45FZorwpTQgJuTS4dmpQE2GnGeaQChbiiUTx8odBRKRjfkMwzC9wZbjkbQJVuTj1SMK9hnBZLDNwt3BLxMezffa`

### Program Info
- **Program ID:** `8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x`
- **PDOX Token:** `4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF`
- **Network:** Devnet

---

## TODO / Next Steps

### Completed ✅
- [x] **Test Page** — Users can send test anonymous TX with Phantom wallet
  - Select tier (STANDARD/MAX/PARADOX)
  - Enter destination wallet
  - Confirm in Phantom
  - Receive 2 proof codes
- [x] **Wallet Connect** — Phantom integration working
- [x] **Compare Page** — Honest ZK comparison (Zcash, Tornado, Light Protocol)
- [x] **Full Journey Benchmark** — AI agent nano payments

### Medium Priority
- [ ] Add more real TX proofs as we test
- [ ] Speed test with larger batches (1M+)
- [ ] Connect test page to real API (currently demo mode)
- [ ] Mainnet deployment (when ready)

### Low Priority
- [ ] Mobile responsive tweaks
- [ ] Dark/light theme toggle
- [ ] Analytics (privacy-preserving)

---

## How to Update GitPage

```bash
cd "F:\Devnet production"
git add index.html docs/
git commit -m "description of changes"
git push
```

Changes go live in ~1 minute at https://labsx402.github.io/test

---

## Files in Repo (public)

```
test/
├── index.html          # Main landing page
├── README.md           # Basic readme (minimal)
├── .gitignore          # Excludes everything except landing page
└── docs/
    ├── anonymity.html  # Anonymity layer explainer
    ├── compression.html # Merkle compression explainer
    ├── compare.html    # Honest ZK comparison
    └── test.html       # Interactive test page (Phantom wallet)
```

---

## Security Reminders

1. **Never commit:** source code, configs, wallets, keys
2. **Never expose:** exact methods, algorithm internals, file paths
3. **Always use:** real TX signatures, honest claims, RULES.md compliance
4. **Public RPC only:** no Helius/Alchemy keys in frontend

---

## Related Docs

| Doc | Purpose |
|-----|---------|
| `RULES.md` | What to NEVER expose vs OK to share |
| `AGENT_MEMO.md` | Full project overview for agents |
| `LIVE_TESTS.md` | All test results with TX signatures |
| `GITPAGE.md` | This file — GitPage status |

---

*Last updated: 2025-11-30*

