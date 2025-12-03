import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { getProgram } from "./solana";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface SettlementAccounts {
  listing: PublicKey;
  game: PublicKey;
  sellerLedger: PublicKey;
  buyerLedger: PublicKey;
  config: PublicKey;
  currencyMint: PublicKey;
  gameVault: PublicKey;
  sellerTokenAccount: PublicKey;
  buyerTokenAccount: PublicKey;
}

/**
 * Derive all PDAs needed for auction settlement
 */
export async function deriveSettlementAccounts(
  listingId: number | string,
  gameId: number | string,
  sellerPubkey: PublicKey,
  buyerPubkey: PublicKey
): Promise<SettlementAccounts> {
  const program = getProgram();
  const listingIdBN = new BN(listingId);
  const gameIdBN = new BN(gameId);
  
  // Derive game PDA
  const [gamePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("game"),
      gameIdBN.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  
  // Derive listing PDA
  const [listingPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("listing"),
      listingIdBN.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  
  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  
  // Derive seller ledger PDA: ["ledger", game, player_signer]
  const [sellerLedgerPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("ledger"),
      gamePda.toBuffer(),
      sellerPubkey.toBuffer(),
    ],
    program.programId
  );
  
  // Derive buyer ledger PDA: ["ledger", game, player_signer]
  const [buyerLedgerPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("ledger"),
      gamePda.toBuffer(),
      buyerPubkey.toBuffer(),
    ],
    program.programId
  );
  
  // Fetch game config to get currency_mint
  const gameConfig = await program.account.gameConfig.fetch(gamePda);
  const currencyMint = gameConfig.currencyMint as PublicKey;
  
  // Derive game vault PDA
  const [gameVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("vault"),
      gamePda.toBuffer(),
    ],
    program.programId
  );
  
  // Derive associated token accounts
  const [sellerTokenAccount] = PublicKey.findProgramAddressSync(
    [
      sellerPubkey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      currencyMint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  const [buyerTokenAccount] = PublicKey.findProgramAddressSync(
    [
      buyerPubkey.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      currencyMint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  return {
    listing: listingPda,
    game: gamePda,
    sellerLedger: sellerLedgerPda,
    buyerLedger: buyerLedgerPda,
    config: configPda,
    currencyMint,
    gameVault: gameVaultPda,
    sellerTokenAccount,
    buyerTokenAccount,
  };
}

