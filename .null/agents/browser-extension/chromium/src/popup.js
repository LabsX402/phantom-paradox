/**
 * PHANTOM PARADOX BROWSER AGENT
 * Popup Controller (Chromium)
 * Version: 0.1.0
 */

// ============== STATE ==============

let state = {
    isActive: false,
    walletAddress: null,
    stats: {
        bytesRelayed: 0,
        connections: 0,
        uptime: 0,
        earnings: 0
    },
    config: {
        maxBandwidth: 10,
        dailyDataCap: 1000,
        unlimitedData: false
    }
};

// ============== INIT ==============

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    setupEventListeners();
    startAutoRefresh();
});

async function loadState() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        if (response && response.state) {
            state = response.state;
            updateUI();
            updateConfigUI();
        }
    } catch (err) {
        console.error('Failed to load state:', err);
    }
}

// ============== EVENT LISTENERS ==============

function setupEventListeners() {
    // Bandwidth slider
    const bwSlider = document.getElementById('bwSlider');
    bwSlider.addEventListener('input', () => {
        document.getElementById('bwVal').textContent = bwSlider.value + ' Mbps';
    });
    bwSlider.addEventListener('change', saveConfig);
    
    // Data cap slider
    const dataSlider = document.getElementById('dataSlider');
    dataSlider.addEventListener('input', updateDataCapDisplay);
    dataSlider.addEventListener('change', saveConfig);
    
    // Unlimited checkbox
    const unlimited = document.getElementById('unlimitedData');
    unlimited.addEventListener('change', () => {
        toggleUnlimited();
        saveConfig();
    });
}

// ============== UI UPDATES ==============

function updateUI() {
    const statusCard = document.getElementById('statusCard');
    const indicator = document.getElementById('statusIndicator');
    const icon = document.getElementById('statusIcon');
    const text = document.getElementById('statusText');
    const sub = document.getElementById('statusSub');
    const btn = document.getElementById('mainBtn');
    const walletEl = document.getElementById('walletAddress');
    const walletBtn = document.getElementById('walletBtn');
    
    // Status
    if (state.isActive) {
        statusCard.classList.add('online');
        icon.textContent = '●';
        text.textContent = 'ONLINE';
        sub.textContent = 'Relaying traffic...';
        btn.textContent = 'STOP';
        btn.className = 'btn btn-danger';
    } else {
        statusCard.classList.remove('online');
        icon.textContent = '○';
        text.textContent = 'OFFLINE';
        sub.textContent = state.walletAddress ? 'Ready to earn' : 'Connect wallet to start';
        btn.textContent = 'START EARNING';
        btn.className = 'btn btn-primary';
    }
    
    // Wallet
    if (state.walletAddress) {
        const addr = state.walletAddress;
        walletEl.textContent = addr.slice(0, 4) + '...' + addr.slice(-4);
        walletEl.classList.remove('empty');
        walletBtn.textContent = 'Change';
    } else {
        walletEl.textContent = 'Not connected';
        walletEl.classList.add('empty');
        walletBtn.textContent = 'Connect';
    }
    
    // Stats
    updateStats();
}

