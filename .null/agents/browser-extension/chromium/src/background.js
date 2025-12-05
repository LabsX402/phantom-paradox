/**
 * PHANTOM PARADOX BROWSER AGENT
 * Background Service Worker (Chromium - Chrome/Edge/Brave/Opera)
 * Version: 0.1.0
 * 
 * Features:
 * - Relay traffic sharing (bandwidth)
 * - Heartbeat reporting to manager
 * - Earnings tracking
 * - Config persistence
 * - Auto-reconnect on startup
 */

// ============== CONFIGURATION ==============

const CONFIG = {
    VERSION: '0.1.0',
    PLATFORM: 'chromium',
    MANAGER_URL: 'https://api.phantomparadox.io',
    HEARTBEAT_MINUTES: 0.5,
    STATS_MINUTES: 1,
    EARNINGS_PER_MB: 0.001, // $0.001 per MB
    EARNINGS_PER_MINUTE: 0.0001, // $0.0001 per minute idle
};

// ============== STATE ==============

let state = {
    isActive: false,
    walletAddress: null,
    sessionStart: null,
    lastHeartbeat: null,
    stats: {
        bytesRelayed: 0,
        bytesToday: 0,
        connections: 0,
        uptime: 0,
        earnings: 0,
        earningsTotal: 0
    },
    config: {
        maxBandwidth: 10,
        dailyDataCap: 1000,
        unlimitedData: false,
        autoStart: false,
        notifications: true
    }
};

// ============== LIFECYCLE ==============

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[PP Agent] Installed:', details.reason);
    await loadState();
    
    if (details.reason === 'install') {
        // First install - show welcome
        showNotification('Welcome!', 'Phantom Paradox Agent installed. Connect your wallet to start earning.');
    }
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('[PP Agent] Browser started');
    await loadState();
    
    if (state.config.autoStart && state.walletAddress) {
        startAgent();
    }
});

// ============== STATE MANAGEMENT ==============

async function loadState() {
    try {
        const stored = await chrome.storage.local.get(['ppAgentState', 'ppAgentConfig']);
        
        if (stored.ppAgentState) {
            state = { ...state, ...stored.ppAgentState };
            // Reset session-specific data
            state.sessionStart = null;
            state.isActive = false;
        }
        
        if (stored.ppAgentConfig) {
            state.config = { ...state.config, ...stored.ppAgentConfig };
        }
        
        console.log('[PP Agent] State loaded');
    } catch (err) {
        console.error('[PP Agent] Failed to load state:', err);
    }
}

async function saveState() {
    try {
        await chrome.storage.local.set({
            ppAgentState: {
                walletAddress: state.walletAddress,
                stats: state.stats
            },
            ppAgentConfig: state.config
        });
    } catch (err) {
        console.error('[PP Agent] Failed to save state:', err);
    }
}

// ============== AGENT CONTROL ==============

function startAgent() {
    if (state.isActive) {
        console.log('[PP Agent] Already running');
        return false;
    }
    
    if (!state.walletAddress) {
        console.log('[PP Agent] No wallet connected');
        return false;
    }
    
    console.log('[PP Agent] Starting...');
    
    state.isActive = true;
    state.sessionStart = Date.now();
    state.stats.bytesToday = 0;
    
    // Start alarms
    chrome.alarms.create('heartbeat', { periodInMinutes: CONFIG.HEARTBEAT_MINUTES });
    chrome.alarms.create('statsUpdate', { periodInMinutes: CONFIG.STATS_MINUTES });
    chrome.alarms.create('dailyReset', { periodInMinutes: 60 }); // Check hourly
    
    updateBadge();
    saveState();
    broadcastUpdate();
    
    if (state.config.notifications) {
        showNotification('Agent Started', 'You are now earning by relaying traffic.');
    }
    
    console.log('[PP Agent] Started successfully');
    return true;
}

function stopAgent() {
    if (!state.isActive) {
        return false;
    }
    
    console.log('[PP Agent] Stopping...');
    
    state.isActive = false;
    state.sessionStart = null;
    
    // Clear alarms
    chrome.alarms.clear('heartbeat');
    chrome.alarms.clear('statsUpdate');
    
    updateBadge();
    saveState();
    broadcastUpdate();
    
    console.log('[PP Agent] Stopped');
    return true;
}

// ============== BADGE ==============

function updateBadge() {
    if (state.isActive) {
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#00ff88' });
        chrome.action.setTitle({ title: 'Phantom Paradox Agent - ONLINE' });
    } else {
        chrome.action.setBadgeText({ text: '' });
        chrome.action.setTitle({ title: 'Phantom Paradox Agent - OFFLINE' });
    }
}

// ============== ALARMS ==============

chrome.alarms.onAlarm.addListener(async (alarm) => {
    switch (alarm.name) {
        case 'heartbeat':
            await sendHeartbeat();
            break;
        case 'statsUpdate':
            updateStats();
            break;
        case 'dailyReset':
            checkDailyReset();
            break;
    }
});

// ============== HEARTBEAT ==============

