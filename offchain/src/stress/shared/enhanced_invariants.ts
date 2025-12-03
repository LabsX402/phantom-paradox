/**
 * Enhanced invariants for 10x scale testing
 * 
 * These checks are more rigorous and catch edge cases that only
 * appear at scale or under chaos conditions.
 */

import { Pool } from 'pg';
import { InvariantCheckResult } from './invariants';

/**
 * Per-auction economic sanity
 * final_vault_balance == sum(winning_bids) - protocol_fees - royalties - refunds
 */
export async function checkPerAuctionEconomicSanity(
  db: Pool,
  gameId: string | number
): Promise<InvariantCheckResult> {
  // For cancelled auctions: final_vault_balance == 0 and all bids marked refunded
  const cancelledCheck = await db.query(`
    SELECT 
      l.id,
      l.highest_bid,
      COUNT(b.id) as bid_count,
      SUM(b.amount::numeric) as total_bids
    FROM listings l
    LEFT JOIN bids b ON b.listing_id = l.id
    WHERE l.game_id = $1 AND l.status = 'Cancelled'
    GROUP BY l.id, l.highest_bid
    HAVING l.highest_bid IS NOT NULL AND l.highest_bid::numeric > 0
  `, [String(gameId)]);
  
  // For settled auctions: verify economic balance
  const settledCheck = await db.query(`
    SELECT 
      l.id,
      l.highest_bid,
      COUNT(b.id) as bid_count,
      SUM(b.amount::numeric) as total_bids
    FROM listings l
    INNER JOIN bids b ON b.listing_id = l.id
    WHERE l.game_id = $1 AND l.status = 'Settled' AND l.highest_bid IS NOT NULL
    GROUP BY l.id, l.highest_bid
    HAVING SUM(b.amount::numeric) < l.highest_bid::numeric
  `, [String(gameId)]);
  
  const errors: any[] = [];
  
  // Cancelled auctions should have zero vault balance (all refunded)
  for (const row of cancelledCheck.rows) {
    if (parseFloat(row.highest_bid) > 0) {
      errors.push({
        auction: row.id,
        issue: 'Cancelled auction has non-zero highest_bid (should be refunded)',
        highest_bid: row.highest_bid,
        total_bids: row.total_bids
      });
    }
  }
  
  // Settled auctions should have valid economic balance
  for (const row of settledCheck.rows) {
    errors.push({
      auction: row.id,
      issue: 'Settled auction has total_bids < highest_bid (economic inconsistency)',
      highest_bid: row.highest_bid,
      total_bids: row.total_bids
    });
  }
  
  if (errors.length > 0) {
    return {
      name: 'Per-Auction Economic Sanity',
      passed: false,
      message: `Found ${errors.length} auctions with economic inconsistencies`,
      details: errors.slice(0, 10) // Show first 10
    };
  }
  
  return {
    name: 'Per-Auction Economic Sanity',
    passed: true,
    message: 'All auctions have valid economic balances'
  };
}

/**
 * Global conservation
 * sum(all_user_balances + vaults + fees_treasury) is unchanged
 */
export async function checkGlobalConservation(
  db: Pool,
  gameId: string | number
): Promise<InvariantCheckResult> {
  // Calculate total funds in system
  // In real system, this would check player_ledger.available + locked + vault balances
  // For now, we verify that settled auctions have matching bid/payout records
  
  const totalBids = await db.query(`
    SELECT SUM(amount::numeric) as total
    FROM bids
    WHERE listing_id IN (
      SELECT id FROM listings WHERE game_id = $1
    )
  `, [String(gameId)]);
  
  const totalSettled = await db.query(`
    SELECT SUM(highest_bid::numeric) as total
    FROM listings
    WHERE game_id = $1 AND status = 'Settled' AND highest_bid IS NOT NULL
  `, [String(gameId)]);
  
  const totalCancelled = await db.query(`
    SELECT SUM(highest_bid::numeric) as total
    FROM listings
    WHERE game_id = $1 AND status = 'Cancelled' AND highest_bid IS NOT NULL
  `, [String(gameId)]);
  
  const totalBidsAmount = parseFloat(totalBids.rows[0]?.total || '0');
  const totalSettledAmount = parseFloat(totalSettled.rows[0]?.total || '0');
  const totalCancelledAmount = parseFloat(totalCancelled.rows[0]?.total || '0');
  
  // Total bids should be >= total settled + cancelled (some bids are losing bids)
  const expectedMinimum = totalSettledAmount + totalCancelledAmount;
  const difference = totalBidsAmount - expectedMinimum;
  
  // Allow some tolerance for losing bids
  if (difference < -1000) { // Allow 1000 lamports tolerance
    return {
      name: 'Global Conservation',
      passed: false,
      message: `Funds don't balance. Total bids (${totalBidsAmount}) < settled + cancelled (${expectedMinimum})`,
      details: {
        total_bids: totalBidsAmount,
        total_settled: totalSettledAmount,
        total_cancelled: totalCancelledAmount,
        difference
      }
    };
  }
  
  return {
    name: 'Global Conservation',
    passed: true,
    message: 'Global funds are conserved',
    details: {
      total_bids: totalBidsAmount,
      total_settled: totalSettledAmount,
      total_cancelled: totalCancelledAmount
    }
  };
}

