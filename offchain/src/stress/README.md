# PHANTOMGRID Gaming - Stress Test Suite

Complete testing infrastructure for validating the marketplace at scale.

## Quick Start

### 1. Pre-flight Checks
```bash
npm run stress:preflight
```
Verifies:
- Git status is clean
- Solana CLI configured
- Anchor version
- Node/npm versions
- Environment file exists

### 2. Build Verification
```bash
npm run stress:build
```
Runs:
- Core-only Anchor build
- Clippy (hardcore mode)
- TypeScript build

### 3. Setup Localnet
```bash
npm run stress:setup
```
- Starts validator (if not running)
- Airdrops SOL
- Builds and deploys program

### 4. Run Scenarios

#### Small Scenario (1,000 auctions)
```bash
npm run stress:small -- --cluster localnet
```

#### Medium Scenario (50,000 auctions)
```bash
npm run stress:medium -- --cluster localnet
```

#### Hyperscale Scenario (250,000 auctions)
```bash
npm run stress:hyperscale -- --cluster localnet
```

#### 10k Snipers Scenario
```bash
npm run stress:snipes -- --cluster localnet --concurrency 1000
```

### 5. Cost Model Calculator
```bash
npm run stress:metrics -- --auctions 1000 --players 5000 --bids 20000 --solPrice 126
```

## Scenario Structure

Each scenario:
1. Creates game + auctions
2. Simulates players and bids (off-chain)
3. Settles auctions (on-chain)
4. Runs invariant checks
5. Exports metrics

## Invariant Checks

All scenarios verify:
- ✅ No double-sell (each auction ≤ 1 winner)
- ✅ Conservation of funds
- ✅ Fee correctness
- ✅ State machine validity
- ✅ All auctions terminal

## Output

Results are exported to `logs/`:
- `stress_scenario_small.json`
- `stress_scenario_medium.json`
- `stress_scenario_hyperscale.json`
- `stress_scenario_snipes_10k.json`
- `cost_model_*.json`

Each includes:
- Transaction counts
- Runtime duration
- Invariant check results
- Cost estimates (SOL & USD)

## Manual Testing Steps

### 1. Start Validator
```bash
solana-test-validator --reset
```

### 2. Deploy Program
```bash
cd Nodezero_engine
anchor deploy -p phantomgrid_gaming --provider.cluster localnet --no-default-features --features core
```

### 3. Setup Database
```bash
export PG_CONNECTION_STRING=postgresql://user:pass@host:5432/phantomgrid_test
psql $PG_CONNECTION_STRING -f migrations/001_initial_schema.sql
psql $PG_CONNECTION_STRING -f migrations/002_compression.sql
```

### 4. Start Infrastructure
```bash
# Terminal 1: Listener
npm run dev:listener

# Terminal 2: API
npm run dev:api
```

### 5. Run Tests
```bash
npm run stress:small
```

## Files

- `preflight.ts` - Pre-flight environment checks
- `build_check.ts` - Build and lint verification
- `setup_localnet.ts` - Localnet setup automation
- `scenario_small.ts` - Small scenario (1k auctions)
- `scenario_medium.ts` - Medium scenario (50k auctions)
- `scenario_hyperscale.ts` - Hyperscale scenario (250k auctions)
- `scenario_snipes_10k.ts` - 10k snipers stress test
- `metrics_cost_model.ts` - Cost model calculator
- `shared/invariants.ts` - Invariant assertion functions
- `shared/metrics.ts` - Metrics calculation utilities
- `shared/scenario_base.ts` - Base scenario runner

## Notes

- All scenarios use core-only build (no compression/ZK features)
- Database must be set up before running scenarios
- Listener should be running to index events
- Results are automatically exported to JSON