async function sendHeartbeat() {
    if (!state.isActive || !state.walletAddress) return;
    
    const uptime = state.sessionStart ? Math.floor((Date.now() - state.sessionStart) / 1000) : 0;
    
    const heartbeat = {
        type: 'heartbeat',
        version: CONFIG.VERSION,
        platform: CONFIG.PLATFORM,
        agent: state.walletAddress,
        status: 'online',
        capabilities: ['relay'],
        config: {
            maxBandwidth: state.config.maxBandwidth,
            dailyDataCap: state.config.unlimitedData ? -1 : state.config.dailyDataCap
        },
        metrics: {
            bytesRelayed: state.stats.bytesRelayed,
            bytesToday: state.stats.bytesToday,
            connections: state.stats.connections,
            uptime: uptime
        },
        timestamp: Date.now()
    };
    
    try {
        // TODO: Send to actual manager endpoint
        // const response = await fetch(CONFIG.MANAGER_URL + '/heartbeat', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify(heartbeat)
        // });
        
        console.log('[PP Agent] Heartbeat:', heartbeat);
        state.lastHeartbeat = Date.now();
        
        // Simulate relay activity (replace with real metrics)
        simulateRelayActivity();
        
    } catch (err) {
        console.error('[PP Agent] Heartbeat failed:', err);
    }
}

function simulateRelayActivity() {
    // Simulate bandwidth usage based on config
    const maxBytes = state.config.maxBandwidth * 1024 * 1024 / 60 * CONFIG.HEARTBEAT_MINUTES; // MB to bytes per interval
    const bytes = Math.floor(Math.random() * maxBytes * 0.3); // 0-30% of max
    
    state.stats.bytesRelayed += bytes;
    state.stats.bytesToday += bytes;
    state.stats.connections += Math.floor(Math.random() * 5);
    
    // Check daily cap
    if (!state.config.unlimitedData) {
        const capBytes = state.config.dailyDataCap * 1024 * 1024;
        if (state.stats.bytesToday >= capBytes) {
            console.log('[PP Agent] Daily cap reached, pausing...');
            stopAgent();
            showNotification('Daily Cap Reached', `You've used ${state.config.dailyDataCap} MB today. Agent paused.`);
        }
    }
}

// ============== STATS ==============

function updateStats() {
    if (!state.isActive) return;
    
    // Calculate uptime
    if (state.sessionStart) {
        state.stats.uptime = Math.floor((Date.now() - state.sessionStart) / 1000);
    }
    
    // Calculate earnings
    const mbRelayed = state.stats.bytesRelayed / (1024 * 1024);
    const minutesActive = state.stats.uptime / 60;
    
    state.stats.earnings = (mbRelayed * CONFIG.EARNINGS_PER_MB) + (minutesActive * CONFIG.EARNINGS_PER_MINUTE);
    
    saveState();
    broadcastUpdate();
}

function checkDailyReset() {
    const now = new Date();
    const stored = localStorage.getItem('ppLastResetDate');
    const today = now.toDateString();
    
    if (stored !== today) {
        console.log('[PP Agent] Daily reset');
        state.stats.bytesToday = 0;
        state.stats.earningsTotal += state.stats.earnings;
        localStorage.setItem('ppLastResetDate', today);
        saveState();
    }
}

// ============== NOTIFICATIONS ==============

function showNotification(title, message) {
    if (!state.config.notifications) return;
    
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Phantom Paradox: ' + title,
        message: message
    });
}

// ============== MESSAGING ==============

function broadcastUpdate() {
    chrome.runtime.sendMessage({
        type: 'STATE_UPDATE',
        state: getPublicState()
    }).catch(() => {}); // Ignore if popup not open
}

function getPublicState() {
    return {
        isActive: state.isActive,
        walletAddress: state.walletAddress,
        sessionStart: state.sessionStart,
        stats: { ...state.stats },
        config: { ...state.config }
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[PP Agent] Message:', message.type);
    
    (async () => {
        let response = { success: true };
        
        switch (message.type) {
            case 'GET_STATE':
                response = { state: getPublicState() };
                break;
                
            case 'START_AGENT':
                response.success = startAgent();
                if (!response.success) {
                    response.error = state.walletAddress ? 'Already running' : 'Connect wallet first';
                }
                break;
                
            case 'STOP_AGENT':
                response.success = stopAgent();
                break;
                
            case 'SET_WALLET':
                if (message.address && message.address.length >= 32) {
                    state.walletAddress = message.address;
                    saveState();
                    broadcastUpdate();
                } else {
                    response = { success: false, error: 'Invalid wallet address' };
                }
                break;
                
            case 'UPDATE_CONFIG':
                if (message.config) {
                    state.config = { ...state.config, ...message.config };
                    saveState();
                    broadcastUpdate();
                }
                break;
                
            case 'RESET_STATS':
                state.stats = {
                    bytesRelayed: 0,
                    bytesToday: 0,
                    connections: 0,
                    uptime: 0,
                    earnings: 0,
                    earningsTotal: state.stats.earningsTotal
                };
                saveState();
                broadcastUpdate();
                break;
                
            case 'DISCONNECT_WALLET':
                stopAgent();
                state.walletAddress = null;
                saveState();
                broadcastUpdate();
                break;
                
            default:
                response = { success: false, error: 'Unknown message type' };
        }
        
        sendResponse(response);
    })();
    
    return true; // Keep channel open for async
});

// ============== INIT ==============

console.log('[PP Agent] Service worker loaded v' + CONFIG.VERSION);
loadState();
