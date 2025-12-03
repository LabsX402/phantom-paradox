/**
 * Check for deployed Games and Vaults on devnet
 */
import { Connection, PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('8jrMsGNM9HwmPU94cotLQCxGu15iW7Mt3WZeggfwvv2x');
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');

async function main() {
  console.log('\n🔍 Searching for deployed Games/Vaults on Devnet...\n');
  console.log('Program ID:', PROGRAM_ID.toBase58());
  console.log('');
  
  let foundGames = 0;
  
  // Check for GameConfig accounts (seed: 'game' + game_id)
  for (let gameId = 1; gameId <= 20; gameId++) {
    const gameIdBytes = Buffer.alloc(8);
    gameIdBytes.writeBigUInt64LE(BigInt(gameId));
    
    const [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('game'), gameIdBytes],
      PROGRAM_ID
    );
    
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), gamePda.toBuffer()],
      PROGRAM_ID
    );
    
    try {
      const gameInfo = await conn.getAccountInfo(gamePda);
      
      if (gameInfo && gameInfo.owner.equals(PROGRAM_ID)) {
        foundGames++;
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ FOUND GAME #' + gameId);
        console.log('   Game PDA:  ', gamePda.toBase58());
        console.log('   Vault PDA: ', vaultPda.toBase58());
        console.log('   Game Size: ', gameInfo.data.length, 'bytes');
        
        const vaultInfo = await conn.getAccountInfo(vaultPda);
        if (vaultInfo) {
          console.log('   Vault exists: YES ✅');
          console.log('   Vault Owner: ', vaultInfo.owner.toBase58());
          
          // If it's a token account, try to get balance
          if (vaultInfo.data.length >= 72) {
            const amount = vaultInfo.data.readBigUInt64LE(64);
            console.log('   Vault Balance:', Number(amount) / 1e9, 'tokens');
          }
        } else {
          console.log('   Vault exists: NO (needs creation)');
        }
        console.log('');
      }
    } catch (e) {
      // Skip
    }
  }
  
  if (foundGames === 0) {
    console.log('❌ No Games found on devnet (checked IDs 1-20)');
    console.log('');
    console.log('📋 TO CREATE A GAME:');
    console.log('   1. Call createGame instruction');
    console.log('   2. This will create GameConfig + Vault PDAs');
    console.log('   3. Then we can do real anonymous transfers!');
  } else {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY: Found', foundGames, 'game(s)');
  }
  
  // Also show GlobalConfig
  console.log('');
  console.log('📋 GlobalConfig PDA: HHefAxKZQqaLj3V2Hd9XfTBRPe8av4JTmvE4DWiygER8');
}

main().catch(e => console.error('Error:', e.message));

