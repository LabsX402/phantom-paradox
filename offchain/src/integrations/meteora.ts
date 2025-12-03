/**
 * Meteora DLMM Integration
 * 
 * Connects Phantom Paradox to Meteora DLMM pools
 * for real DeFi testing with PDOX token (Token-2022)
 * 
 * UPDATE (Nov 27, 2025): Meteora now fully supports Token-2022
 * with Transfer Fees and Transfer Hooks in DLMM pools!
 * This enables real mainnet deployment of PDOX/SOL pools.
 * 
 * @see https://meteora.ag
 */

import DLMM from '@meteora-ag/dlmm';
import { Connection, PublicKey, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// Meteora DLMM Program ID (same for mainnet & devnet)
export const METEORA_DLMM_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

// PDOX Token (Token-2022)
export const PDOX_MINT = new PublicKey('4ckvALSiB6Hii7iVY9Dt6LRM5i7xocBZ9yr3YGNtVRwF');

// Native SOL wrapped
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export interface MeteoraConfig {
  connection: Connection;
  wallet: Keypair;
  poolAddress?: PublicKey;
}

export class MeteoraIntegration {
  private connection: Connection;
  private wallet: Keypair;
  private dlmmPool: any = null;
  private poolAddress: PublicKey | null = null;

  constructor(config: MeteoraConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    if (config.poolAddress) {
      this.poolAddress = config.poolAddress;
    }
  }

  /**
   * Initialize connection to existing pool
   */
  async connectToPool(poolAddress: PublicKey): Promise<void> {
    console.log(`Connecting to Meteora pool: ${poolAddress.toBase58()}`);
    this.poolAddress = poolAddress;
    this.dlmmPool = await DLMM.create(this.connection, poolAddress);
    console.log('Connected to pool');
    
    // Log pool info
    const poolInfo = this.dlmmPool.lbPair;
    console.log('Pool info:', {
      tokenX: poolInfo.tokenXMint.toBase58(),
      tokenY: poolInfo.tokenYMint.toBase58(),
      binStep: poolInfo.binStep,
      activeId: poolInfo.activeId,
    });
  }

  /**
   * Get pool info
   */
  async getPoolInfo(): Promise<any> {
    if (!this.dlmmPool) throw new Error('Pool not connected');
    
    const lbPair = this.dlmmPool.lbPair;
    const activeBin = await this.dlmmPool.getActiveBin();
    
    return {
      address: this.poolAddress?.toBase58(),
      tokenX: lbPair.tokenXMint.toBase58(),
      tokenY: lbPair.tokenYMint.toBase58(),
      binStep: lbPair.binStep,
      activeId: lbPair.activeId,
      activeBinPrice: activeBin.price,
      reserveX: lbPair.reserveX.toString(),
      reserveY: lbPair.reserveY.toString(),
    };
  }

  /**
   * Get swap quote
   */
  async getSwapQuote(
    amountIn: BN,
    swapForY: boolean // true = X->Y, false = Y->X
  ): Promise<{
    amountOut: BN;
    fee: BN;
    priceImpact: number;
  }> {
    if (!this.dlmmPool) throw new Error('Pool not connected');
    
    const quote = await this.dlmmPool.swapQuote(amountIn, swapForY, new BN(10)); // 10 bps slippage
    
    return {
      amountOut: quote.outAmount,
      fee: quote.fee,
      priceImpact: quote.priceImpact,
    };
  }

  /**
   * Execute swap
   */
  async swap(
    amountIn: BN,
    swapForY: boolean,
    minAmountOut: BN
  ): Promise<string> {
    if (!this.dlmmPool) throw new Error('Pool not connected');
    
    console.log(`Swapping ${amountIn.toString()} ${swapForY ? 'X->Y' : 'Y->X'}`);
    
    const swapTx = await this.dlmmPool.swap({
      inAmount: amountIn,
      outAmount: minAmountOut,
      swapForY,
      user: this.wallet.publicKey,
    });
    
    const sig = await sendAndConfirmTransaction(
      this.connection,
      swapTx,
      [this.wallet],
      { commitment: 'confirmed' }
    );
    
    console.log(`Swap TX: ${sig}`);
    return sig;
  }

  /**
   * Add liquidity to pool
   */
  async addLiquidity(
    amountX: BN,
    amountY: BN,
    binRange: number = 10 // bins on each side of active
  ): Promise<string> {
    if (!this.dlmmPool) throw new Error('Pool not connected');
    
    console.log(`Adding liquidity: ${amountX.toString()} X, ${amountY.toString()} Y`);
    
    const activeBin = await this.dlmmPool.getActiveBin();
    const activeId = activeBin.binId;
    
    // Create position around active bin
    const minBinId = activeId - binRange;
    const maxBinId = activeId + binRange;
    
    const addLiquidityTx = await this.dlmmPool.addLiquidityByStrategy({
      user: this.wallet.publicKey,
      totalXAmount: amountX,
      totalYAmount: amountY,
      strategy: {
        minBinId,
        maxBinId,
        strategyType: 'SpotBalanced', // Even distribution
      },
    });
    
    // Could be multiple transactions
    const txs = Array.isArray(addLiquidityTx) ? addLiquidityTx : [addLiquidityTx];
    const sigs: string[] = [];
    
    for (const tx of txs) {
      const sig = await sendAndConfirmTransaction(
        this.connection,
        tx,
        [this.wallet],
        { commitment: 'confirmed' }
      );
      sigs.push(sig);
    }
    
    console.log(`Add liquidity TXs: ${sigs.join(', ')}`);
    return sigs[0];
  }

  /**
   * Remove liquidity from pool
   */
  async removeLiquidity(percentage: number = 100): Promise<string> {
    if (!this.dlmmPool) throw new Error('Pool not connected');
    
    console.log(`Removing ${percentage}% liquidity`);
    
    // Get user positions
    const positions = await this.dlmmPool.getPositionsByUserAndLbPair(
      this.wallet.publicKey
    );
    
    if (positions.length === 0) {
      throw new Error('No positions found');
    }
    
    const position = positions[0]; // Take first position
    
    const removeLiquidityTx = await this.dlmmPool.removeLiquidity({
      user: this.wallet.publicKey,
      position: position.publicKey,
      bps: new BN(percentage * 100), // basis points
    });
    
    const sig = await sendAndConfirmTransaction(
      this.connection,
      removeLiquidityTx,
      [this.wallet],
      { commitment: 'confirmed' }
    );
    
    console.log(`Remove liquidity TX: ${sig}`);
    return sig;
  }

  /**
   * Get user positions
   */
  async getUserPositions(): Promise<any[]> {
    if (!this.dlmmPool) throw new Error('Pool not connected');
    
    const positions = await this.dlmmPool.getPositionsByUserAndLbPair(
      this.wallet.publicKey
    );
    
    return positions.map((p: any) => ({
      address: p.publicKey.toBase58(),
      lowerBinId: p.lowerBinId,
      upperBinId: p.upperBinId,
      liquidityShares: p.liquidityShares.toString(),
    }));
  }
}

/**
 * Fetch all available DLMM pools from Meteora API
 */
export async function fetchAllPools(): Promise<any[]> {
  const response = await fetch('https://dlmm-api.meteora.ag/pair/all');
  return response.json();
}

/**
 * Find pools for a specific token
 */
export async function findPoolsForToken(tokenMint: string): Promise<any[]> {
  const allPools = await fetchAllPools();
  return allPools.filter(
    (p: any) => p.mint_x === tokenMint || p.mint_y === tokenMint
  );
}

/**
 * Get pool info by address from API
 */
export async function getPoolFromApi(poolAddress: string): Promise<any> {
  const response = await fetch(`https://dlmm-api.meteora.ag/pair/${poolAddress}`);
  if (!response.ok) {
    throw new Error(`Pool not found: ${poolAddress}`);
  }
  return response.json();
}

export default MeteoraIntegration;
