# Full Stack Workflow - Phantom Paradox Vault

## Overview

This document describes the complete end-to-end workflow for the Phantom Paradox Vault system, from user intent submission to on-chain settlement, including all serverless components.

## Architecture Flow

```
User → API (Vercel/Lambda) → Database (Supabase) → Netting Engine (Lambda) → On-Chain Settlement
         ↓                          ↓                        ↓
    SIWS Auth                  IPFS Storage            Event Listener
         ↓                          ↓                        ↓
    Session Keys              Intent Storage          WebSocket/Polling
```

## Workflow Steps

### Phase 1: User Authentication & Session Setup

1. **User Requests Nonce**
   - **Endpoint**: `GET /api/user/nonce`
   - **Handler**: `api-handler.ts` → `routes.ts`
   - **Response**: `{ nonce: "random-string" }`
   - **Storage**: Redis (Upstash) - TTL 5 minutes

2. **User Signs SIWS Message**
   - User creates SIWS message using `createSIWSMessage()`
   - Signs with wallet (Phantom, Solflare, etc.)
   - Message includes: domain, address, nonce, expiration

3. **User Submits Session Key**
   - **Endpoint**: `POST /api/session-keys/create`
   - **Handler**: `api-handler.ts` → `routes.ts` → `session.ts`
   - **Validation**:
     - Verify SIWS signature
     - Check nonce validity
     - Validate session key limits
   - **On-Chain**: Register session key via `register_session_key` instruction
   - **Storage**: Database (Supabase) + IPFS (Pinata) for redundancy

### Phase 2: Intent Submission

1. **User Creates Trade Intent**
   - User signs intent with session key
   - Intent includes:
     - `itemId`: Item to trade
     - `from`: Source wallet
     - `to`: Destination wallet
     - `amountLamports`: Trade amount
     - `nonce`: Replay protection
     - `signature`: Session key signature

2. **Intent Submitted to API**
   - **Endpoint**: `POST /api/intents`
   - **Handler**: `api-handler.ts` → `routes.ts` → `engine.ts`
   - **Validation**:
     - Session key signature verification
     - Session key limits (volume, expiration)
     - Intent age (< 3600s)
     - Rate limiting (1000 intents/sec)
   - **Storage**:
     - Database: `trade_intents` table (Supabase)
     - IPFS: Batch storage for redundancy (Pinata)
     - Redis: Rate limiting cache (Upstash)

3. **Intent Persistence**
   - **Function**: `persistIntent()` in `persistence.ts`
   - **Database**: PostgreSQL (Supabase)
   - **IPFS**: Stored in batches via `storeIntentsToIPFS()`
   - **Status**: `pending`

### Phase 3: Netting Batch Creation

1. **Scheduled Netting Trigger**
   - **Schedule**: Every 30 seconds (EventBridge/Cron)
   - **Handler**: `netting-handler.ts`
   - **Function**: `runNettingBatch()`

2. **Intent Collection**
   - **Function**: `loadIntents()` in `persistence.ts`
   - **Query**: Load pending intents from database
   - **Filters**:
     - Exclude already-processed intents
     - Exclude items in pending batches (double-spend prevention)
     - Age filter (< 3600s)
   - **Minimum**: 1000 intents (configurable)

3. **Netting Algorithm**
   - **Function**: `runNetting()` in `graph.ts` or `fastGraph.ts`
   - **Algorithm**: DFS-based graph traversal
   - **Steps**:
     1. Build dependency graph
     2. Detect cycles
     3. Resolve conflicts (time-weighted)
     4. Compute net cash deltas
     5. Determine final ownership
   - **Performance**: O(n + m) - 1-5ms for 1000 intents

4. **Batch Creation**
   - **Function**: `persistBatch()` in `persistence.ts`
   - **Storage**:
     - Database: `netting_batches` table
     - IPFS: Batch metadata via `storeBatchToIPFS()`
   - **Result**:
     - `batchId`: Unique batch identifier
     - `finalOwners`: Map<itemId, owner>
     - `netCashDeltas`: Map<wallet, delta>
     - `numIntents`: Number of intents processed
     - `numItemsSettled`: Number of items settled
     - `numWallets`: Number of wallets affected

### Phase 4: On-Chain Settlement

1. **Settlement Transaction Construction**
   - **Function**: `settleBatchOnChain()` in `settlement.ts`
   - **Instruction**: `settle_net_batch`
   - **Accounts**:
     - GlobalConfig PDA
     - Server Authority
     - PlayerLedger accounts (for each wallet)
     - Listing accounts (for each item)
     - GameConfig accounts
     - Escrow accounts
     - Token programs

2. **Transaction Submission**
   - **Signer**: Server Authority keypair
   - **RPC**: Solana RPC endpoint (with failover)
   - **Confirmation**: Wait for confirmation
   - **Retry**: Exponential backoff on failure

3. **Batch Marking**
   - **Function**: `markBatchSettled()` in `engine.ts`
   - **Database**: Update `netting_batches.settled = true`
   - **Storage**: Update IPFS metadata

### Phase 5: Event Processing

