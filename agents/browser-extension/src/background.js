/**
 * PHANTOM PARADOX BROWSER AGENT
 * Background Service Worker
 * 
 * Handles:
 * - Relay connections (bandwidth sharing)
 * - Heartbeat to manager
 * - Stats tracking
 * - Wallet connection state
 */

// ============== CONFIG ==============

const CONFIG = {
    MANAGER_URL: 'https://api.phantomparadox.io', // TODO: replace with real
    HEARTBEAT_INTERVAL: 30000, // 30 seconds
    STATS_INTERVAL: 60000, // 1 minute
    VERSION: '0.1.0'
};

// ============== STATE ==============

let state = {
    isActive: false,
    walletAddress: null,
    sessionStart: null,
    stats: {
        bytesRelayed: 0,
        connections: 0,
        uptime: 0,
        earnings: 0
    }
};

// ============== INITIALIZATION ==============

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Agent] Phantom Paradox Agent installed');
    loadState();
});

chrome.runtime.onStartup.addListener(() => {
    console.log('[Agent] Browser started, loading state');
    loadState();
});

// ============== STATE MANAGEMENT ==============

async function loadState() {
    const stored = await chrome.storage.local.get(['agentState']);
    if (stored.agentState) {
        state = { ...state, ...stored.agentState };
        console.log('[Agent] State loaded:', state);
    }
    
    if (state.isActive) {
        startAgent();
    }
}

async function saveState() {
    await chrome.storage.local.set({ agentState: state });
}

// ============== AGENT CONTROL ==============

function startAgent() {
    if (state.isActive) return;
    
    state.isActive = true;
    state.sessionStart = Date.now();
    
    // Start heartbeat
    chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
    chrome.alarms.create('statsUpdate', { periodInMinutes: 1 });
    
    saveState();
    console.log('[Agent] Started');
    
    // Notify popup
    chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state });
}

function stopAgent() {
    state.isActive = false;
    state.sessionStart = null;
    
    chrome.alarms.clear('heartbeat');
    chrome.alarms.clear('statsUpdate');
    
    saveState();
    console.log('[Agent] Stopped');
    
    chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state });
}

// ============== ALARMS ==============

chrome.alarms.onAlarm.addListener((alarm) => {
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
        platform: 'browser-extension'
    };
    
    try {
        // TODO: Send to real manager endpoint
        console.log('[Agent] Heartbeat:', heartbeat);
        
        // Simulate relay activity for demo
        state.stats.bytesRelayed += Math.floor(Math.random() * 1024 * 100);
        state.stats.connections += Math.floor(Math.random() * 3);
        
    } catch (err) {
        console.error('[Agent] Heartbeat failed:', err);
    }
}

// ============== STATS ==============

function updateStats() {
    if (!state.isActive) return;
    
    // Calculate uptime
    if (state.sessionStart) {
        state.stats.uptime = Math.floor((Date.now() - state.sessionStart) / 1000);
    }
    
    // Estimate earnings (demo: $0.001 per MB relayed)
    const mbRelayed = state.stats.bytesRelayed / (1024 * 1024);
    state.stats.earnings = mbRelayed * 0.001;
    
    saveState();
    
    // Notify popup
    chrome.runtime.sendMessage({ type: 'STATS_UPDATE', stats: state.stats });
}

// ============== MESSAGE HANDLING ==============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Agent] Message received:', message);
    
    switch (message.type) {
        case 'GET_STATE':
            sendResponse({ state });
            break;
            
        case 'START_AGENT':
            startAgent();
            sendResponse({ success: true });
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
            state.stats = {
                bytesRelayed: 0,
                connections: 0,
                uptime: 0,
                earnings: 0
            };
            saveState();
            sendResponse({ success: true });
            break;
            
        default:
            sendResponse({ error: 'Unknown message type' });
    }
    
    return true; // Keep channel open for async response
});

console.log('[Agent] Background service worker loaded');

