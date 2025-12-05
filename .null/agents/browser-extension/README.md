# Phantom Paradox Browser Extension

Lightweight relay agent that runs in your browser. Earn passive income while browsing.

## Supported Browsers

| Browser | Version | Folder |
|---------|---------|--------|
| Chrome | 88+ | `chromium/` |
| Edge | 88+ | `chromium/` |
| Brave | 1.20+ | `chromium/` |
| Opera | 74+ | `chromium/` |
| Firefox | 109+ | `firefox/` |

## Installation

### Chrome / Edge / Brave / Opera (Chromium)

1. Download this repo or just the `chromium/` folder
2. Open your browser and go to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Opera: `opera://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `chromium/` folder
6. Pin the extension to your toolbar

### Firefox

1. Download this repo or just the `firefox/` folder
2. Open Firefox and go to `about:debugging`
3. Click **This Firefox** in the sidebar
4. Click **Load Temporary Add-on...**
5. Navigate to `firefox/` folder and select `manifest.json`

Note: Firefox temporary add-ons are removed when browser closes. For permanent install, the extension needs to be signed by Mozilla.

## Usage

1. Click the extension icon in your toolbar
2. Toggle **Enable Agent** to start earning
3. Configure your limits:
   - CPU usage (10-100%)
   - Bandwidth (1-100 Mbps)
   - Daily data cap (100MB - Unlimited)
4. Connect your Solana wallet to receive payments

## What It Does

The extension acts as a relay node:
- Routes encrypted traffic through your connection
- Verifies small data packets
- Earns PDOX/NULL tokens for work done

Your connection is used only when:
- You have the extension enabled
- Your limits allow it
- There's demand for your region/IP

## Privacy & Security

- **No browsing data collected** - We only use idle bandwidth
- **Encrypted traffic** - All relayed data is encrypted
- **Rate limited** - Cannot exceed your configured limits
- **Sandboxed** - Runs in browser sandbox, no system access

## Estimated Earnings

| Usage | Daily Earnings |
|-------|----------------|
| Light (2-4 hrs) | $0.50-1.00 |
| Medium (8 hrs) | $1.00-2.00 |
| Heavy (24/7) | $2.00-5.00 |

Earnings vary based on:
- Your IP quality (residential > datacenter)
- Your region (high-demand regions pay more)
- Current network demand

## Files

```
chromium/
├── manifest.json      # Extension manifest (MV3)
├── src/
│   ├── background.js  # Service worker
│   ├── popup.html     # Popup UI
│   └── popup.js       # Popup logic
└── icons/
    └── icon16.svg     # Extension icon

firefox/
├── manifest.json      # Extension manifest (MV2)
├── src/
│   ├── background.js  # Background script
│   ├── popup.html     # Popup UI
│   └── popup.js       # Popup logic
└── icons/
    └── (same as chromium)
```

---

LabsX402 // Phantom Paradox // 2025
