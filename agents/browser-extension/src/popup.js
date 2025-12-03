/**
 * PHANTOM PARADOX BROWSER AGENT
 * Popup UI Controller
 */

let currentState = {
    isActive: false,
    walletAddress: null,
    stats: {
        bytesRelayed: 0,
        connections: 0,
        uptime: 0,
        earnings: 0
    }
};

// ============== INITIALIZATION ==============

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    startStatsRefresh();
});

async function loadState() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        if (response && response.state) {
            currentState = response.state;
            updateUI();
        }
    } catch (err) {
        console.error('Failed to load state:', err);
    }
}

// ============== UI UPDATES ==============

function updateUI() {
    const indicator = document.getElementById('statusIndicator');
    const icon = document.getElementById('statusIcon');
    const text = document.getElementById('statusText');
    const sub = document.getElementById('statusSub');
    const btn = document.getElementById('mainBtn');
    const walletEl = document.getElementById('walletAddress');
    
    // Status indicator
    if (currentState.isActive) {
        indicator.className = 'status-indicator online';
        icon.textContent = '●';
        text.textContent = 'ONLINE';
        sub.textContent = 'Relaying traffic...';
        btn.textContent = 'STOP';
        btn.className = 'btn btn-danger';
    } else {
        indicator.className = 'status-indicator offline';
        icon.textContent = '○';
        text.textContent = 'OFFLINE';
        sub.textContent = 'Click to start earning';
        btn.textContent = 'START EARNING';
        btn.className = 'btn btn-primary';
    }
    
    // Wallet
    if (currentState.walletAddress) {
        const addr = currentState.walletAddress;
        walletEl.textContent = addr.slice(0, 8) + '...' + addr.slice(-8);
        walletEl.className = 'wallet-address';
    } else {
        walletEl.textContent = 'No wallet connected';
        walletEl.className = 'wallet-address empty';
    }
    
    // Stats
    updateStats();
}

function updateStats() {
    const stats = currentState.stats;
    
    // Data relayed
    const mb = (stats.bytesRelayed / (1024 * 1024)).toFixed(2);
    document.getElementById('dataRelayed').textContent = mb + ' MB';
    
    // Uptime
    const hours = Math.floor(stats.uptime / 3600);
    const mins = Math.floor((stats.uptime % 3600) / 60);
    document.getElementById('uptime').textContent = `${hours}:${mins.toString().padStart(2, '0')}`;
    
    // Connections
    document.getElementById('connections').textContent = stats.connections;
    
    // Earnings
    document.getElementById('earnings').textContent = '$' + stats.earnings.toFixed(4);
    
    // Rate (estimated $/hr based on current activity)
    const hourlyRate = stats.uptime > 0 ? (stats.earnings / stats.uptime * 3600) : 0;
    document.getElementById('rate').textContent = '$' + hourlyRate.toFixed(2) + '/hr';
}

// ============== ACTIONS ==============

async function toggleAgent() {
    try {
        if (currentState.isActive) {
            await chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
            currentState.isActive = false;
        } else {
            if (!currentState.walletAddress) {
                alert('Please connect your wallet first');
                return;
            }
            await chrome.runtime.sendMessage({ type: 'START_AGENT' });
            currentState.isActive = true;
        }
        updateUI();
    } catch (err) {
        console.error('Toggle failed:', err);
    }
}

async function connectWallet() {
    // For browser extension, we'll use a simple input for now
    // In production, integrate with Phantom/Solflare extension
    const address = prompt('Enter your Solana wallet address:');
    
    if (address && address.length >= 32) {
        try {
            await chrome.runtime.sendMessage({ type: 'SET_WALLET', address });
            currentState.walletAddress = address;
            updateUI();
        } catch (err) {
            console.error('Wallet set failed:', err);
        }
    } else if (address) {
        alert('Invalid wallet address');
    }
}

function openDashboard() {
    chrome.tabs.create({ url: 'https://phantomparadox.io/dashboard' });
}

// ============== REAL-TIME UPDATES ==============

function startStatsRefresh() {
    setInterval(async () => {
        await loadState();
    }, 5000);
}

// Listen for background updates
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
        currentState = message.state;
        updateUI();
    } else if (message.type === 'STATS_UPDATE') {
        currentState.stats = message.stats;
        updateStats();
    }
});

