#!/bin/bash
# PHANTOM BOX SETUP SCRIPT
# Run this on a fresh Raspberry Pi OS Lite installation

set -e

echo "=========================================="
echo "  PHANTOM BOX SETUP"
echo "  Phantom Paradox Agent for Raspberry Pi"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo ./setup.sh)"
    exit 1
fi

# Update system
echo "[1/8] Updating system..."
apt-get update && apt-get upgrade -y

# Install dependencies
echo "[2/8] Installing dependencies..."
apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    nginx \
    python3 \
    python3-pip \
    avahi-daemon \
    i2c-tools \
    fonts-dejavu

# Install Rust (for building agent)
echo "[3/8] Installing Rust..."
if ! command -v rustc &> /dev/null; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
fi

# Create directories
echo "[4/8] Creating directories..."
mkdir -p /opt/phantom-agent
mkdir -p /etc/phantom-agent
mkdir -p /var/log/phantom-agent
mkdir -p /var/www/phantom-dashboard

# Download/build agent binary
echo "[5/8] Installing agent..."
# TODO: Replace with actual binary download
# For now, create placeholder
cat > /opt/phantom-agent/phantom-agent << 'EOF'
#!/bin/bash
echo "Phantom Agent v0.1.0"
echo "Placeholder - replace with actual binary"
while true; do
    echo "[$(date)] Heartbeat..."
    sleep 30
done
EOF
chmod +x /opt/phantom-agent/phantom-agent

# Create default config
echo "[6/8] Creating config..."
cat > /etc/phantom-agent/config.toml << 'EOF'
# Phantom Box Configuration

[agent]
wallet_address = ""
auto_start = true
manager_url = "https://api.phantomparadox.io"
rpc_url = "https://api.devnet.solana.com"

[limits]
max_cpu_percent = 75
max_bandwidth_mbps = 50
max_daily_data_gb = 10

[modes]
compute = true
relay = true
verify = true
jury = true

[display]
enabled = true
type = "ssd1306"
EOF

# Create systemd service
echo "[7/8] Creating systemd service..."
cat > /etc/systemd/system/phantom-agent.service << 'EOF'
[Unit]
Description=Phantom Paradox Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/opt/phantom-agent/phantom-agent start --config /etc/phantom-agent/config.toml
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Watchdog
WatchdogSec=60
NotifyAccess=main

# Resource limits
CPUQuota=75%
MemoryMax=1G

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable phantom-agent

# Setup dashboard
echo "[8/8] Setting up dashboard..."
cat > /var/www/phantom-dashboard/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Phantom Box Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: system-ui, sans-serif;
            background: #030508;
            color: #e8f0f8;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 600px; margin: 0 auto; }
        h1 {
            color: #00ff88;
            text-align: center;
            margin-bottom: 20px;
        }
        .card {
            background: #0a0f14;
            border: 1px solid #1a2530;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 16px;
        }
        .stat {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #1a2530;
        }
        .stat:last-child { border-bottom: none; }
        .stat-label { color: #6b7c8a; }
        .stat-value { color: #00ff88; font-weight: bold; }
        .status-online { color: #00ff88; }
        .status-offline { color: #ff4757; }
        input {
            width: 100%;
            padding: 12px;
            background: #111820;
            border: 1px solid #1a2530;
            border-radius: 8px;
            color: #e8f0f8;
            margin: 8px 0;
        }
        button {
            width: 100%;
            padding: 14px;
            background: #00ff88;
            border: none;
            border-radius: 8px;
            color: #030508;
            font-weight: bold;
            cursor: pointer;
        }
        button:hover { background: #00cc6a; }
    </style>
</head>
<body>
    <div class="container">
        <h1>PHANTOM BOX</h1>
        
        <div class="card">
            <h3>Status</h3>
            <div class="stat">
                <span class="stat-label">Agent</span>
                <span class="stat-value status-online" id="status">ONLINE</span>
            </div>
            <div class="stat">
                <span class="stat-label">Uptime</span>
                <span class="stat-value" id="uptime">0:00:00</span>
            </div>
            <div class="stat">
                <span class="stat-label">Earnings</span>
                <span class="stat-value" id="earnings">$0.00</span>
            </div>
        </div>
        
        <div class="card">
            <h3>System</h3>
            <div class="stat">
                <span class="stat-label">CPU</span>
                <span class="stat-value" id="cpu">0%</span>
            </div>
            <div class="stat">
                <span class="stat-label">RAM</span>
                <span class="stat-value" id="ram">0 MB</span>
            </div>
            <div class="stat">
                <span class="stat-label">Temp</span>
                <span class="stat-value" id="temp">0°C</span>
            </div>
            <div class="stat">
                <span class="stat-label">Network</span>
                <span class="stat-value" id="network">0 Mbps</span>
            </div>
        </div>
        
        <div class="card">
            <h3>Wallet</h3>
            <input type="text" id="wallet" placeholder="Enter Solana wallet address">
            <button onclick="saveWallet()">SAVE WALLET</button>
        </div>
    </div>
    
    <script>
        // Auto-refresh stats
        setInterval(fetchStats, 5000);
        
        async function fetchStats() {
            try {
                const resp = await fetch('/api/stats');
                const data = await resp.json();
                document.getElementById('status').textContent = data.status;
                document.getElementById('uptime').textContent = data.uptime;
                document.getElementById('earnings').textContent = '$' + data.earnings.toFixed(4);
                document.getElementById('cpu').textContent = data.cpu + '%';
                document.getElementById('ram').textContent = data.ram + ' MB';
                document.getElementById('temp').textContent = data.temp + '°C';
                document.getElementById('network').textContent = data.network + ' Mbps';
            } catch (e) {
                console.error('Failed to fetch stats:', e);
            }
        }
        
        async function saveWallet() {
            const wallet = document.getElementById('wallet').value;
            if (!wallet || wallet.length < 32) {
                alert('Invalid wallet address');
                return;
            }
            try {
                await fetch('/api/wallet', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address: wallet })
                });
                alert('Wallet saved!');
            } catch (e) {
                alert('Failed to save wallet');
            }
        }
        
        fetchStats();
    </script>
</body>
</html>
EOF

# Configure nginx
cat > /etc/nginx/sites-available/phantom-dashboard << 'EOF'
server {
    listen 8080;
    server_name _;
    root /var/www/phantom-dashboard;
    index index.html;
    
    location /api/ {
        proxy_pass http://127.0.0.1:8081/;
        proxy_http_version 1.1;
    }
}
EOF

ln -sf /etc/nginx/sites-available/phantom-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Set hostname
hostnamectl set-hostname phantombox

# Done!
echo ""
echo "=========================================="
echo "  PHANTOM BOX SETUP COMPLETE!"
echo "=========================================="
echo ""
echo "Dashboard: http://phantombox.local:8080"
echo ""
echo "Next steps:"
echo "1. Reboot: sudo reboot"
echo "2. Open dashboard in browser"
echo "3. Enter your Solana wallet address"
echo "4. Start earning!"
echo ""

