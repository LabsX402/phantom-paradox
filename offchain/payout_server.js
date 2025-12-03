/**
 * 🪞 BLACKMIRROR PAYOUT SERVER
 * 
 * Run locally - listens for payout requests from frontend
 * After user deposits to VAULT, frontend calls this to trigger BlackMirror → B
 * 
 * Usage: node payout_server.js
 * Then frontend calls: http://localhost:3333/payout
 */

const http = require('http');
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const DEVNET_RPC = 'https://api.devnet.solana.com';
const MIN_BALANCE = 0.1 * LAMPORTS_PER_SOL;

// Load wallets once at startup
let blackMirror, authority;

function loadWallets() {
  const hydraPath = path.join(__dirname, '..', 'scripts', 'tokenomics', 'hydra_test_wallets.json');
  const hydraWallets = JSON.parse(fs.readFileSync(hydraPath, 'utf-8'));
  blackMirror = Keypair.fromSecretKey(Uint8Array.from(hydraWallets.blackMirror.secret));
  
  const authorityPath = path.join(__dirname, '..', 'deployer_wallet.json');
  const authoritySecret = JSON.parse(fs.readFileSync(authorityPath, 'utf-8'));
  authority = Keypair.fromSecretKey(Uint8Array.from(authoritySecret));
  
  console.log(`🪞 BlackMirror: ${blackMirror.publicKey.toBase58()}`);
  console.log(`🔑 Authority: ${authority.publicKey.toBase58()}`);
}

async function refillIfNeeded(connection, amountNeeded) {
  const balance = await connection.getBalance(blackMirror.publicKey);
  
  if (balance < amountNeeded + MIN_BALANCE) {
    console.log(`⚠️  Low balance (${balance / LAMPORTS_PER_SOL} SOL), refilling...`);
    
    const refillAmount = Math.max(0.5 * LAMPORTS_PER_SOL, amountNeeded * 3);
    
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: blackMirror.publicKey,
        lamports: refillAmount
      })
    );
    
    await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`✅ Refilled ${refillAmount / LAMPORTS_PER_SOL} SOL`);
  }
}

async function doPayout(toAddress, amountLamports) {
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  
  console.log(`\n📤 Payout request: ${amountLamports / LAMPORTS_PER_SOL} SOL → ${toAddress.slice(0, 12)}...`);
  
  // Auto-refill if needed
  await refillIfNeeded(connection, amountLamports);
  
  // Send payout
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: blackMirror.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: amountLamports
    })
  );
  
  const sig = await sendAndConfirmTransaction(connection, tx, [blackMirror]);
  console.log(`✅ Payout done: ${sig.slice(0, 24)}...`);
  
  return sig;
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.method === 'POST' && req.url === '/payout') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { to, amountLamports } = JSON.parse(body);
        
        if (!to || !amountLamports) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing to or amountLamports' }));
          return;
        }
        
        const sig = await doPayout(to, amountLamports);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          signature: sig,
          explorer: `https://solscan.io/tx/${sig}?cluster=devnet`
        }));
      } catch (error) {
        console.error('❌ Error:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      endpoint: 'POST /payout',
      body: '{ "to": "WalletB", "amountLamports": 10000000 }'
    }));
  }
});

loadWallets();

server.listen(PORT, () => {
  console.log(`\n🪞 BLACKMIRROR PAYOUT SERVER`);
  console.log(`═`.repeat(50));
  console.log(`🌐 Running on http://localhost:${PORT}`);
  console.log(`📤 POST /payout { to, amountLamports }`);
  console.log(`\nWaiting for payout requests...`);
});