1. **Event Listener**
   - **Handler**: `listener-handler.ts`
   - **Mode**: WebSocket (primary) or Polling (fallback)
   - **Subscription**: Program logs for `NetBatchSettled` events

2. **Event Processing**
   - **Function**: `processEvents()` in `listener-handler.ts`
   - **Updates**:
     - `listings` table (status updates)
     - `stats` table (analytics)
     - `netting_batches` table (confirmation)

3. **Indexer Updates**
   - **Service**: `indexer/service.ts`
   - **Updates**:
     - `item_ownership` table
     - `wallet_balances` table
     - `item_history` table (audit trail)

## Serverless Components

### API Handler (`api-handler.ts`)
- **Platform**: Vercel (primary) or AWS Lambda
- **Routes**: All `/api/*` endpoints
- **Features**:
  - Express app wrapped in serverless handler
  - Lazy database initialization
  - Health check endpoint
  - CORS support

### Netting Handler (`netting-handler.ts`)
- **Platform**: AWS Lambda
- **Schedule**: EventBridge (30s intervals)
- **Timeout**: 5 minutes (for large batches)
- **Memory**: 1024 MB (for large batches)

### Listener Handler (`listener-handler.ts`)
- **Platform**: AWS Lambda + API Gateway WebSocket
- **Mode**: WebSocket (real-time) or Polling (fallback)
- **Updates**: Database tables on events

### Database (`db-serverless.ts`)
- **Provider**: Supabase (serverless Postgres)
- **Features**:
  - Connection pooling (max 1 for serverless)
  - SSL support
  - Automatic reconnection

### Redis (`redis-serverless.ts`)
- **Provider**: Upstash (serverless Redis)
- **Features**:
  - REST API (no persistent connections)
  - Rate limiting
  - Caching

### IPFS Storage (`ipfs-storage.ts`)
- **Provider**: Pinata (primary) or Filecoin (NFT.Storage)
- **Features**:
  - Intent batch storage
  - Batch metadata storage
  - Multiple gateway fallbacks

### Failover System (`failover.ts`)
- **Providers**: Vercel, AWS, GCP
- **Features**:
  - Health checks
  - Automatic provider switching
  - Circuit breaker (3 failures)

### SIWS Auth (`auth-siws.ts`)
- **Framework**: Compatible with Skeet
- **Features**:
  - Message creation
  - Signature verification
  - Nonce management
  - Expiration checks

## Data Flow

### Intent Flow
```
User → API → Validation → Database → IPFS → Netting Engine → Batch → Settlement
```

### Batch Flow
```
Netting Engine → Graph Algorithm → Batch Creation → IPFS → On-Chain → Event Listener
```

### Event Flow
```
On-Chain Event → Listener → Database → Indexer → Analytics
```

## Error Handling

### API Errors
- **400**: Bad request (validation errors)
- **401**: Unauthorized (SIWS verification failed)
- **429**: Rate limited
- **500**: Server error (retry with exponential backoff)

### Netting Errors
- **Not Enough Intents**: Skip batch, wait for more
- **Settlement Failure**: Retry with exponential backoff
- **Database Error**: Log and retry

### Failover
- **Provider Failure**: Switch to next provider
- **Circuit Breaker**: Skip provider after 3 failures
- **Recovery**: Reset failure count after 5 minutes

## Monitoring

### Metrics
- **API**: Request count, latency, error rate
- **Netting**: Batch count, intents processed, settlement success rate
- **Database**: Connection count, query latency
- **IPFS**: Storage count, retrieval success rate

### Alerts
- **High Error Rate**: > 5% errors
- **Settlement Failures**: > 3 consecutive failures
- **Database Issues**: Connection failures
- **Provider Failures**: All providers unhealthy

## Testing

### Unit Tests
- Netting algorithm correctness
- SIWS signature verification
- IPFS storage/retrieval
- Failover logic

### Integration Tests
- Full intent submission flow
- Batch creation and settlement
- Event processing
- Multi-provider failover

### Load Tests
- 1000+ intents per batch
- 100+ concurrent API requests
- Database connection limits
- IPFS storage limits

## Deployment

### Vercel
```bash
vercel deploy
```

### AWS Lambda
```bash
serverless deploy
```

### Environment Variables
See `SERVERLESS_MIGRATION_GUIDE.md` for complete list.

## Cost Optimization

### Free Tiers
- Vercel: 100GB bandwidth, 100 hours
- AWS Lambda: 1M requests, 400K GB-seconds
- Supabase: 500MB database, 2GB bandwidth
- Upstash: 10K commands/day

### Optimization
- Use caching aggressively
- Batch database queries
- Compress IPFS data
- Use provisioned concurrency (AWS)

## Security

### Authentication
- SIWS signatures verified on-chain
- Session key limits enforced
- Nonce replay protection

### Authorization
- Server authority required for settlement
- Session key volume limits
- Rate limiting per IP

### Data Integrity
- IPFS content addressing
- Merkle proofs for batches
- On-chain state verification

## Next Steps

1. **Decentralization**: Integrate Akash Network
2. **Advanced IPFS**: Use Filecoin for long-term storage
3. **Multi-Region**: Deploy to multiple regions
4. **Monitoring**: Setup comprehensive monitoring

