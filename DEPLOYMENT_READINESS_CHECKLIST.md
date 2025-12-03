# 🚀 DEPLOYMENT READINESS CHECKLIST - Phantom Paradox

**Last Updated:** 2025-01-XX  
**Target:** Solana Devnet Launch

---

## ✅ PRE-DEPLOYMENT VERIFICATION

### Code Consolidation
- [x] Exodus script created (`exodus_consolidation.ps1`)
- [ ] **ACTION REQUIRED:** Run Exodus script to consolidate G: and F: code
- [ ] Verify all files copied successfully
- [ ] Review EXODUS_REPORT.txt

### Critical Logic Verification
- [x] `settle_net_batch` cash delta processing verified
- [x] `verify_merkle_proof` Keccak-256 implementation verified
- [x] `AgentRegistry` and `register_agent` verified
- [ ] Run `anchor build` to verify compilation
- [ ] Fix any compilation errors

### Environment Setup
- [ ] Create `.env` file with required variables:
  ```env
  # Solana
  SOLANA_RPC_URL=https://api.devnet.solana.com
  PHANTOMGRID_PROGRAM_ID=8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x
  
  # Database
  DATABASE_URL=postgresql://user:password@localhost:5432/phantomgrid
  
  # Redis (optional for devnet)
  REDIS_URL=redis://localhost:6379
  
  # Server Authority
  SERVER_AUTHORITY_SECRET_KEY=<base58-encoded-keypair>
  
  # Tokenomics
  MINT_AUTHORITY_SECRET_KEY=<base58-encoded-keypair>
  PDOX_MINT=<will-be-set-after-minting>
  ```

### Frontend Components
- [ ] Create `app/` directory structure
- [ ] Create `ParadoxWarRoom.tsx` component
- [ ] Create `TechCard` component
- [ ] Verify components integrate with API

---

## 🔨 BUILD & DEPLOYMENT

### Step 1: Build Program
```bash
cd "F:\Devnet production"
anchor build
```

**Expected Output:**
- ✅ Program compiled successfully
- ✅ IDL generated in `target/idl/`
- ✅ No compilation errors

**If Errors:**
- Check `Cargo.toml` dependencies
- Verify Rust toolchain version
- Review error messages

### Step 2: Deploy to Devnet
```bash
anchor deploy --provider.cluster devnet
```

**Expected Output:**
- ✅ Program deployed successfully
- ✅ Program ID matches Anchor.toml
- ✅ Transaction confirmed

**If Errors:**
- Verify wallet has SOL (devnet)
- Check RPC endpoint connectivity
- Verify program ID in Anchor.toml

### Step 3: Initialize Global Config
```bash
npx ts-node offchain/src/scripts/initGlobalConfig.ts
```

**Expected Output:**
- ✅ GlobalConfig account created
- ✅ Admin, governance, server_authority set
- ✅ Protocol fees configured

---

## 💰 TOKENOMICS SETUP

### Step 1: Mint $PDOX Token
```bash
# Set environment variable first
$env:PDOX_MINT="<will-be-set-after-minting>"
$env:MINT_AUTHORITY_SECRET_KEY="<base58-keypair>"

npx ts-node scripts/tokenomics/mint_pdox.ts
```

**Expected Output:**
- ✅ $PDOX mint created
- ✅ Transfer fee config initialized (3%)
- ✅ Mint address logged

**Action:** Update `.env` with `PDOX_MINT` value

### Step 2: Create Raydium Pool
```bash
# Requires Raydium SDK integration
npx ts-node scripts/tokenomics/create_raydium_pool.ts
```

**Status:** ⚠️ Requires Raydium SDK integration

**Alternative:** Use Raydium UI to create pool manually:
1. Go to https://raydium.io/liquidity/create/
2. Select $PDOX and SOL
3. Add 1 SOL worth of liquidity
4. Note pool address

### Step 3: Update Descaling Tax (Optional)
```bash
# After initial launch, reduce fee from 3% to 1%
npx ts-node scripts/tokenomics/update_descaling_tax.ts
```

---

## 🏃 SERVICE STARTUP

### Step 1: Install Dependencies
```bash
cd offchain
npm install
```

### Step 2: Start Database (if local)
```bash
# PostgreSQL must be running
# Verify connection with: npx ts-node src/scripts/checkDb.ts
```

### Step 3: Start Services

**Terminal 1 - API Server:**
```bash
npm run dev:api
# Should start on port 4000
```

**Terminal 2 - Event Listener:**
```bash
npm run dev:listener
# Subscribes to program logs
```

**Terminal 3 - Indexer:**
```bash
npm run indexer
# Indexes blockchain events
```

**Terminal 4 - Netting Engine:**
```bash
npm run netting
# Runs Wraith Engine
```

**Terminal 5 - Sentinel:**
```bash
npm run dev:sentinel
# Monitors for insolvency
```

### Step 4: Verify Health
```bash
curl http://localhost:4000/health
# Should return: {"status":"ok"}
```

---

## 🧪 TESTING

### Smoke Tests
```bash
npx ts-node offchain/src/scripts/smokeTestLocal.ts
```

**Expected:**
- ✅ All services healthy
- ✅ Database connection works
- ✅ RPC connection works
- ✅ Basic operations succeed

### Integration Tests
```bash
# Test netting batch settlement
npx ts-node offchain/src/scripts/settleBatchOnChain.ts

# Test agent registration
# (Create test script)
```

### Load Tests
```bash
npx ts-node offchain/src/scripts/loadTestLocal.ts
```

---

## 📊 MONITORING

### Health Checks
- [ ] API health endpoint: `GET /health`
- [ ] Database connectivity
- [ ] Redis connectivity (if using)
- [ ] Solana RPC connectivity
- [ ] Program account exists on-chain

### Metrics to Monitor
- Transaction count
- Batch settlement rate
- Error rate
- Latency
- Service uptime

### Alerts to Set Up
- Service downtime
- High error rate (>5%)
- Insolvency detection
- Unusual activity patterns

---

## 🐛 TROUBLESHOOTING

### Build Errors
**Issue:** Compilation fails  
**Solution:**
- Check Rust version: `rustc --version` (should be 1.75+)
- Update dependencies: `cargo update`
- Clean build: `cargo clean && anchor build`

### Deployment Errors
**Issue:** Deployment fails  
**Solution:**
- Verify wallet has SOL: `solana balance`
- Check RPC endpoint: `solana cluster-version`
- Verify program ID in Anchor.toml matches wallet

### Service Startup Errors
**Issue:** Services won't start  
**Solution:**
- Check environment variables are set
- Verify database is running
- Check port 4000 is not in use
- Review error logs

### Database Errors
**Issue:** Database connection fails  
**Solution:**
- Verify DATABASE_URL is correct
- Check PostgreSQL is running
- Verify user has permissions
- Run migrations if needed

---

## ✅ FINAL VERIFICATION

Before declaring "READY FOR DEVNET":
- [ ] All services running
- [ ] Health checks passing
- [ ] Program deployed and verified
- [ ] Global config initialized
- [ ] $PDOX token minted
- [ ] Smoke tests passing
- [ ] Frontend components created (if applicable)
- [ ] Documentation reviewed

---

## 📞 SUPPORT

**Issues:**
- Review `DEVNET_READINESS_REPORT.txt`
- Check `STUBS_AND_PLACEHOLDERS.txt`
- Review `COMPREHENSIVE_TECHNICAL_ANALYSIS.md`

**Next Steps:**
1. Run Exodus consolidation
2. Build and deploy
3. Start services
4. Run tests
5. Monitor and iterate

---

**Status:** 🟡 READY AFTER CONSOLIDATION

