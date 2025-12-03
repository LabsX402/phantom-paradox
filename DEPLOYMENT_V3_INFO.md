# PHANTOM PARADOX V3 - DEVNET DEPLOYMENT

**Date:** 2025-11-30
**Status:** ✅ LIVE ON DEVNET

---

## 🔑 CRITICAL ADDRESSES (DO NOT LOSE)

### Program
```
Program ID:      7j4qvD77zadbvrKYmahMQbFS5f8tEseW9kj62LYuWmer
IDL Account:     65SqUUSwKaKfrc2jjr7Jrrb63CHbR4x61ojgtYcH5FeE
Program Data:    9bs4d7aaZ9SA1io85bXG2SvJdXcTSpsaZZAie7LfUXYP
Authority:       3XBBYhqcV5fdF1j8Bs97wcAbj9AYEeVHcxZipaFcefr3
```

### Token (PDOX V2 - CORRECT TOKENOMICS)
```
Mint Address:    5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B
Token Program:   TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb (Token-2022)
Decimals:        9
Transfer Fee:    3% (300 bps)
Initial Supply:  10,000,000 PDOX ✅
Mint Authority:  3XBBYhqcV5fdF1j8Bs97wcAbj9AYEeVHcxZipaFcefr3 (KEPT!)
```

### Deployer Wallet
```
Address:         3XBBYhqcV5fdF1j8Bs97wcAbj9AYEeVHcxZipaFcefr3
Wallet File:     deployer_wallet.json
```

---

## 🔗 Explorer Links

- **Program:** https://solscan.io/account/7j4qvD77zadbvrKYmahMQbFS5f8tEseW9kj62LYuWmer?cluster=devnet
- **IDL:** https://solscan.io/account/65SqUUSwKaKfrc2jjr7Jrrb63CHbR4x61ojgtYcH5FeE?cluster=devnet
- **Token:** https://solscan.io/token/5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B?cluster=devnet

---

## 📊 Tokenomics (CORRECT THIS TIME!)

| Aspect | Value | Notes |
|--------|-------|-------|
| **Total Supply** | 1B (hard cap) | NOT pre-minted! |
| **Initial Mint** | 10M PDOX | For LP only |
| **Mint Authority** | Deployer | Can mint more as LP grows |
| **Transfer Fee** | 3% | Auto-collected on transfers |
| **Max Fee** | 1T tokens | Effectively uncapped |

### Mint-As-You-Go Model
```
1. Genesis: Only 10M PDOX exist
2. Fees collected → SOL accumulates
3. Protocol mints matching PDOX
4. LP grows organically
5. Scarcity maintained!
```

---

## 🛠️ Verification Commands

```bash
# Check program
solana program show 7j4qvD77zadbvrKYmahMQbFS5f8tEseW9kj62LYuWmer --url devnet

# Fetch IDL
anchor idl fetch 7j4qvD77zadbvrKYmahMQbFS5f8tEseW9kj62LYuWmer --provider.cluster devnet

# Check token balance
spl-token balance 5673DfyfMiP2vZTAwEr7t6pwZkQk1TTyLP7R8Lw8G41B --owner deployer_wallet.json --url devnet

# Check SOL balance
solana balance deployer_wallet.json --url devnet
```

---

## 📁 Important Files

| File | Purpose |
|------|---------|
| `deployer_wallet.json` | Main deployer keypair |
| `target/deploy/phantom_paradox-keypair.json` | Program keypair |
| `target/idl/phantom_paradox.json` | Program IDL |
| `scripts/tokenomics/PDOX_V2_MINT_INFO.json` | Token mint details |

---

## ⚠️ Previous Deployments (CLOSED/DEPRECATED)

| Version | Program ID | Status |
|---------|------------|--------|
| V1 | `8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x` | CLOSED |
| V2 | `oMBTXLR4ZdxKHi17vEMrh8Kdt9gDYdPPqA7NBkaY9vq` | CLOSED |
| V2.0.2 | `2R6Lus9psfB2dREDuC79ayfwd4peVfqG3Q42ca2iFhNV` | CLOSED |
| **V3** | **`7j4qvD77zadbvrKYmahMQbFS5f8tEseW9kj62LYuWmer`** | **✅ LIVE** |

### Old Token (BROKEN - DO NOT USE)
```
Old PDOX:        4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF
Problem:         Pre-minted 1B tokens (wrong!)
Status:          DEPRECATED
```

---

## 🚀 Next Steps

1. **Create Raydium CLMM Pool**
   - Pair: SOL/PDOX V2
   - Initial: ~5 SOL + 10M PDOX
   
2. **Update Public Repos**
   - PHANTOMGRID-Paradox
   - token-2022-paradox
   
3. **Update sim.html**
   - Point to new token mint
   - Point to new pool

---

## 💰 Cost Summary

| Action | SOL Cost |
|--------|----------|
| Token creation | ~0.005 SOL |
| Program deploy | ~8.6 SOL (recoverable) |
| IDL upload | ~0.3 SOL |
| **Total locked** | ~8.9 SOL |
| **Available** | ~4.8 SOL |

---

## 🔐 Recovery Info

If you need to recover SOL:
```bash
# Close program (recovers ~8.6 SOL)
solana program close 7j4qvD77zadbvrKYmahMQbFS5f8tEseW9kj62LYuWmer --bypass-warning -k deployer_wallet.json --url devnet

# Check for buffers
solana program show --buffers -k deployer_wallet.json --url devnet
```

---

*Last updated: 2025-11-30*
*Network: Solana Devnet*

