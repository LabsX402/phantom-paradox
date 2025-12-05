# Phantom Paradox Agents

Earn passive income by contributing bandwidth, compute, and verification to the Phantom Paradox network.

## Quick Start

| Platform | Command |
|----------|---------|
| **Mobile** | Open [agent-app](https://labsx402.github.io/phantom-paradox/docs/agent-app/) on phone → Install |
| **Browser** | Load `chromium/` or `firefox/` folder in browser |
| **Desktop** | `cargo build --release && ./target/release/phantom-agent start` |
| **Raspberry Pi** | `curl -sSL https://raw.githubusercontent.com/LabsX402/phantom-paradox/main/agents/phantom-box/scripts/setup.sh \| bash` |

## Agent Types

```
agents/
├── browser-extension/     # Chrome, Edge, Brave, Firefox, Opera
│   ├── chromium/          # Manifest V3 (Chrome, Edge, Brave, Opera)
│   └── firefox/           # Manifest V2 (Firefox)
├── desktop/               # Rust binary (Win/Mac/Linux)
├── android/               # Kotlin/Compose (source only)
└── phantom-box/           # Raspberry Pi setup scripts
```

## Estimated Earnings

| Agent Type | Usage | Daily Earnings |
|------------|-------|----------------|
| Browser Extension | 8 hrs | $1-2 |
| Desktop Agent | 24/7 | $5-10 |
| Mobile PWA | 4 hrs | $0.50-1 |
| Phantom Box (Pi) | 24/7 | $5-20 |

Earnings depend on:
- Your bandwidth speed
- Your IP quality (residential > datacenter)
- Your region (some regions pay more)
- Network demand

## Requirements

### Browser Extension
- Chrome 88+ / Edge 88+ / Brave 1.20+ / Opera 74+ / Firefox 109+

### Desktop Agent
- Rust 1.70+ ([rustup.rs](https://rustup.rs))
- OpenSSL (Linux: `sudo apt install libssl-dev`)

### Mobile PWA
- Android with Chrome / iOS with Safari
- No app store needed

### Phantom Box
- Raspberry Pi 4/5
- SD card 16GB+
- Ethernet recommended

## Documentation

- [Browser Extension Setup](./browser-extension/README.md)
- [Desktop Agent Setup](./desktop/README.md)
- [Phantom Box Setup](./phantom-box/README.md)

## Architecture

```
┌──────────────────┐     ┌──────────────────┐
│   Your Device    │     │   Job Manager    │
│                  │────▶│                  │
│  Browser/Desktop │     │  Assigns jobs,   │
│  Mobile/Pi       │◀────│  tracks work,    │
│                  │     │  handles payment │
└──────────────────┘     └──────────────────┘
         │                        │
         │                        │
         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│   Do Real Work   │     │   Get Paid       │
│                  │     │                  │
│  - Relay traffic │     │  - PDOX tokens   │
│  - Verify data   │     │  - NULL tokens   │
│  - Compute tasks │     │  - USDC/SOL      │
└──────────────────┘     └──────────────────┘
```

---

LabsX402 // Phantom Paradox // 2025
