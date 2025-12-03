# PHANTOM BOX - Raspberry Pi Agent

The ultimate plug-and-play passive income device.

## Quick Start (DIY)

1. Download the image: `phantombox-v0.1.0.img.gz`
2. Flash to SD card using [Balena Etcher](https://balena.io/etcher)
3. Insert SD card into Raspberry Pi 4/5
4. Connect ethernet cable
5. Connect power (USB-C 5V/3A)
6. Wait 2 minutes for first boot
7. Scan QR code on screen (or visit `http://phantombox.local:8080`)
8. Enter your Solana wallet address
9. Done! Earning 24/7.

## Hardware Requirements

- Raspberry Pi 4 (4GB+ RAM) or Pi 5
- 32GB+ microSD card (Class 10 or better)
- Ethernet cable (WiFi optional but less reliable)
- 5V/3A USB-C power supply
- Optional: Case with passive cooling
- Optional: OLED display (SSD1306)

## Software Stack

- Base OS: Raspberry Pi OS Lite (64-bit)
- Agent: `phantom-agent` (Rust binary)
- Dashboard: Local web UI on port 8080
- Auto-update: Checks hourly for updates
- Watchdog: Auto-restarts on crash

## First Boot

The image is pre-configured to:

1. Expand filesystem to use full SD card
2. Set hostname to `phantombox`
3. Enable SSH (user: `pi`, pass: `phantom`)
4. Start agent service
5. Display QR code for wallet setup

## Configuration

Edit `/etc/phantom-agent/config.toml`:

```toml
[agent]
wallet_address = "YOUR_SOLANA_ADDRESS"
auto_start = true

[limits]
max_cpu_percent = 75
max_bandwidth_mbps = 50
max_daily_data_gb = 10

[modes]
compute = true
relay = true
verify = true
jury = true
```

## Commands

```bash
# Check status
sudo systemctl status phantom-agent

# View logs
journalctl -u phantom-agent -f

# Restart agent
sudo systemctl restart phantom-agent

# Update agent
sudo phantom-update

# Show earnings
phantom-agent status
```

## Dashboard

Access at `http://phantombox.local:8080` or `http://<IP>:8080`

Features:
- Real-time earnings
- Network stats
- CPU/RAM usage
- Temperature
- Wallet settings
- Log viewer

## Power Consumption

- Idle: ~3W
- Active: ~5-7W
- Yearly cost: ~$5 electricity

## Earnings Estimate

Based on default settings (75% CPU, 50 Mbps):
- Low demand: $3-5/day
- Medium demand: $5-10/day
- High demand: $10-20/day

**ROI: 5-20 days** (based on ~$60 Pi 4 cost)

## Troubleshooting

### No network
- Check ethernet cable
- Try `sudo dhclient eth0`

### Agent not starting
- Check logs: `journalctl -u phantom-agent`
- Verify config: `cat /etc/phantom-agent/config.toml`

### High temperature
- Ensure proper ventilation
- Add heatsink or fan
- Reduce CPU limit in config

### Low earnings
- Check network speed: `speedtest-cli`
- Verify wallet address
- Check dashboard for errors

## Building the Image

See `scripts/build-image.sh` for image creation.

## License

MIT License - Phantom Paradox 2025

