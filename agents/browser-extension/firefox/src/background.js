/**
 * PHANTOM PARADOX BROWSER AGENT
 * Background Script (Firefox)
 * 
 * Note: Firefox uses browser.* API (with chrome.* polyfill)
 */

// Polyfill for chrome -> browser
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

const CONFIG = {
    MANAGER_URL: 'https://api.phantomparadox.io',
    HEARTBEAT_INTERVAL: 30000,
    STATS_INTERVAL: 60000,
    VERSION: '0.1.0',
    PLATFORM: 'firefox'
};

let state = {
    isActive: false,
    walletAddress: null,
    sessionStart: null,
    stats: { bytesRelayed: 0, connections: 0, uptime: 0, earnings: 0 }
};

// ============== INITIALIZATION ==============

browserAPI.runtime.onInstalled.addListener(() => {
    console.log('[Agent] Phantom Paradox Agent installed (Firefox)');
    loadState();
});

// ============== STATE MANAGEMENT ==============

async function loadState() {
    try {
        const stored = await browserAPI.storage.local.get(['agentState']);
        if (stored.agentState) {
            state = { ...state, ...stored.agentState };
        }
        if (state.isActive && state.walletAddress) {
            startAgent();
        }
    } catch (err) {
        console.error('Failed to load state:', err);
    }
}

async function saveState() {
    await browserAPI.storage.local.set({ agentState: state });
}

// ============== AGENT CONTROL ==============

function startAgent() {
    if (state.isActive) return;
    
    state.isActive = true;
    state.sessionStart = Date.now();
    
    browserAPI.alarms.create('heartbeat', { periodInMinutes: 0.5 });
    browserAPI.alarms.create('statsUpdate', { periodInMinutes: 1 });
    
    saveState();
    updateBadge();
    broadcastState();
}

function stopAgent() {
    state.isActive = false;
    state.sessionStart = null;
    
    browserAPI.alarms.clear('heartbeat');
    browserAPI.alarms.clear('statsUpdate');
    
    saveState();
    updateBadge();
    broadcastState();
}

function updateBadge() {
    if (state.isActive) {
        browserAPI.browserAction.setBadgeText({ text: 'ON' });
        browserAPI.browserAction.setBadgeBackgroundColor({ color: '#00ff88' });
    } else {
        browserAPI.browserAction.setBadgeText({ text: '' });
    }
}

function broadcastState() {
    browserAPI.runtime.sendMessage({ type: 'STATE_UPDATE', state }).catch(() => {});
}

// ============== ALARMS ==============

browserAPI.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'heartbeat') {
        sendHeartbeat();
    } else if (alarm.name === 'statsUpdate') {
        updateStats();
    }
});

// ============== HEARTBEAT ==============

async function sendHeartbeat() {
    if (!state.isActive || !state.walletAddress) return;
    
    const heartbeat = {
        type: 'heartbeat',
        agentAddress: state.walletAddress,
        status: 'online',
        capabilities: ['relay'],
        metrics: {
            bytesRelayed: state.stats.bytesRelayed,
            uptime: state.sessionStart ? Math.floor((Date.now() - state.sessionStart) / 1000) : 0
        },
        version: CONFIG.VERSION,
        platform: CONFIG.PLATFORM
    };
    
    console.log('[Agent] Heartbeat:', heartbeat);
    
    // Simulate relay activity
    state.stats.bytesRelayed += Math.floor(Math.random() * 1024 * 100);
    state.stats.connections += Math.floor(Math.random() * 3);
}

// ============== STATS ==============

function updateStats() {
    if (!state.isActive) return;
    
    if (state.sessionStart) {
        state.stats.uptime = Math.floor((Date.now() - state.sessionStart) / 1000);
    }
    
    const mbRelayed = state.stats.bytesRelayed / (1024 * 1024);
    state.stats.earnings = mbRelayed * 0.001;
    
    saveState();
    browserAPI.runtime.sendMessage({ type: 'STATS_UPDATE', stats: state.stats }).catch(() => {});
}

// ============== MESSAGE HANDLING ==============

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'GET_STATE':
            sendResponse({ state });
            break;
        case 'START_AGENT':
            if (!state.walletAddress) {
                sendResponse({ success: false, error: 'No wallet' });
            } else {
                startAgent();
                sendResponse({ success: true });
            }
            break;
        case 'STOP_AGENT':
            stopAgent();
            sendResponse({ success: true });
            break;
        case 'SET_WALLET':
            state.walletAddress = message.address;
            saveState();
            sendResponse({ success: true });
            break;
        case 'RESET_STATS':
            state.stats = { bytesRelayed: 0, connections: 0, uptime: 0, earnings: 0 };
            saveState();
            sendResponse({ success: true });
            break;
    }
    return true;
});

console.log('[Agent] Background script loaded (Firefox)');
loadState();

