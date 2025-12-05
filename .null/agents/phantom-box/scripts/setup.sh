#!/bin/bash
# ================================================================
# Phantom Paradox Agent - Raspberry Pi Setup Script
# Run: curl -sSL https://raw.githubusercontent.com/.../setup.sh | bash
# ================================================================

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     PHANTOM PARADOX - RASPBERRY PI AGENT INSTALLER         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running on Raspberry Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null && ! grep -q "BCM" /proc/cpuinfo 2>/dev/null; then
    log_warn "This doesn't look like a Raspberry Pi, but continuing anyway..."
fi

# Check for root/sudo
if [ "$EUID" -ne 0 ]; then
    log_info "This script needs sudo access. You may be prompted for your password."
    SUDO="sudo"
else
    SUDO=""
fi

# ================================================================
# 1. Update System
# ================================================================
log_info "Updating system packages..."
$SUDO apt update
$SUDO apt upgrade -y

# ================================================================
# 2. Install Dependencies
# ================================================================
log_info "Installing dependencies..."
$SUDO apt install -y \
    curl \
    wget \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    libudev-dev \
    nginx \
    jq

# ================================================================
# 3. Install Rust (if not present)
# ================================================================
if ! command -v rustc &> /dev/null; then
    log_info "Installing Rust toolchain..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    log_info "Rust already installed: $(rustc --version)"
fi

# Make sure cargo is in path
export PATH="$HOME/.cargo/bin:$PATH"

# ================================================================
# 4. Clone or Update Repository
# ================================================================
INSTALL_DIR="/opt/phantom-paradox"
log_info "Setting up in $INSTALL_DIR..."

if [ -d "$INSTALL_DIR" ]; then
    log_info "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull origin main || true
else
    log_info "Cloning repository..."
    $SUDO mkdir -p "$INSTALL_DIR"
    $SUDO chown $USER:$USER "$INSTALL_DIR"
    git clone https://github.com/LabsX402/phantom-paradox.git "$INSTALL_DIR"
fi

# ================================================================
# 5. Build Desktop Agent
# ================================================================
log_info "Building Phantom Agent (this may take a few minutes)..."
cd "$INSTALL_DIR/agents/desktop"

# For Raspberry Pi, might need to set target
if uname -m | grep -q "aarch64"; then
    cargo build --release
else
    cargo build --release --target armv7-unknown-linux-gnueabihf || cargo build --release
fi

