# Phantom Paradox Desktop Agent

Cross-platform agent for Windows, macOS, and Linux. Built with Rust for maximum performance.

## Requirements

- **Rust toolchain** (1.70+): Install from [rustup.rs](https://rustup.rs)
- **OpenSSL dev libraries** (Linux only)

## Quick Install

### Linux (Ubuntu/Debian)

```bash
# Install dependencies
sudo apt update
sudo apt install -y build-essential pkg-config libssl-dev libudev-dev

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Clone and build
git clone https://github.com/LabsX402/phantom-paradox.git
cd phantom-paradox/agents/desktop
cargo build --release

# Run
./target/release/phantom-agent start
```

### Linux (Fedora/RHEL)

```bash
sudo dnf install -y gcc openssl-devel pkgconfig
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

git clone https://github.com/LabsX402/phantom-paradox.git
cd phantom-paradox/agents/desktop
cargo build --release
./target/release/phantom-agent start
```

### macOS

```bash
# Install Xcode command line tools
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Clone and build
git clone https://github.com/LabsX402/phantom-paradox.git
cd phantom-paradox/agents/desktop
cargo build --release
./target/release/phantom-agent start
```

### Windows

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ workload)
2. Install [Rust](https://rustup.rs)
3. Open PowerShell:

```powershell
git clone https://github.com/LabsX402/phantom-paradox.git
cd phantom-paradox\agents\desktop
cargo build --release
.\target\release\phantom-agent.exe start
```

## Usage

```bash
# Start agent (connects to manager)
phantom-agent start

# Start with custom manager URL
phantom-agent start --manager-url http://your-manager:3000

# Run capability test
phantom-agent test

# Check status
phantom-agent status
```

## Configuration

Create `config.toml` in the same directory as the binary:

```toml
[agent]
id = "my-agent-001"
manager_url = "http://localhost:3000"
websocket_url = "ws://localhost:3000/ws"

[limits]
max_cpu_percent = 25
max_bandwidth_mbps = 50
max_memory_mb = 512

[capabilities]
compute = true
relay = true
verify = true
gpu = false
storage = false
```

## Run as Service (Linux)

```bash
# Copy binary
sudo cp target/release/phantom-agent /usr/local/bin/

# Create systemd service
sudo tee /etc/systemd/system/phantom-agent.service << 'EOF'
[Unit]
Description=Phantom Paradox Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/phantom-agent start
Restart=always
User=nobody
WorkingDirectory=/var/lib/phantom-agent

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable phantom-agent
sudo systemctl start phantom-agent

# Check logs
sudo journalctl -u phantom-agent -f
```

## Earnings

Estimated earnings depend on your configuration and demand:

| Mode | Rate |
|------|------|
| Relay only | $2-5/day |
| Relay + Compute | $5-10/day |
| Full capabilities | $10-20/day |

---

LabsX402 // Phantom Paradox // 2025

