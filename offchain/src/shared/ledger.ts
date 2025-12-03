import { PublicKey } from "@solana/web3.js";
import { getProgram } from "./solana";
import { BN } from "@coral-xyz/anchor";
import { query } from "./db";

export interface PlayerLedgerData {
  available: bigint;
  locked: bigint;
  kyc_verified: boolean;
}

/**
 * Get PlayerLedger balance from on-chain or database
 * PDA seeds: ["ledger", game, player_signer]
 */
export async function getPlayerLedger(
  playerPubkey: PublicKey,
  gameId: number | string
): Promise<PlayerLedgerData | null> {
  try {
    // Try on-chain first
    const program = getProgram();
    const gameIdBN = new BN(gameId);
    
    // Derive game PDA
    const [gamePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("game"),
        gameIdBN.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    
    // Derive ledger PDA: ["ledger", game, player_signer]
    const [ledgerPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("ledger"),
        gamePda.toBuffer(),
        playerPubkey.toBuffer(),
      ],
      program.programId
    );
    
    try {
      const ledger = await program.account.playerLedger.fetch(ledgerPda);
      return {
        available: BigInt(ledger.available.toString()),
        locked: BigInt(ledger.locked.toString()),
        kyc_verified: ledger.kycVerified,
      };
    } catch {
      // Account doesn't exist on-chain, try database
      const { rows } = await query(
        `SELECT available, locked, kyc_verified 
         FROM player_ledgers 
         WHERE player_pubkey = $1 AND game_id = $2`,
        [playerPubkey.toString(), gameId]
      );
      
      if (rows.length > 0) {
        return {
          available: BigInt(rows[0].available || "0"),
          locked: BigInt(rows[0].locked || "0"),
          kyc_verified: rows[0].kyc_verified || false,
        };
      }
      
      return null;
    }
  } catch (error) {
    console.error("Error fetching PlayerLedger", error);
    return null;
  }
}

