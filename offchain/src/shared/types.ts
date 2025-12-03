export type ListingStatus = "Active" | "Cancelled" | "Settled" | "Expired";

export interface ListingRow {
  id: string;
  pda: string;
  game_id: string;
  seller: string;
  price: string;
  status: ListingStatus;
  quantity_remaining: number;
  created_at: Date;
  end_time: Date | null;
}

export interface BidRow {
  id: string;
  listing_id: string;
  bidder: string;
  amount: string;
  created_at: Date;
}

export interface GameRow {
  id: string;
  game_pda: string;
  name: string;
  metadata: any;
}

export interface UserRow {
  pubkey: string;
  kyc_status: string;
}

export type EventName =
  | "ListingCreated"
  | "ListingCancelled"
  | "FixedSaleExecuted"
  | "AuctionSettled"
  | "PartialFill"
  | "KycUpdated"
  | "GameCreated"
  | "GameUpdated";

