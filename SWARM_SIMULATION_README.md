# PHANTOM SWARM SIMULATION - PARADOX Engine Integration

## Overview

This simulation system tests the WRAITH C2 (Command & Control) system with 50 agents sending heartbeats and earning rewards through the PARADOX (π-Standard) engine.

## Files Created

1. **swarm-sim.js** - Main simulation script
2. **generate-swarm-report.js** - Report generator
3. **offchain/src/api/mobile_bridge.ts** - Updated with POST /heartbeat endpoint

## Setup

### Prerequisites

```bash
npm install axios bs58 tweetnacl
```

### Database Setup

The heartbeat endpoint will automatically create the `agent_earnings` table if it doesn't exist.

## Running the Simulation

### Step 1: Start the Server

Make sure your offchain server is running on `http://localhost:3000`:

```bash
cd offchain
npm run dev
# or
npm start
```

### Step 2: Run the Swarm Simulator

```bash
node swarm-sim.js
```

The simulator will:
- Launch 50 agents
- Send heartbeats every 100ms (10 req/sec total)
- Track earnings using PARADOX engine
- Run for 12 minutes (simulating 12 hours)
- Generate `swarm-simulation-report.json`

### Step 3: Generate Human-Readable Report

```bash
node generate-swarm-report.js
```

This generates `SWARM_SIMULATION_REPORT.md` with:
- Executive summary
- Earnings analysis (after 12 hours)
- Payment method hints (without revealing secrets)
- Top performers
- System metrics

## PARADOX Engine Features

The earnings calculation uses a proprietary algorithm that considers:

1. **Load Factor** - Higher utilization = higher earnings potential
2. **Data Volume** - Bytes relayed contribute to earnings
3. **Latency Performance** - Lower latency = better earnings
4. **System Health** - Network conditions affect earnings
5. **Anonymity Set** - Privacy metrics influence calculations

## Payment Methods (Hints)

The report explains payment methods without revealing exact implementation:

1. **On-Chain Settlement** - Direct SOL transfers via compressed batch settlement
2. **Fiat Bridge** - Conversion to traditional payment methods (hourly batches)
3. **Token Rewards** - Alternative reward mechanism linked to protocol tokenomics

## API Endpoint

### POST /api/heartbeat

Receives agent metrics and calculates earnings.

**Request:**
```json
{
  "agent_id": "string (bs58 encoded pubkey)",
  "metrics": {
    "active_connections": 10,
    "bytes_relayed_delta": 52428800,
    "latency_ms": 25,
    "load_factor": 75.5,
    "speed": 104857600,
    "current_job": "JOB_SIM"
  },
  "timestamp": 1234567890,
  "signature": "string (bs58 encoded signature)"
}
```

**Response:**
```json
{
  "success": true,
  "earnings_accumulated": "1000000000",
  "next_payout_estimate": "1000000000",
  "heartbeat_earnings": "1000"
}
```

## Report Structure

After 12 hours of simulation, the report shows:

- **Total Earnings** - Accumulated SOL across all agents
- **Average per Agent** - Individual agent performance
- **Top Performers** - Ranked by earnings
- **System Stability** - Success rate and error metrics
- **Payment Processing** - How earnings are distributed (hints only)

## Notes

- The exact PARADOX algorithm formula is proprietary
- Payment routing is optimized by the engine
- Earnings accumulate in real-time but settle periodically
- The report doesn't reveal secret source code or exact payment mechanisms

## Troubleshooting

If the server isn't running:
```bash
# Check if port 3000 is in use
netstat -ano | findstr :3000  # Windows
lsof -i :3000                  # Linux/Mac
```

If database errors occur:
- Ensure PostgreSQL is running
- Check database connection in `.env`
- Tables are auto-created on first heartbeat

