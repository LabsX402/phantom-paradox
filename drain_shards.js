// Quick script to drain all shard wallets to deployer
const fs = require('fs');
const { execSync } = require('child_process');

const wallets = JSON.parse(fs.readFileSync('test_wallets.json', 'utf8'));
const DEPLOYER = '3XBBYhqcV5fdF1j8Bs97wcAbj9AYEeVHcxZipaFcefr3';

console.log('🔥 DRAINING ALL SHARD WALLETS TO DEPLOYER\n');

for (const wallet of wallets) {
    const keyfile = `temp_wallet_${wallet.index}.json`;
    
    // Write keypair to temp file
    fs.writeFileSync(keyfile, JSON.stringify(wallet.secretKey));
    
    console.log(`Wallet ${wallet.index}: ${wallet.publicKey}`);
    
    try {
        // Check balance
        const balance = execSync(`solana balance ${wallet.publicKey} --url devnet`, { encoding: 'utf8' }).trim();
        console.log(`  Balance: ${balance}`);
        
        // Transfer all (minus fee)
        const solAmount = parseFloat(balance.split(' ')[0]);
        if (solAmount > 0.001) {
            const transferAmount = (solAmount - 0.000005).toFixed(9); // Leave tiny bit for fee
            console.log(`  Transferring ${transferAmount} SOL...`);
            
            const result = execSync(
                `solana transfer ${DEPLOYER} ${transferAmount} --from ${keyfile} --url devnet --allow-unfunded-recipient --fee-payer ${keyfile}`,
                { encoding: 'utf8' }
            );
            console.log(`  ✅ Done!`);
        } else {
            console.log(`  ⏭️ Skipping (too low)`);
        }
    } catch (e) {
        console.log(`  ❌ Error: ${e.message}`);
    }
    
    // Clean up temp file
    try { fs.unlinkSync(keyfile); } catch(e) {}
    console.log('');
}

console.log('✅ DRAIN COMPLETE!');

