/**
 * PHANTOM PARADOX BROWSER AGENT
 * Popup UI Controller (Chromium)
 */

let currentState = {
    isActive: false,
    walletAddress: null,
    stats: { bytesRelayed: 0, connections: 0, uptime: 0, earnings: 0 }
};

let config = {
    maxBandwidth: 10,
    dailyDataCap: 1000,
    unlimitedData: false
};

// ============== INITIALIZATION ==============

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    await loadConfig();
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

async function loadConfig() {
    const stored = await chrome.storage.local.get(['agentConfig']);
    if (stored.agentConfig) {
        config = { ...config, ...stored.agentConfig };
        
        document.getElementById('bwSlider').value = config.maxBandwidth;
        document.getElementById('bwVal').textContent = config.maxBandwidth + ' Mbps';
        
        document.getElementById('dataSlider').value = config.dailyDataCap;
        document.getElementById('unlimitedData').checked = config.unlimitedData;
        
        if (config.unlimitedData) {
            toggleUnlimited();
        } else {
            updateDataCap();
        }
    }
}

async function saveConfig() {
    config.maxBandwidth = parseInt(document.getElementById('bwSlider').value);
    config.dailyDataCap = parseInt(document.getElementById('dataSlider').value);
    config.unlimitedData = document.getElementById('unlimitedData').checked;
    
    await chrome.storage.local.set({ agentConfig: config });
}

// ============== DATA CAP ==============

function updateDataCap() {
    const slider = document.getElementById('dataSlider');
    const val = parseInt(slider.value);
    let display;
    
    if (val < 1000) {
        display = val + ' MB';
    } else if (val < 10000) {
        display = (val / 1000).toFixed(1) + ' GB';
    } else {
        display = Math.round(val / 1000) + ' GB';
    }
    
    document.getElementById('dataVal').textContent = display;
    saveConfig();
}

function toggleUnlimited() {
    const checkbox = document.getElementById('unlimitedData');
    const slider = document.getElementById('dataSlider');
    
    if (checkbox.checked) {
        slider.disabled = true;
        document.getElementById('dataVal').textContent = 'UNLIMITED';
    } else {
        slider.disabled = false;
        updateDataCap();
    }
    
    saveConfig();
}

// ============== UI UPDATES ==============

function updateUI() {
    const indicator = document.getElementById('statusIndicator');
    const icon = document.getElementById('statusIcon');
    const text = document.getElementById('statusText');
    const sub = document.getElementById('statusSub');
    const btn = document.getElementById('mainBtn');
    const walletEl = document.getElementById('walletAddress');
    
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
        sub.textContent = 'Configure and start earning';
        btn.textContent = 'START EARNING';
        btn.className = 'btn btn-primary';
    }
    
    if (currentState.walletAddress) {
        const addr = currentState.walletAddress;
        walletEl.textContent = addr.slice(0, 6) + '...' + addr.slice(-6);
        walletEl.className = 'wallet-address';
    } else {
        walletEl.textContent = 'No wallet connected';
        walletEl.className = 'wallet-address empty';
    }
    
    updateStats();
}

function updateStats() {
    const stats = currentState.stats;
    
    const mb = (stats.bytesRelayed / (1024 * 1024)).toFixed(2);
    document.getElementById('dataRelayed').textContent = mb + ' MB';
    
    const hours = Math.floor(stats.uptime / 3600);
    const mins = Math.floor((stats.uptime % 3600) / 60);
    document.getElementById('uptime').textContent = `${hours}:${mins.toString().padStart(2, '0')}`;
    
    document.getElementById('connections').textContent = stats.connections;
    document.getElementById('earnings').textContent = '$' + stats.earnings.toFixed(4);
    
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
                alert('Connect your wallet first');
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

function openSettings() {
    chrome.tabs.create({ url: 'https://phantomparadox.io/agent/settings' });
}

// ============== REAL-TIME UPDATES ==============

function startStatsRefresh() {
    setInterval(async () => {
        await loadState();
    }, 5000);
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
        currentState = message.state;
        updateUI();
    } else if (message.type === 'STATS_UPDATE') {
        currentState.stats = message.stats;
        updateStats();
    }
});

