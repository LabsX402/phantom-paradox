/**
 * PHANTOM SWARM SIMULATOR
 * 
 * Simulates 50 Agents pounding the WRAITH C2 with heartbeats.
 * Tests: Load Factor Logic, Earnings Calculation, and Stability.
 * 
 * Uses PARADOX Engine (π-Standard) for earnings calculation.
 */

const axios = require('axios');
const crypto = require('crypto');
const bs58 = require('bs58');
const nacl = require('tweetnacl');

// CONFIG
const C2_URL = 'http://localhost:3000/api/heartbeat';
const AGENT_COUNT = 50;
const PULSE_INTERVAL = 2000; // Fast pulse (2s)

// MOCK AGENTS
const agents = Array.from({ length: AGENT_COUNT }, (_, i) => {
    const keypair = nacl.sign.keyPair();
    return {
        id: bs58.encode(keypair.publicKey),
        secret: keypair.secretKey,
        region: ['US', 'JP', 'DE', 'SG'][Math.floor(Math.random() * 4)],
        capacity: 100 + Math.floor(Math.random() * 900), // 100-1000 Mbps
        users: 0 // Starts empty
    };
});

console.log(`[SIM] 🚀 Launching ${AGENT_COUNT} Agents...`);
console.log(`[SIM] 📡 C2 Endpoint: ${C2_URL}`);
console.log(`[SIM] ⚡ Pulse Rate: Every ${PULSE_INTERVAL}ms`);
console.log(`[SIM] 🔥 Using PARADOX Engine (π-Standard) for earnings\n`);

// Statistics tracking
const stats = {
    totalHeartbeats: 0,
    successfulHeartbeats: 0,
    failedHeartbeats: 0,
    totalEarnings: 0,
    agentEarnings: new Map(),
    startTime: Date.now(),
    errors: []
};

// SIMULATION LOOP
const interval = setInterval(async () => {
    // Pick random agent to update
    const agent = agents[Math.floor(Math.random() * agents.length)];
    
    // Simulate Traffic Fluctuation
    if (Math.random() > 0.5) agent.users += 1;
    else if (agent.users > 0) agent.users -= 1;
    
    // Calculate Load (Same logic as Agent Node)
    const guaranteed = 10; // 10Mbps per user
    const load = Math.min((agent.users * guaranteed / agent.capacity) * 100, 100);
    
    // Payload
    const payload = {
        agent_id: agent.id,
        metrics: {
            active_connections: agent.users,
            bytes_relayed_delta: Math.floor(Math.random() * 50 * 1024 * 1024), // 0-50MB
            latency_ms: 10 + Math.floor(Math.random() * 50), // 10-60ms
            load_factor: load,
            speed: agent.capacity * 1024 * 1024,
            current_job: agent.users > 0 ? "JOB_SIM" : null
        },
        timestamp: Date.now()
    };
    
    // Sign
    const msg = new TextEncoder().encode(JSON.stringify(payload));
    payload.signature = bs58.encode(nacl.sign.detached(msg, agent.secret));
    
    try {
        const start = Date.now();
        const res = await axios.post(C2_URL, payload);
        const rtt = Date.now() - start;
        
        stats.totalHeartbeats++;
        stats.successfulHeartbeats++;
        
        // Track earnings
        if (res.data.earnings_accumulated) {
            const earnings = BigInt(res.data.earnings_accumulated || '0');
            stats.totalEarnings += Number(earnings);
            
            const currentAgentEarnings = stats.agentEarnings.get(agent.id) || 0;
            stats.agentEarnings.set(agent.id, currentAgentEarnings + Number(earnings));
        }
        
        let status = "🟢";
        if (load > 80) status = "🟠";
        if (load >= 100) status = "🔴";
        
        const earningsDisplay = res.data.earnings_accumulated 
            ? `| Earnings: ${(Number(res.data.earnings_accumulated) / 1e9).toFixed(6)} SOL`
            : '';
        
        console.log(`[${status}] Agent ${agent.id.substr(0,4)} | Load: ${load.toFixed(0)}% | Users: ${agent.users} | RTT: ${rtt}ms ${earningsDisplay}`);
    } catch (e) {
        stats.totalHeartbeats++;
        stats.failedHeartbeats++;
        stats.errors.push({
            agent: agent.id.substr(0,4),
            error: e.message,
            timestamp: Date.now()
        });
        console.log(`[❌] Agent ${agent.id.substr(0,4)} Failed: ${e.message}`);
    }
}, 100); // Fire a request every 100ms (10 reqs/sec total)

