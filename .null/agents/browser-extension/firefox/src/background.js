/**
 * PHANTOM PARADOX BROWSER AGENT
 * Background Script (Firefox)
 * Version: 0.1.0
 * 
 * Note: Firefox uses browser.* API with Promises
 */

// API compatibility layer
const api = typeof browser !== 'undefined' ? browser : chrome;

// ============== CONFIGURATION ==============

const CONFIG = {
    VERSION: '0.1.0',
    PLATFORM: 'firefox',
    MANAGER_URL: 'https://api.phantomparadox.io',
    HEARTBEAT_MINUTES: 0.5,
    STATS_MINUTES: 1,
    EARNINGS_PER_MB: 0.001,
    EARNINGS_PER_MINUTE: 0.0001,
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

api.runtime.onInstalled.addListener(async (details) => {
    console.log('[PP Agent] Installed:', details.reason);
    await loadState();
    
    if (details.reason === 'install') {
        showNotification('Welcome!', 'Phantom Paradox Agent installed. Connect your wallet to start earning.');
    }
});

// Load state on startup
loadState().then(() => {
    if (state.config.autoStart && state.walletAddress) {
        startAgent();
    }
});

// ============== STATE MANAGEMENT ==============

async function loadState() {
    try {
        const stored = await api.storage.local.get(['ppAgentState', 'ppAgentConfig']);
        
        if (stored.ppAgentState) {
            state = { ...state, ...stored.ppAgentState };
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
        await api.storage.local.set({
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
    if (state.isActive) return false;
    if (!state.walletAddress) return false;
    
    console.log('[PP Agent] Starting...');
    
    state.isActive = true;
    state.sessionStart = Date.now();
    state.stats.bytesToday = 0;
    
    api.alarms.create('heartbeat', { periodInMinutes: CONFIG.HEARTBEAT_MINUTES });
    api.alarms.create('statsUpdate', { periodInMinutes: CONFIG.STATS_MINUTES });
    
    updateBadge();
    saveState();
    broadcastUpdate();
    
    if (state.config.notifications) {
        showNotification('Agent Started', 'You are now earning by relaying traffic.');
    }
    
    return true;
}

function stopAgent() {
    if (!state.isActive) return false;
    
    console.log('[PP Agent] Stopping...');
    
    state.isActive = false;
    state.sessionStart = null;
    
    api.alarms.clear('heartbeat');
    api.alarms.clear('statsUpdate');
    
    updateBadge();
    saveState();
    broadcastUpdate();
    
    return true;
}

// ============== BADGE ==============

function updateBadge() {
    if (state.isActive) {
        api.browserAction.setBadgeText({ text: 'ON' });
        api.browserAction.setBadgeBackgroundColor({ color: '#00ff88' });
    } else {
        api.browserAction.setBadgeText({ text: '' });
    }
}

// ============== ALARMS ==============

api.alarms.onAlarm.addListener(async (alarm) => {
    switch (alarm.name) {
        case 'heartbeat':
            await sendHeartbeat();
            break;
        case 'statsUpdate':
            updateStats();
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
    
    console.log('[PP Agent] Heartbeat:', heartbeat);
    state.lastHeartbeat = Date.now();
    
    // Simulate relay activity
    const maxBytes = state.config.maxBandwidth * 1024 * 1024 / 60 * CONFIG.HEARTBEAT_MINUTES;
    const bytes = Math.floor(Math.random() * maxBytes * 0.3);
    
    state.stats.bytesRelayed += bytes;
    state.stats.bytesToday += bytes;
    state.stats.connections += Math.floor(Math.random() * 5);
    
    // Check daily cap
    if (!state.config.unlimitedData) {
        const capBytes = state.config.dailyDataCap * 1024 * 1024;
        if (state.stats.bytesToday >= capBytes) {
            stopAgent();
            showNotification('Daily Cap Reached', `You've used ${state.config.dailyDataCap} MB today.`);
        }
    }
}

// ============== STATS ==============

function updateStats() {
    if (!state.isActive) return;
    
    if (state.sessionStart) {
        state.stats.uptime = Math.floor((Date.now() - state.sessionStart) / 1000);
    }
    
    const mbRelayed = state.stats.bytesRelayed / (1024 * 1024);
    const minutesActive = state.stats.uptime / 60;
    
    state.stats.earnings = (mbRelayed * CONFIG.EARNINGS_PER_MB) + (minutesActive * CONFIG.EARNINGS_PER_MINUTE);
    
    saveState();
    broadcastUpdate();
}

// ============== NOTIFICATIONS ==============

function showNotification(title, message) {
    if (!state.config.notifications) return;
    
    api.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Phantom Paradox: ' + title,
        message: message
    });
}

// ============== MESSAGING ==============

function broadcastUpdate() {
    api.runtime.sendMessage({
        type: 'STATE_UPDATE',
        state: getPublicState()
    }).catch(() => {});
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

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[PP Agent] Message:', message.type);
    
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
    return true;
});

console.log('[PP Agent] Background script loaded v' + CONFIG.VERSION + ' (Firefox)');
