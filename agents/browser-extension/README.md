# PHANTOM PARADOX BROWSER EXTENSION

Earn crypto by sharing bandwidth. Lightweight relay agent that runs in your browser.

## Supported Browsers

| Browser | Engine | Store | Status |
|---------|--------|-------|--------|
| **Chrome** | Chromium | Chrome Web Store | ✅ Ready |
| **Edge** | Chromium | Microsoft Add-ons | ✅ Ready |
| **Brave** | Chromium | Chrome Web Store | ✅ Ready |
| **Opera** | Chromium | Opera Add-ons | ✅ Ready |
| **Firefox** | Gecko | Firefox Add-ons | ✅ Ready |
| **Safari** | WebKit | App Store | 🔲 Planned |

## Installation

### Chrome / Edge / Brave / Opera (Developer Mode)

1. Download/clone this folder
2. Open browser extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Opera: `opera://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `chromium/` folder
6. Done! Click extension icon to start

### Firefox (Developer Mode)

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `firefox/manifest.json`
4. Done!

### From Store (Coming Soon)

- Chrome Web Store: [link pending]
- Firefox Add-ons: [link pending]
- Edge Add-ons: [link pending]

## Features

- **Relay Mode** - Share bandwidth for VPN/proxy traffic
- **Low Resource** - Minimal CPU/RAM usage
- **Earnings Tracker** - Real-time stats in popup
- **Auto-reconnect** - Resumes after browser restart
- **Privacy First** - No personal data collected

## Folder Structure

```
browser-extension/
├── chromium/          # Chrome, Edge, Brave, Opera
│   ├── manifest.json  # Manifest V3
│   ├── src/
│   │   ├── background.js
│   │   ├── popup.html
│   │   └── popup.js
│   └── icons/
│
├── firefox/           # Firefox
│   ├── manifest.json  # Manifest V2 (Firefox compat)
│   ├── src/
│   │   ├── background.js
│   │   ├── popup.html
│   │   └── popup.js
│   └── icons/
│
└── safari/            # Safari (macOS/iOS) - Coming Soon
    └── README.md
```

## Building for Store Submission

```bash
# Chrome/Edge/Brave/Opera
cd chromium && zip -r ../phantom-agent-chromium.zip .

# Firefox
cd firefox && zip -r ../phantom-agent-firefox.zip .
```

## Estimated Earnings

- Idle: $0.50-1.00/day
- Active browsing: $1-2/day
- 24/7 relay: $2-3/day

Earnings depend on network quality and demand.

## Privacy

- No browsing history collected
- No personal information stored
- Wallet address = your identity
- All traffic encrypted
- Open source

## License

MIT License - Phantom Paradox 2025

