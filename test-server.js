/**
 * Simple test server for swarm simulation
 * Implements the heartbeat endpoint
 */

const http = require('http');
const url = require('url');

// In-memory storage for earnings
const agentEarnings = new Map();
const agentHeartbeats = [];

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    const parsedUrl = url.parse(req.url, true);
    
    if (req.method === 'POST' && parsedUrl.pathname === '/api/heartbeat') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const { agent_id, metrics, timestamp, signature } = payload;
                
                // Validate
                if (!agent_id || !metrics || !signature) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'missing_fields' }));
                    return;
                }
                
                // Record heartbeat
                agentHeartbeats.push({
                    agent_id,
                    timestamp: timestamp || Date.now(),
                    metrics
                });
                
                // Calculate earnings using PARADOX engine (simplified)
                const baseRate = 1000; // Base rate in lamports per heartbeat
                const loadMultiplier = Math.min(metrics.load_factor / 100, 1.0);
                const volumeMultiplier = Math.min(metrics.bytes_relayed_delta / (10 * 1024 * 1024), 2.0);
                const latencyPenalty = metrics.latency_ms > 100 ? 0.8 : 1.0;
                
                const heartbeatEarnings = Math.floor(
                    baseRate * loadMultiplier * volumeMultiplier * latencyPenalty
                );
                
                // Store earnings
                const now = Date.now();
                const twelveHoursAgo = now - 12 * 60 * 60 * 1000;
                
                // Get accumulated earnings (last 12 hours)
                let accumulated = 0;
                if (agentEarnings.has(agent_id)) {
                    const earnings = agentEarnings.get(agent_id);
                    accumulated = earnings.filter(e => e.timestamp > twelveHoursAgo)
                        .reduce((sum, e) => sum + e.earnings, 0);
                }
                
                // Add new earnings
                if (!agentEarnings.has(agent_id)) {
                    agentEarnings.set(agent_id, []);
                }
                agentEarnings.get(agent_id).push({
                    earnings: heartbeatEarnings,
                    timestamp: now
                });
                
                const totalEarnings = accumulated + heartbeatEarnings;
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    earnings_accumulated: totalEarnings.toString(),
                    next_payout_estimate: totalEarnings.toString(),
                    heartbeat_earnings: heartbeatEarnings.toString()
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    } else if (req.method === 'GET' && parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            heartbeats: agentHeartbeats.length,
            agents: agentEarnings.size
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Test server running on http://localhost:${PORT}`);
    console.log(`📡 POST /api/heartbeat - Heartbeat endpoint`);
    console.log(`❤️  GET /health - Health check\n`);
});

// Export earnings data for report generation
if (require.main !== module) {
    module.exports = { agentEarnings, agentHeartbeats };
}



