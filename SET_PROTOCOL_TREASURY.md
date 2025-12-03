# Set Protocol Treasury Wallet

**Purpose:** Configure where protocol fees (dev fees) go

**Fee Wallet Address:** `88fuKBXZhZFUMwydHrVM1syqKNBV8gFCkh2mtBfyrD2s`

---

## What This Does

Sets the `protocol_treasury` address in the GlobalConfig on-chain account. All protocol fees will be sent to this address:

- **Protocol fees** from trades (1% by default, configurable)
- **Dev fees** from protocol operations
- **π-fees** from netting savings (10% of saved transaction fees)

---

## How to Run

### Option 1: Using npm script
```bash
cd offchain
npm run set:treasury
```

### Option 2: Direct execution
```bash
cd offchain
npx ts-node src/scripts/setProtocolTreasury.ts
```

---

## Requirements

1. **GlobalConfig must be initialized** (run `initGlobalConfig.ts` first if needed)
2. **You must be admin or governance wallet** (uses `deployer_wallet.json` by default)
3. **Wallet must have SOL** for transaction fees

---

## What Happens

1. Script checks if GlobalConfig exists
2. Verifies you're authorized (admin or governance)
3. Checks current treasury address
4. Updates to: `88fuKBXZhZFUMwydHrVM1syqKNBV8gFCkh2mtBfyrD2s`
5. Shows transaction signature

---

## Verification

After running, you can verify the treasury address:

```bash
# Using Solana CLI
solana account <CONFIG_PDA> --url https://api.devnet.solana.com

# Or check in the script output - it will show the new treasury address
```

---

## Environment Variables

- `SOLANA_RPC_URL` or `RPC_URL` - RPC endpoint (defaults to devnet)
- `PHANTOMGRID_PROGRAM_ID` - Program ID (defaults to devnet program ID)
- `SERVER_AUTHORITY_SECRET_KEY` - Wallet path (defaults to `deployer_wallet.json`)

---

## Notes

- This is a one-time setup (unless you want to change it later)
- Only admin or governance can update the treasury
- The treasury address is stored on-chain in GlobalConfig
- All future protocol fees will go to this address

---

**Status:** ✅ Ready to use

