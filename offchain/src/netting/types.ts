/**
 * ======================================================================
 * TEMPORAL NETTING ENGINE - Type Definitions
 * ======================================================================
 * 
 * Core types for the God Mode Temporal Netting Engine with Session Keys.
 * 
 * Architecture:
 * - Players sign "intents" using session keys (off-chain)
 * - Engine collects intents and nets intermediate trades
 * - Only final state changes committed to Solana
 */

/**
 * Allowed actions for a session key
 */
export type AllowedAction = "TRADE" | "BID" | "BUY_NOW";

/**
 * Session key policy - defines what a session key can do
 */
export interface SessionKeyPolicy {
  /** Owner's public key (the player who owns this session key) */
  ownerPubkey: string;
  
  /** Session key's public key (the key used to sign intents) */
  sessionPubkey: string;
  
  /** Maximum volume in lamports this session key can spend */
  maxVolumeLamports: bigint;
  
  /** Unix timestamp when this session key expires */
  expiresAt: number;
  
  /** List of actions this session key is allowed to perform */
  allowedActions: AllowedAction[];
  
  /** Optional: Nonce for replay protection */
  nonce?: number;
  
  /** Optional: Created timestamp */
  createdAt?: number;
}

/**
 * Trade intent - represents a player's intent to trade an item
 */
export interface TradeIntent {
  /** Unique identifier for this intent */
  id: string;
  
  /** Session key public key that signed this intent */
  sessionPubkey: string;
  
  /** Owner's public key (the player) */
  ownerPubkey: string;
  
  /** Item identifier (can be off-chain item ID, listing ID, or mint address) */
  itemId: string;
  
  /** Source wallet (seller) */
  from: string;
  
  /** Destination wallet (buyer) */
  to: string;
  
  /** Amount in lamports (price) */
  amountLamports: bigint;
  
  /** Nonce for replay protection (incremented per intent) */
  nonce: number;
  
  /** Signature of the intent payload by sessionPubkey */
  signature: string;
  
  /** Unix timestamp when intent was created */
  createdAt: number;
  
  /** Optional: Game ID this intent belongs to */
  gameId?: string;
  
  /** Optional: Listing ID if this is a bid/buy */
  listingId?: string;
  
  /** Optional: Intent type */
  intentType?: AllowedAction;
  
  /** Optional: Agent ID (Pubkey of the Agent used for this trade) */
  agentId?: string;
}

/**
 * Netting result - the output of running netting on a batch of intents
 */
export interface NettingResult {
  /** Final owner for each item ID after netting */
  finalOwners: Map<string, string>; // itemId -> ownerPubkey
  
  /** Net cash deltas per wallet (positive = received, negative = paid) */
  netCashDeltas: Map<string, bigint>; // ownerPubkey -> deltaLamports
  
  /** List of intent IDs that were consumed in this batch */
  consumedIntentIds: string[];
  
  /** Batch identifier */
  batchId: string;
  
  /** Timestamp when netting was run */
  nettedAt: number;
  
  /** Number of intents processed */
  numIntents: number;
  
  /** Number of unique items settled */
  numItemsSettled: number;
  
  /** Number of unique wallets involved */
  numWallets: number;
  
  /** Optional: List of intent IDs that were skipped (e.g., invalid chain sequences) */
  skippedIntentIds?: string[];
  
  /** Optional: Pi-Standard "Alive Fee" (dynamic fee based on chaos metrics) */
  piFeeLamports?: bigint;
  
  /** Optional: Royalty distribution for Phantom Nexus agents (agentId -> royaltyLamports) */
  royaltyDistribution?: Map<string, bigint>;
}

/**
 * Settled item - represents final ownership after netting
 */
export interface SettledItem {
  /** Item identifier */
  itemId: string;
  
  /** Final owner's public key */
  finalOwner: string;
  
  /** Optional: Original seller */
  originalSeller?: string;
  
  /** Optional: Final price paid */
  finalPrice?: bigint;
}

/**
 * Net delta - represents cash flow for a wallet
 */
export interface NetDelta {
  /** Wallet public key */
  ownerPubkey: string;
  
  /** Net delta in lamports (positive = received, negative = paid) */
  deltaLamports: bigint;
}

/**
 * Netting batch - represents a batch of intents that were netted together
 */
export interface NettingBatch {
  /** Timestamp when batch was settled on-chain */
  settledAt?: number;
  /** Unique batch identifier */
  batchId: string;
  
  /** Timestamp when batch was created */
  createdAt: number;
  
  /** Timestamp when batch was netted */
  nettedAt?: number;
  
  /** Whether this batch has been settled on-chain */
  settled: boolean;
  
  /** On-chain transaction signature (if settled) */
  txSignature?: string;
  
  /** Batch hash for auditability (doesn't reveal netting logic) */
  batchHash?: Buffer;
  
  /** Netting result */
  result?: NettingResult;
  
  /** List of intent IDs in this batch */
  intentIds: string[];
}

/**
 * Intent validation result
 */
export interface IntentValidationResult {
  valid: boolean;
  reason?: string;
  policy?: SessionKeyPolicy;
}

/**
 * Graph node - represents a wallet in the netting graph
 */
export interface GraphNode {
  pubkey: string;
  incoming: Map<string, bigint>; // itemId -> amount
  outgoing: Map<string, bigint>; // itemId -> amount
}

/**
 * Graph edge - represents a trade in the netting graph
 */
export interface GraphEdge {
  from: string;
  to: string;
  itemId: string;
  amount: bigint;
  intentId: string;
}

