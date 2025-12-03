/**
 * PDOX/SOL POOL CREATION GUIDE
 * 
 * SDKs have BN/Token-2022 compatibility issues.
 * Here's the complete guide for manual creation.
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.devnet.solana.com';
const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');

function loadWallet(): Keypair {
  const walletPath = path.join(__dirname, '..', '..', '..', 'deployer_wallet.json');
  const data = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = loadWallet();

  const solBalance = await connection.getBalance(wallet.publicKey);
  const pdoxAta = await getAssociatedTokenAddress(PDOX_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  
  let pdoxBalance = 0;
  try {
    const acc = await getAccount(connection, pdoxAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    pdoxBalance = Number(acc.amount) / 1e9;
  } catch {}

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    PDOX/SOL POOL CREATION GUIDE                              ║
║                    5 SOL + 10M PDOX (1% of supply)                           ║
╚══════════════════════════════════════════════════════════════════════════════╝

📊 CURRENT STATUS:
   Wallet: ${wallet.publicKey.toBase58()}
   SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL
   PDOX Balance: ${pdoxBalance.toLocaleString()} PDOX
   PDOX Mint: ${PDOX_MINT.toBase58()}

═══════════════════════════════════════════════════════════════════════════════
                          OPTION 1: METEORA DLMM (DEVNET)
═══════════════════════════════════════════════════════════════════════════════

Meteora now supports Token-2022! Create pool via their UI:

STEP 1: Open Meteora Devnet
   URL: https://devnet.meteora.ag/dlmm/create

STEP 2: Connect Your Wallet
   - Click "Connect Wallet"
   - Select Phantom
   - Make sure Phantom is set to DEVNET
   - Wallet address: ${wallet.publicKey.toBase58()}

STEP 3: Configure Pool
   
   BASE TOKEN (The token being priced):
   ┌────────────────────────────────────────────────────────┐
   │ Click "Select token"                                   │
   │ Paste: ${PDOX_MINT.toBase58()}      │
   └────────────────────────────────────────────────────────┘
   
   QUOTE TOKEN: SOL (already selected)
   
   BASE FEE: Select 1% (100 bps)
   
   BIN STEP: Select 25 (0.25% per bin)
   
   INITIAL PRICE: 
   ┌────────────────────────────────────────────────────────┐
   │ Enter: 0.0000005                                       │
   │ This gives: $68K market cap at $136/SOL               │
   │                                                        │
   │ Alternative: 0.0000001 for $13.6K market cap          │
   └────────────────────────────────────────────────────────┘

STEP 4: Create Pool
   - Click "Create Pool"
   - Approve transaction in Phantom
   - Wait for confirmation

STEP 5: Add Liquidity
   - Go to the pool page
   - Click "Add Liquidity"
   - Enter: 5 SOL and 10,000,000 PDOX
   - Approve transactions

STEP 6: Save Pool Address
   - Copy the pool address from the URL or page
   - Add to .env: METEORA_PDOX_POOL=<address>

═══════════════════════════════════════════════════════════════════════════════
                          OPTION 2: ORCA WHIRLPOOLS
═══════════════════════════════════════════════════════════════════════════════

Orca has good Token-2022 support:

URL: https://www.orca.so/liquidity (switch to devnet in wallet)

1. Create Whirlpool with PDOX/SOL
2. Set tick spacing (similar to bin step)
3. Add initial liquidity

═══════════════════════════════════════════════════════════════════════════════
                          OPTION 3: RAYDIUM
═══════════════════════════════════════════════════════════════════════════════

Raydium UI might work but Token-2022 support varies:

URL: https://raydium.io/liquidity/create-pool/

Note: May require mainnet. Check devnet support.

═══════════════════════════════════════════════════════════════════════════════
                          AFTER POOL CREATION
═══════════════════════════════════════════════════════════════════════════════

Once you have a pool address, run:

  npm run test:pool -- <pool_address>

This will:
  1. Verify the pool exists
  2. Check liquidity levels
  3. Test a small swap
  4. Confirm all transactions have real TX hashes

═══════════════════════════════════════════════════════════════════════════════
                          EXPECTED RESULTS
═══════════════════════════════════════════════════════════════════════════════

With 5 SOL + 10M PDOX:

┌─────────────────────────────────────────────────────────────────┐
│ LP Value:      ~$1,360 ($680 each side)                        │
│ Market Cap:    ~$68,000 (at $136/SOL)                          │
│ Price/PDOX:    $0.000068                                       │
│                                                                 │
│ $10 buy:       ~3% slippage ✅                                  │
│ $50 buy:       ~15% slippage 🟡                                 │
│ $100 buy:      ~32% slippage 😐                                 │
│                                                                 │
│ As volume comes in, 3% tax × 70% = 2.1% to LP                  │
│ LP grows automatically!                                         │
└─────────────────────────────────────────────────────────────────┘

Ready to create? Open https://devnet.meteora.ag/dlmm/create now!
`);
}

main().catch(console.error);