# Copy binary
$SUDO cp target/release/phantom-agent /usr/local/bin/ 2>/dev/null || \
$SUDO cp target/armv7-unknown-linux-gnueabihf/release/phantom-agent /usr/local/bin/ 2>/dev/null || \
$SUDO cp target/*/release/phantom-agent /usr/local/bin/ 2>/dev/null

$SUDO chmod +x /usr/local/bin/phantom-agent
log_info "Agent binary installed to /usr/local/bin/phantom-agent"

# ================================================================
# 6. Create Configuration
# ================================================================
log_info "Creating configuration..."
$SUDO mkdir -p /etc/phantom-agent
$SUDO mkdir -p /var/lib/phantom-agent
$SUDO mkdir -p /var/log/phantom-agent

# Generate random agent ID
AGENT_ID="phantom-box-$(head /dev/urandom | tr -dc 'a-z0-9' | head -c 8)"

$SUDO tee /etc/phantom-agent/config.toml > /dev/null << EOF
# Phantom Paradox Agent Configuration
# Generated: $(date)

[agent]
id = "$AGENT_ID"
manager_url = "http://localhost:3000"
websocket_url = "ws://localhost:3000/ws"

[limits]
max_cpu_percent = 50
max_bandwidth_mbps = 100
max_daily_data_gb = 50
max_memory_mb = 512

[capabilities]
compute = true
relay = true
verify = true
gpu = false
storage = false

[wallet]
# Add your Solana wallet address here to receive payments
# address = "YOUR_WALLET_ADDRESS"
EOF

log_info "Configuration created at /etc/phantom-agent/config.toml"

# ================================================================
# 7. Create Systemd Service
# ================================================================
log_info "Creating systemd service..."

$SUDO tee /etc/systemd/system/phantom-agent.service > /dev/null << 'EOF'
[Unit]
Description=Phantom Paradox Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/phantom-agent start --config /etc/phantom-agent/config.toml
Restart=always
RestartSec=10
User=pi
Group=pi
WorkingDirectory=/var/lib/phantom-agent
StandardOutput=append:/var/log/phantom-agent/agent.log
StandardError=append:/var/log/phantom-agent/error.log

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/phantom-agent /var/log/phantom-agent

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable phantom-agent

# ================================================================
# 8. Setup Web Dashboard
# ================================================================
log_info "Setting up web dashboard..."

DASHBOARD_DIR="/var/www/phantom-dashboard"
$SUDO mkdir -p "$DASHBOARD_DIR"

$SUDO tee "$DASHBOARD_DIR/index.html" > /dev/null << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Phantom Box Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: monospace; background: #030508; color: #e8f0f8; padding: 20px; }
        h1 { color: #00ff88; margin-bottom: 20px; }
        .card { background: #0a0f14; border: 1px solid #1a2530; border-radius: 8px; padding: 20px; margin-bottom: 15px; }
        .stat { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1a2530; }
        .stat:last-child { border: none; }
        .label { color: #6b7c8a; }
        .value { color: #00ff88; font-weight: bold; }
        .status { padding: 4px 12px; border-radius: 20px; font-size: 12px; }
        .online { background: #00ff88; color: #030508; }
        .offline { background: #ff4757; color: white; }
    </style>
</head>
<body>
    <h1>PHANTOM BOX</h1>
    <div class="card">
        <div class="stat">
            <span class="label">Status</span>
            <span class="status online" id="status">ONLINE</span>
        </div>
        <div class="stat">
            <span class="label">Agent ID</span>
            <span class="value" id="agentId">Loading...</span>
        </div>
        <div class="stat">
            <span class="label">Uptime</span>
            <span class="value" id="uptime">0h 0m</span>
        </div>
    </div>
    <div class="card">
        <div class="stat">
            <span class="label">Today's Earnings</span>
            <span class="value" id="earnings">$0.00</span>
        </div>
        <div class="stat">
            <span class="label">Data Relayed</span>
            <span class="value" id="data">0 MB</span>
        </div>
        <div class="stat">
            <span class="label">Jobs Completed</span>
            <span class="value" id="jobs">0</span>
        </div>
    </div>
    <div class="card">
        <div class="stat">
            <span class="label">CPU Usage</span>
            <span class="value" id="cpu">0%</span>
        </div>
        <div class="stat">
            <span class="label">Memory</span>
            <span class="value" id="memory">0 MB</span>
        </div>
        <div class="stat">
            <span class="label">Temperature</span>
            <span class="value" id="temp">0°C</span>
        </div>
    </div>
    <p style="color: #3a4a5a; font-size: 12px; margin-top: 20px;">
        Phantom Paradox // LabsX402 // 2025
    </p>
    <script>
        // Simulated data - replace with real API calls
        document.getElementById('agentId').textContent = 'phantom-box-' + Math.random().toString(36).substr(2, 8);
        setInterval(() => {
            document.getElementById('cpu').textContent = Math.floor(Math.random() * 30 + 5) + '%';
            document.getElementById('memory').textContent = Math.floor(Math.random() * 200 + 300) + ' MB';
            document.getElementById('temp').textContent = Math.floor(Math.random() * 15 + 45) + '°C';
        }, 2000);
    </script>
</body>
</html>
EOF

# Configure Nginx
$SUDO tee /etc/nginx/sites-available/phantom-dashboard > /dev/null << EOF
server {
    listen 8080;
    server_name _;
    root $DASHBOARD_DIR;
    index index.html;
    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF

$SUDO ln -sf /etc/nginx/sites-available/phantom-dashboard /etc/nginx/sites-enabled/
$SUDO rm -f /etc/nginx/sites-enabled/default
$SUDO systemctl enable nginx
$SUDO systemctl restart nginx

# ================================================================
# 9. Start Agent
# ================================================================
log_info "Starting Phantom Agent..."
$SUDO systemctl start phantom-agent || log_warn "Could not start agent - check logs with: journalctl -u phantom-agent"

# ================================================================
# 10. Done!
# ================================================================
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    INSTALLATION COMPLETE                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
log_info "Agent ID: $AGENT_ID"
log_info "Config: /etc/phantom-agent/config.toml"
log_info "Dashboard: http://$(hostname -I | awk '{print $1}'):8080"
echo ""
log_info "Commands:"
echo "  sudo systemctl status phantom-agent  - Check status"
echo "  sudo journalctl -u phantom-agent -f  - View logs"
echo "  sudo systemctl restart phantom-agent - Restart"
echo ""
log_warn "Don't forget to add your wallet address to /etc/phantom-agent/config.toml!"
echo ""