function updateStats() {
    const stats = state.stats;
    
    // Data relayed
    const mb = stats.bytesRelayed / (1024 * 1024);
    if (mb < 1) {
        document.getElementById('dataRelayed').textContent = Math.round(stats.bytesRelayed / 1024) + ' KB';
    } else if (mb < 1000) {
        document.getElementById('dataRelayed').textContent = mb.toFixed(1) + ' MB';
    } else {
        document.getElementById('dataRelayed').textContent = (mb / 1024).toFixed(2) + ' GB';
    }
    
    // Uptime
    const hours = Math.floor(stats.uptime / 3600);
    const mins = Math.floor((stats.uptime % 3600) / 60);
    const secs = stats.uptime % 60;
    if (hours > 0) {
        document.getElementById('uptime').textContent = `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        document.getElementById('uptime').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    // Connections
    document.getElementById('connections').textContent = stats.connections.toLocaleString();
    
    // Earnings
    document.getElementById('earnings').textContent = '$' + stats.earnings.toFixed(4);
    
    // Rate
    const hourlyRate = stats.uptime > 60 ? (stats.earnings / stats.uptime * 3600) : 0;
    document.getElementById('rate').textContent = '$' + hourlyRate.toFixed(2) + '/hr';
}

function updateConfigUI() {
    const config = state.config;
    
    // Bandwidth
    document.getElementById('bwSlider').value = config.maxBandwidth;
    document.getElementById('bwVal').textContent = config.maxBandwidth + ' Mbps';
    
    // Data cap
    document.getElementById('dataSlider').value = config.dailyDataCap;
    document.getElementById('unlimitedData').checked = config.unlimitedData;
    
    if (config.unlimitedData) {
        document.getElementById('dataSlider').disabled = true;
        document.getElementById('dataVal').textContent = 'UNLIMITED';
    } else {
        document.getElementById('dataSlider').disabled = false;
        updateDataCapDisplay();
    }
}

function updateDataCapDisplay() {
    const val = parseInt(document.getElementById('dataSlider').value);
    let display;
    
    if (val < 1000) {
        display = val + ' MB';
    } else if (val < 10000) {
        display = (val / 1000).toFixed(1) + ' GB';
    } else {
        display = Math.round(val / 1000) + ' GB';
    }
    
    document.getElementById('dataVal').textContent = display;
}

function toggleUnlimited() {
    const checkbox = document.getElementById('unlimitedData');
    const slider = document.getElementById('dataSlider');
    
    if (checkbox.checked) {
        slider.disabled = true;
        document.getElementById('dataVal').textContent = 'UNLIMITED';
    } else {
        slider.disabled = false;
        updateDataCapDisplay();
    }
}

// ============== ACTIONS ==============

async function toggleAgent() {
    const btn = document.getElementById('mainBtn');
    btn.disabled = true;
    
    try {
        if (state.isActive) {
            await chrome.runtime.sendMessage({ type: 'STOP_AGENT' });
        } else {
            if (!state.walletAddress) {
                alert('Connect your wallet first');
                btn.disabled = false;
                return;
            }
            const response = await chrome.runtime.sendMessage({ type: 'START_AGENT' });
            if (!response.success) {
                alert(response.error || 'Failed to start agent');
            }
        }
        await loadState();
    } catch (err) {
        console.error('Toggle failed:', err);
        alert('Failed to toggle agent');
    }
    
    btn.disabled = false;
}

async function handleWallet() {
    if (state.walletAddress) {
        // Already connected - offer to disconnect
        if (confirm('Disconnect wallet?')) {
            await chrome.runtime.sendMessage({ type: 'DISCONNECT_WALLET' });
            await loadState();
        }
    } else {
        // Connect new wallet
        const address = prompt('Enter your Solana wallet address:');
        
        if (!address) return;
        
        if (address.length < 32 || address.length > 44) {
            alert('Invalid wallet address. Solana addresses are 32-44 characters.');
            return;
        }
        
        try {
            const response = await chrome.runtime.sendMessage({ 
                type: 'SET_WALLET', 
                address: address.trim() 
            });
            
            if (response.success) {
                await loadState();
            } else {
                alert(response.error || 'Failed to set wallet');
            }
        } catch (err) {
            console.error('Wallet set failed:', err);
            alert('Failed to connect wallet');
        }
    }
}

async function saveConfig() {
    const config = {
        maxBandwidth: parseInt(document.getElementById('bwSlider').value),
        dailyDataCap: parseInt(document.getElementById('dataSlider').value),
        unlimitedData: document.getElementById('unlimitedData').checked
    };
    
    try {
        await chrome.runtime.sendMessage({ type: 'UPDATE_CONFIG', config });
        state.config = config;
    } catch (err) {
        console.error('Failed to save config:', err);
    }
}

// ============== AUTO REFRESH ==============

function startAutoRefresh() {
    setInterval(async () => {
        if (state.isActive) {
            await loadState();
        }
    }, 3000);
}

// Listen for background updates
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE' && message.state) {
        state = message.state;
        updateUI();
    }
});
