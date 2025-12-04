# PHANTOM PARADOX

> **Anonymous payment infrastructure on Solana** — Fast, cheap, private.

![Status](https://img.shields.io/badge/Network-Devnet-orange) ![License](https://img.shields.io/badge/License-BSL%201.1-blue)

---

## 🚀 What We Built

**Phantom Paradox** is a privacy layer for Solana that makes payments untraceable using statistical mixing and Merkle compression.

### Core Features

| Feature | Description |
|---------|-------------|
| **🔒 Anonymous Payments** | Break sender→receiver links on-chain |
| **⚡ Sub-second Settlement** | ~500ms for standard transactions |
| **💰 Ultra-low Fees** | $0.00001 per transaction |
| **📦 Batch Processing** | 1M+ intents per batch |
| **🤖 Agent Network** | Decentralized relay infrastructure |

---

## 📊 Live Stats

| Metric | Value |
|--------|-------|
| Anonymity (Standard) | 91.6% |
| Anonymity (MAX) | 99.9% |
| Cost per proof | $0.00001 |
| Netting speed @ 100K | <500ms |

---

## 🔗 Live Demo

**Production Site:** [phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/)

### Pages

| Page | Description |
|------|-------------|
| [Landing](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/) | Main site |
| [Agent Network](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/docs/agents.html) | Join as agent, download apps |
| [Live Simulation](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/docs/sim.html) | 24/7 trading simulation |
| [API Docs](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/docs/api.html) | Verify transactions |
| [Lab](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/docs/lab.html) | Live tests |

---

## ⛓️ On-Chain (Devnet)

```
Program ID:  8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x
PDOX Token:  4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF
Network:     Solana Devnet
```

**Verify:**
```bash
curl -s -X POST https://api.devnet.solana.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x",{"encoding":"base64"}]}' \
  | jq '.result.value.executable'
# Returns: true
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  USER INTENT                                                │
│      ↓                                                      │
│  NETTING ENGINE ──→ Batch 1M+ intents                      │
│      ↓                                                      │
│  POLTERGEIST ──→ Ghost injection (noise)                   │
│      ↓                                                      │
│  HYDRA VAULT ──→ Multi-shard distribution                  │
│      ↓                                                      │
│  MERKLE COMMIT ──→ On-chain proof                          │
│      ↓                                                      │
│  ANONYMOUS PAYOUT ──→ Recipient gets funds                 │
└─────────────────────────────────────────────────────────────┘

Chain analysis sees: Vault → Payout (no sender link)
```

---

## 📱 Agent Network

Earn SOL/USDC by sharing bandwidth, compute, and verification:

| Agent Type | Earnings | Download |
|------------|----------|----------|
| 📱 Android App | $0.15-0.30/day | [APK](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/docs/phantom-agent-android-v0.1.1.apk) |
| 🌐 Browser Extension | $0.30-0.75/day | [Chrome](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/docs/phantom-agent-chrome-v0.1.0.zip) / [Firefox](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/docs/phantom-agent-firefox-v0.1.0.xpi) |
| 💻 Desktop | $0.75-2.25/day | Coming Soon |
| 🔲 Phantom Box | $1.50-4.50/day | Coming Soon |

---

## 📁 Repository Structure

```
├── programs/           # Solana/Anchor smart contracts
│   ├── phantom_vault/  # Main vault program
│   └── pdox_token/     # Token program (Token-2022)
├── offchain/           # Backend services
│   └── src/            # Netting engine, API
├── agents/             # Agent applications
│   ├── android/        # Kotlin/Compose app
│   ├── browser-extension/  # Chrome/Firefox
│   └── desktop/        # Rust binary
├── docs/               # GitHub Pages site
├── scripts/            # Deployment & testing
└── frontend/           # UI components
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Smart Contracts | Rust, Anchor Framework |
| Backend | TypeScript, Node.js |
| Mobile | Kotlin, Jetpack Compose |
| Desktop | Rust |
| Frontend | HTML/CSS/JS |
| Blockchain | Solana (Devnet) |

---

## 📜 License

[Business Source License 1.1](./LICENSE)

- ✅ View, study, test: Free
- ⏳ Commercial use: License required until Dec 2028
- 🔓 After Dec 2028: Converts to MIT

---

## 🔗 Links

- **Website:** [phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet](https://phantomgrid-wraight.github.io/PhantomGrid-Wraith-Testnet/)
- **Twitter:** [@SLS_0x](https://twitter.com/SLS_0x)

---

*"In the shadows, we trust math"*
