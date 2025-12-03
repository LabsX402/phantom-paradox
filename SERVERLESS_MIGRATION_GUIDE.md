# Serverless Migration Guide

## Overview

This guide covers the migration from traditional server-based infrastructure to serverless architecture for the Phantom Paradox Vault system.

## Architecture Changes

### Before (Traditional)
- Express.js server running 24/7
- PostgreSQL database with persistent connections
- Redis for caching/rate limiting
- Scheduled cron jobs for netting
- WebSocket connections for event listening

### After (Serverless)
- Vercel/AWS Lambda functions for API
- Supabase (serverless Postgres) or DynamoDB
- Upstash Redis (serverless) or ElastiCache Serverless
- EventBridge/Cron for scheduled netting
- WebSocket API Gateway for event listening

## Components

### 1. API Server (`api-handler.ts`)
- **Vercel**: Automatically deployed via `vercel.json`
- **AWS Lambda**: Deployed via `serverless.yml`
- **Features**: Express app wrapped in serverless handler

### 2. Netting Engine (`netting-handler.ts`)
- **Schedule**: Every 30 seconds (configurable)
- **Trigger**: AWS EventBridge or Cron
- **Timeout**: 5 minutes (for large batches)

### 3. Event Listener (`listener-handler.ts`)
- **WebSocket**: AWS API Gateway WebSocket
- **Polling**: Fallback mode (1 minute intervals)

### 4. Database (`db-serverless.ts`)
- **Supabase**: Serverless Postgres (recommended)
- **DynamoDB**: Alternative for NoSQL needs

### 5. Redis (`redis-serverless.ts`)
- **Upstash**: Serverless Redis (recommended)
- **ElastiCache**: AWS serverless Redis
- **Memory**: In-memory fallback for dev

### 6. IPFS Storage (`ipfs-storage.ts`)
- **Pinata**: Primary provider
- **Filecoin**: Alternative via NFT.Storage
- **Gateways**: Multiple fallback gateways

### 7. Failover System (`failover.ts`)
- **Multi-Provider**: Vercel, AWS, GCP
- **Health Checks**: Automatic provider switching
- **Circuit Breaker**: Prevents cascading failures

### 8. SIWS Auth (`auth-siws.ts`)
- **Solana Sign-In**: Compatible with Skeet framework
- **JWT**: Token-based authentication
- **Nonce**: Replay protection

## Deployment

### Vercel Deployment

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel deploy
```

3. Set environment variables in Vercel dashboard:
- `DATABASE_URL` (Supabase)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `PROGRAM_ID`
- `SOLANA_RPC_URL`

### AWS Lambda Deployment

1. Install Serverless Framework:
```bash
npm install -g serverless
```

2. Configure AWS credentials:
```bash
aws configure
```

3. Deploy:
```bash
cd offchain
npm run serverless:deploy
```

4. Set environment variables:
```bash
serverless env set DATABASE_URL <supabase-url>
serverless env set UPSTASH_REDIS_REST_URL <upstash-url>
# ... etc
```

## Environment Variables

### Required
```env
# Database
DATABASE_URL=postgresql://... (Supabase)
# OR
DB_TYPE=dynamodb
AWS_REGION=us-east-1

# Redis
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
# OR
REDIS_TYPE=elasticache
AWS_REGION=us-east-1

# Solana
PROGRAM_ID=8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x
SOLANA_RPC_URL=https://api.devnet.solana.com

# IPFS (optional)
IPFS_PROVIDER=pinata
PINATA_API_KEY=...
PINATA_SECRET_KEY=...

# Netting
MIN_INTENTS_PER_BATCH=1000
MAX_INTENTS_PER_BATCH=100000
BATCH_WINDOW_SECONDS=300
ENABLE_ONCHAIN_SETTLEMENT=true

# Failover (optional)
VERCEL_ENABLED=true
AWS_ENABLED=true
GCP_ENABLED=false
```

## Cost Estimation

### Vercel
- **Free Tier**: 100GB bandwidth, 100 hours function execution
- **Pro**: $20/month - Unlimited bandwidth, 1000 hours
- **Estimated**: $0-20/month for moderate traffic

### AWS Lambda
- **Free Tier**: 1M requests, 400K GB-seconds
- **Pricing**: $0.0000017 per invocation + $0.0000166667 per GB-second
- **Estimated**: $10-50/month for 1M requests

### Supabase
- **Free Tier**: 500MB database, 2GB bandwidth
- **Pro**: $25/month - 8GB database, 50GB bandwidth
- **Estimated**: $0-25/month

### Upstash Redis
- **Free Tier**: 10K commands/day
- **Pay-as-you-go**: $0.20 per 100K commands
- **Estimated**: $5-20/month

### Total Estimated Cost
- **Development**: $0-10/month (free tiers)
- **Production (moderate)**: $40-115/month
- **Production (high scale)**: $200-500/month

## Performance

### Cold Starts
- **Vercel**: ~100-200ms (Node.js)
- **AWS Lambda**: ~500ms-2s (first request)
- **Mitigation**: Keep-alive pings, provisioned concurrency

### Latency
- **API**: 50-200ms (serverless) vs 10-50ms (traditional)
- **Netting**: 1-5ms (same, runs in function)
- **Database**: 10-50ms (Supabase) vs 5-20ms (local)

### Throughput
- **API**: Auto-scales to 1000+ req/sec
- **Netting**: 1000+ intents/sec (same algorithm)
- **Database**: Supabase handles 1000+ connections

## Migration Steps

1. **Setup Serverless Infrastructure**
   - Create Supabase project
   - Create Upstash Redis database
   - Setup Pinata account (for IPFS)

2. **Update Environment Variables**
   - Copy `.env.example` to `.env`
   - Fill in serverless credentials

3. **Deploy API**
   ```bash
   vercel deploy
   # OR
   serverless deploy
   ```

4. **Deploy Netting Function**
   ```bash
   serverless deploy function -f netting
   ```

5. **Deploy Listener**
   ```bash
   serverless deploy function -f listener
   ```

6. **Test**
   ```bash
   npm run smoketest:local
   ```

7. **Monitor**
   - Vercel dashboard
   - AWS CloudWatch
   - Supabase dashboard

## Troubleshooting

### Cold Start Issues
- Use provisioned concurrency (AWS)
- Implement keep-alive pings
- Use Vercel Edge Functions for simple routes

### Database Connection Limits
- Supabase: 200 connections (free), 500 (pro)
- Use connection pooling
- Implement connection reuse

### Timeout Issues
- Increase Lambda timeout (max 15 minutes)
- Break large batches into smaller chunks
- Use async processing

### Cost Optimization
- Use free tiers where possible
- Implement caching aggressively
- Use DynamoDB for high-throughput scenarios
- Monitor and optimize function memory

## Next Steps

1. **Decentralization**: Integrate Akash Network for p2p compute
2. **Advanced IPFS**: Use Filecoin for long-term storage
3. **Multi-Region**: Deploy to multiple regions for redundancy
4. **Monitoring**: Setup comprehensive monitoring (Datadog, New Relic)

