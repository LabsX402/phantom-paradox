# Meteora DLMM Integration

Connect Phantom Paradox to Meteora liquidity pools for real DeFi testing.

## Quick Start

```bash
# 1. Search for existing pools
npm run meteora:find

# 2. Quick SDK test (uses any available pool)
npm run meteora:quick

# 3. Full test with PDOX pool (after setup)
npm run meteora:test
```

## Setup PDOX/SOL Pool

### Option 1: Via Meteora UI (Recommended)

1. Go to [Meteora App](https://app.meteora.ag/dlmm)
2. Click "Create New Pool" 
3. Configure:
   - **Token X (Base):** `4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF` (PDOX)
   - **Token Y (Quote):** `So11111111111111111111111111111111111111112` (Wrapped SOL)
   - **Bin Step:** 25 (0.25% per bin, good for volatile pairs)
4. Add initial liquidity (e.g., 1 SOL + equivalent PDOX)
5. Copy pool address and add to `.env`:
   ```
   METEORA_PDOX_POOL=<your_pool_address>
   ```

### Option 2: Use Existing Test Pool

For testing SDK integration without PDOX:
```bash
# Find a SOL pair pool
npm run meteora:find

# Set in .env (any pool works for testing)
METEORA_PDOX_POOL=F2ZNdwdf4WoR42H27Y4NHkC22VEbsSrb8zQaZKhLhBjk
```

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Find Pools | `npm run meteora:find` | Search for existing pools |
| Quick Test | `npm run meteora:quick` | Test SDK with any pool |
| Create Pool | `npm run meteora:create` | Pool creation guide |
| Add Liquidity | `npm run meteora:liquidity [sol] [pdox]` | Add LP to pool |
| Swap | `npm run meteora:swap [buy/sell] [amount]` | Execute swap |
| Full Test | `npm run meteora:test` | Complete integration test |

## Environment Variables

```env
# Required
DEPLOYER_PRIVATE_KEY=<base58_or_json_array>
SOLANA_RPC_URL=https://api.devnet.solana.com

# After pool creation
METEORA_PDOX_POOL=<pool_address>
```

## Key Addresses

| Item | Address |
|------|---------|
| Meteora DLMM Program | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` |
| PDOX Token (Token-2022) | `4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF` |
| Wrapped SOL | `So11111111111111111111111111111111111111112` |

## Token-2022 Note

PDOX uses Token-2022 with 3% transfer fee. Meteora DLMM supports Token-2022 extensions, but ensure:
- Pool is created with Token-2022 support enabled
- Transfer fee is accounted for in swap calculations

## Integration with Netting Engine

After pool setup, route swaps through the netting engine:

```typescript
import { MeteoraIntegration } from './integrations/meteora';
import { NettingEngine } from './netting/engine';

// Create swap intent
const intent = {
  type: 'SWAP',
  pool: METEORA_PDOX_POOL,
  amountIn: 0.1 * LAMPORTS_PER_SOL,
  direction: 'buy', // SOL -> PDOX
};

// Batch with other intents
nettingEngine.addIntent(intent);

// Settle batch (includes swaps + transfers)
await nettingEngine.settleBatch();
```

## Troubleshooting

### Pool not found
- Check if pool exists: `npm run meteora:find`
- Ensure using correct network (devnet vs mainnet)

### Wallet errors
- Set `DEPLOYER_PRIVATE_KEY` in `.env`
- Format: base58 string or JSON array of numbers

### Low liquidity
- Add more liquidity: `npm run meteora:liquidity 1 1000000`

### Transaction fails
- Check SOL balance for fees
- Verify token balances
- Check slippage settings