// Report generator (runs every 12 hours simulation = 12 minutes real time)
const REPORT_INTERVAL = 12 * 60 * 1000; // 12 minutes = 12 hours simulation time

setTimeout(() => {
    clearInterval(interval);
    generateReport();
}, REPORT_INTERVAL);

// Generate comprehensive report
function generateReport() {
    const runtime = Date.now() - stats.startTime;
    const runtimeHours = runtime / (1000 * 60 * 60);
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 PHANTOM SWARM SIMULATION REPORT');
    console.log('='.repeat(80));
    console.log(`\n⏱️  Runtime: ${runtimeHours.toFixed(2)} hours (simulated)`);
    console.log(`📡 Total Heartbeats: ${stats.totalHeartbeats}`);
    console.log(`✅ Successful: ${stats.successfulHeartbeats}`);
    console.log(`❌ Failed: ${stats.failedHeartbeats}`);
    console.log(`📈 Success Rate: ${((stats.successfulHeartbeats / stats.totalHeartbeats) * 100).toFixed(2)}%`);
    console.log(`💰 Total Earnings (All Agents): ${(stats.totalEarnings / 1e9).toFixed(6)} SOL`);
    console.log(`\n🔝 Top 10 Earning Agents:`);
    
    // Sort agents by earnings
    const sortedAgents = Array.from(stats.agentEarnings.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    sortedAgents.forEach(([agentId, earnings], idx) => {
        const agent = agents.find(a => a.id === agentId);
        console.log(`  ${idx + 1}. Agent ${agentId.substr(0,8)}... | ${(earnings / 1e9).toFixed(6)} SOL | Region: ${agent?.region || 'N/A'}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('📝 Report saved to: swarm-simulation-report.json');
    console.log('='.repeat(80) + '\n');
    
    // Save detailed report to file
    const report = {
        timestamp: new Date().toISOString(),
        runtime_hours: runtimeHours,
        statistics: {
            total_heartbeats: stats.totalHeartbeats,
            successful: stats.successfulHeartbeats,
            failed: stats.failedHeartbeats,
            success_rate: (stats.successfulHeartbeats / stats.totalHeartbeats) * 100,
        },
        earnings: {
            total_sol: stats.totalEarnings / 1e9,
            total_lamports: stats.totalEarnings.toString(),
            per_agent_avg: (stats.totalEarnings / AGENT_COUNT) / 1e9,
            top_earners: sortedAgents.map(([id, earnings]) => ({
                agent_id: id,
                earnings_sol: earnings / 1e9,
                earnings_lamports: earnings.toString()
            }))
        },
        agent_details: agents.map(agent => ({
            agent_id: agent.id,
            region: agent.region,
            capacity_mbps: agent.capacity,
            total_earnings_sol: (stats.agentEarnings.get(agent.id) || 0) / 1e9
        })),
        errors: stats.errors.slice(-20) // Last 20 errors
    };
    
    require('fs').writeFileSync('swarm-simulation-report.json', JSON.stringify(report, null, 2));
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Shutting down simulation...');
    clearInterval(interval);
    generateReport();
    process.exit(0);
});

console.log(`\n[INFO] Simulation running. Press Ctrl+C to stop and generate report.\n`);