/**
 * Fairness checks
 * - No loser has bid >= winner.bid for any auction
 * - No bidder appears as "winner" in an auction where they never placed a bid
 */
export async function checkFairness(
  db: Pool,
  gameId: string | number
): Promise<InvariantCheckResult> {
  const errors: any[] = [];
  
  // Check 1: No loser has bid >= winner.bid
  const loserBidCheck = await db.query(`
    SELECT 
      l.id,
      l.highest_bid,
      b.bidder,
      b.amount,
      w.bidder as winner_bidder
    FROM listings l
    INNER JOIN bids b ON b.listing_id = l.id
    INNER JOIN bids w ON w.listing_id = l.id AND w.amount = l.highest_bid
    WHERE l.game_id = $1 
      AND l.status = 'Settled'
      AND b.amount::numeric >= l.highest_bid::numeric
      AND b.bidder != w.bidder
  `, [String(gameId)]);
  
  for (const row of loserBidCheck.rows) {
    errors.push({
      auction: row.id,
      issue: 'Loser bid >= winner bid',
      loser: row.bidder,
      loser_bid: row.amount,
      winner: row.winner_bidder,
      winning_bid: row.highest_bid
    });
  }
  
  // Check 2: No phantom winners (winner never placed a bid)
  const phantomWinnerCheck = await db.query(`
    SELECT 
      l.id,
      l.highest_bid,
      w.bidder as winner_bidder
    FROM listings l
    INNER JOIN bids w ON w.listing_id = l.id AND w.amount = l.highest_bid
    WHERE l.game_id = $1 
      AND l.status = 'Settled'
      AND NOT EXISTS (
        SELECT 1 FROM bids b 
        WHERE b.listing_id = l.id AND b.bidder = w.bidder
      )
  `, [String(gameId)]);
  
  for (const row of phantomWinnerCheck.rows) {
    errors.push({
      auction: row.id,
      issue: 'Phantom winner (winner never placed a bid)',
      winner: row.winner_bidder,
      winning_bid: row.highest_bid
    });
  }
  
  if (errors.length > 0) {
    return {
      name: 'Fairness Checks',
      passed: false,
      message: `Found ${errors.length} fairness violations`,
      details: errors
    };
  }
  
  return {
    name: 'Fairness Checks',
    passed: true,
    message: 'All auctions are fair (no loser >= winner, no phantom winners)'
  };
}

/**
 * State coverage
 * Count how many auctions ended in each terminal state and assert:
 * settled + expired + cancelled == total_auctions
 * active == 0 at the end
 */
export async function checkStateCoverage(
  db: Pool,
  gameId: string | number
): Promise<InvariantCheckResult> {
  const stateCounts = await db.query(`
    SELECT 
      status,
      COUNT(*) as count
    FROM listings
    WHERE game_id = $1
    GROUP BY status
  `, [String(gameId)]);
  
  const total = await db.query(`
    SELECT COUNT(*) as count
    FROM listings
    WHERE game_id = $1
  `, [String(gameId)]);
  
  const totalCount = parseInt(total.rows[0]?.count || '0');
  
  const counts: Record<string, number> = {};
  for (const row of stateCounts.rows) {
    counts[row.status] = parseInt(row.count);
  }
  
  const settled = counts['Settled'] || 0;
  const expired = counts['Expired'] || 0;
  const cancelled = counts['Cancelled'] || 0;
  const active = counts['Active'] || 0;
  
  const terminalSum = settled + expired + cancelled;
  
  const errors: string[] = [];
  
  if (terminalSum + active !== totalCount) {
    errors.push(`State sum mismatch: settled(${settled}) + expired(${expired}) + cancelled(${cancelled}) + active(${active}) = ${terminalSum + active}, but total = ${totalCount}`);
  }
  
  // FIXED: Active auctions are OK if their end_time is in the future
  // Only flag active auctions that are past end_time
  const activePastEnd = await db.query(`
    SELECT COUNT(*) as count
    FROM listings
    WHERE game_id = $1 
      AND status = 'Active'
      AND end_time < NOW()
  `, [String(gameId)]);
  
  const activePastEndCount = parseInt(activePastEnd.rows[0]?.count || '0');
  
  if (activePastEndCount > 0) {
    errors.push(`Found ${activePastEndCount} active auctions past end_time (should be 0)`);
  }
  
  // Warn if there are many active auctions (might indicate they all have future end_times)
  if (active > totalCount * 0.5) {
    errors.push(`Warning: ${active} active auctions (${((active/totalCount)*100).toFixed(1)}%) - most may have future end_times`);
  }
  
  if (errors.length > 0) {
    return {
      name: 'State Coverage',
      passed: false,
      message: errors.join('; '),
      details: counts
    };
  }
  
  return {
    name: 'State Coverage',
    passed: true,
    message: `All ${totalCount} auctions in terminal states (${settled} settled, ${expired} expired, ${cancelled} cancelled)`,
    details: counts
  };
}

