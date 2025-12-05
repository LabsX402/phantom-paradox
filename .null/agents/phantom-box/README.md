# Phantom Paradox - Phantom Box (Raspberry Pi Agent)

Turn your Raspberry Pi into a 24/7 passive income device. Plug in, earn crypto.

## Quick Start (One Command)

SSH into your Pi running Raspberry Pi OS Lite, then:

```bash
curl -sSL https://raw.githubusercontent.com/LabsX402/phantom-paradox/main/agents/phantom-box/scripts/setup.sh | bash
```

This will:
- Install all dependencies
- Build and install the Phantom Agent
- Configure systemd for auto-start
- Set up a local web dashboard on port 8080
- Start earning automatically

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Pi Model | Pi 4 (2GB) | Pi 4/5 (4GB+) |
| SD Card | 16GB | 32GB A2 class |
| Network | WiFi | Ethernet (stable) |
| Power | 5V/2.5A | 5V/3A USB-C |

## Manual Setup

### 1. Flash Raspberry Pi OS

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
2. Choose **Raspberry Pi OS Lite (64-bit)**
3. Click the gear icon to configure:
   - Enable SSH
   - Set username/password
   - Configure WiFi (optional)
4. Flash to SD card

### 2. First Boot

```bash
# SSH into your Pi
ssh pi@raspberrypi.local
# or use the IP address from your router

# Update system
sudo apt update && sudo apt upgrade -y

# Run setup script
curl -sSL https://raw.githubusercontent.com/LabsX402/phantom-paradox/main/agents/phantom-box/scripts/setup.sh | bash
```

### 3. Access Dashboard

Open in browser: `http://<PI_IP>:8080`

The dashboard shows:
- Agent status (online/offline)
- Current earnings
- Bandwidth usage
- CPU/RAM metrics

## Configuration

Edit `/etc/phantom-agent/config.toml`:

```toml
[agent]
id = "phantom-box-001"
manager_url = "https://api.phantomparadox.io"

[limits]
max_cpu_percent = 50
max_bandwidth_mbps = 100
max_daily_data_gb = 50

[wallet]
address = "YOUR_SOLANA_WALLET_ADDRESS"
```

Then restart:
```bash
sudo systemctl restart phantom-agent
```

## Earnings Estimate

| Internet Speed | Monthly Earnings |
|----------------|------------------|
| 10 Mbps | $30-60 |
| 50 Mbps | $100-200 |
| 100+ Mbps | $200-400 |

Power cost: ~$4/year (5W × 24/7)

## Commands

```bash
# Check status
sudo systemctl status phantom-agent

# View logs
sudo journalctl -u phantom-agent -f

# Restart agent
sudo systemctl restart phantom-agent

# Stop agent
sudo systemctl stop phantom-agent

# Update agent
curl -sSL https://raw.githubusercontent.com/LabsX402/phantom-paradox/main/agents/phantom-box/scripts/setup.sh | bash
```

## LED Status (if using official case)

| LED | Meaning |
|-----|---------|
| Solid green | Online, earning |
| Blinking green | Processing job |
| Yellow | Connecting |
| Red | Error (check logs) |

## Troubleshooting

**Agent won't start:**
```bash
sudo journalctl -u phantom-agent -n 50
```

**No network:**
```bash
ping google.com
# If fails, check /etc/network/interfaces or nmcli
```

**Low earnings:**
- Check bandwidth limits in config
- Ensure stable Ethernet connection
- Verify port 8080 and 443 outbound are open

## Files

```
/usr/local/bin/phantom-agent    # Agent binary
/etc/phantom-agent/config.toml  # Configuration
/var/lib/phantom-agent/         # Data directory
/var/log/phantom-agent/         # Logs
```

---

## Pre-Built Option (Coming Soon)

**Phantom Box Kit - $99**
- Raspberry Pi 4 (4GB)
- 32GB pre-flashed SD card
- Official case with heatsink
- Power supply included
- Plug & earn in 5 minutes

---

LabsX402 // Phantom Paradox // 2025
