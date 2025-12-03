# PHANTOM PARADOX

> Anonymous payment infrastructure on Solana using statistical mixing and Merkle compression.

---

## ⚠️ IMPORTANT DISCLAIMER

**This project is NOT affiliated with:**
- Coinbase
- x402 Protocol / x402-labs
- Boosty Labs
- Vercel Labs

**LabsX402** is an independent project. The name similarity is coincidental.

**Status:** DEVNET only. Not production-ready. Use at your own risk.

---

## What This Is

A privacy layer for Solana payments using:

- **Statistical mixing** (NOT zero-knowledge proofs)
- **Merkle compression** for batch settlements
- **Vault architecture** that breaks sender→receiver links on-chain

## What This Is NOT

- ❌ Not "1M TPS guaranteed" — theoretical ceiling
- ❌ Not "100% anonymous" — statistical, degrades with low traffic
- ❌ Not "ZK proofs" — uses mixing, not cryptographic ZK
- ❌ Not production-ready — devnet testing only

---

## Live Demo

**GitHub Pages (temporary):** https://labsx402.github.io/test/

Production domain `phantomparadox.io` coming soon.

### Pages

| Page | Description |
|------|-------------|
| [index.html](https://labsx402.github.io/test/) | Main landing |
| [docs/token.html](https://labsx402.github.io/test/docs/token.html) | PDOX Token specs |
| [docs/sim.html](https://labsx402.github.io/test/docs/sim.html) | 24/7 Trading Simulation |
| [docs/api.html](https://labsx402.github.io/test/docs/api.html) | API for verification |
| [docs/test.html](https://labsx402.github.io/test/docs/test.html) | TestLabs |

---

## Verified On-Chain (Devnet)

```
Program ID: 8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x
PDOX Token: 4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF
Network:    Solana Devnet
```

### Verify Program Exists

```bash
curl -X POST https://api.devnet.solana.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo",
       "params":["8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x",
       {"encoding":"base64"}]}' | jq '.result.value.executable'
# Expected: true
```

---

## 24/7 Trading Simulation

GitHub Actions runs a trading simulation every 15 minutes to demonstrate tokenomics:

- Normal trading, pumps, dumps, whale activity
- Armageddon mode triggers when LP drops
- LP growth from fees
- All data downloadable as JSON

See: [docs/sim.html](https://labsx402.github.io/test/docs/sim.html)

---

## Architecture (High Level)

```
User Intent → Netting Engine → Batch → Merkle Root → On-Chain Settlement
                    ↓
            Ghost Injection (Poltergeist)
                    ↓
            Vault → Anonymous Payout
```

**What chain analysis sees:**
- ❌ Cannot link sender to receiver
- ✅ Can see vault → payout
- ✅ Can see ghost traffic (noise)

---

## License

[Business Source License 1.1](./LICENSE)

- View/study/test: ✅ Free
- Commercial use: ❌ Requires license until Dec 2028
- After Dec 2028: Converts to MIT

---

## Links

- Landing: https://labsx402.github.io/test/
- Docs Repo: https://github.com/LabsX402/PHANTOMGRID-Paradox
- Twitter: [@SLS_0x](https://twitter.com/SLS_0x)

---

*"In the shadows, we trust math"*
