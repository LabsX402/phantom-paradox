/**
 * Fiat Payout Batcher
 * Processes fiat payouts for completed jobs
 * Runs every hour via cron
 */

import { query } from "../shared/db";
import { logger } from "../shared/logger";

// Mock payment providers (replace with actual implementations)
async function processPayPalBatch(payments: any[]) {
  logger.info(`Processing ${payments.length} PayPal payments`);
  
  // TODO: Integrate with PayPal API
  // For now, just mark as paid
  for (const payment of payments) {
    await query(
      `UPDATE completed_jobs 
       SET fiat_paid = true, fiat_paid_at = NOW() 
       WHERE id = $1`,
      [payment.id]
    );
  }
  
  return { success: payments.length, failed: 0 };
}

async function processMPesaBatch(payments: any[]) {
  logger.info(`Processing ${payments.length} M-Pesa payments`);
  
  // TODO: Integrate with M-Pesa API
  // For now, just mark as paid
  for (const payment of payments) {
    await query(
      `UPDATE completed_jobs 
       SET fiat_paid = true, fiat_paid_at = NOW() 
       WHERE id = $1`,
      [payment.id]
    );
  }
  
  return { success: payments.length, failed: 0 };
}

async function processUPIBatch(payments: any[]) {
  logger.info(`Processing ${payments.length} UPI payments`);
  
  // TODO: Integrate with UPI API
  // For now, just mark as paid
  for (const payment of payments) {
    await query(
      `UPDATE completed_jobs 
       SET fiat_paid = true, fiat_paid_at = NOW() 
       WHERE id = $1`,
      [payment.id]
    );
  }
  
  return { success: payments.length, failed: 0 };
}

async function processAlipayBatch(payments: any[]) {
  logger.info(`Processing ${payments.length} Alipay payments`);
  
  // TODO: Integrate with Alipay API
  // For now, just mark as paid
  for (const payment of payments) {
    await query(
      `UPDATE completed_jobs 
       SET fiat_paid = true, fiat_paid_at = NOW() 
       WHERE id = $1`,
      [payment.id]
    );
  }
  
  return { success: payments.length, failed: 0 };
}

/**
 * Process fiat payouts for completed jobs
 */
async function processFiatPayouts() {
  try {
    logger.info("Starting fiat payout batch processing");

    // Get all pending fiat payouts
    const result = await query(
      `SELECT * FROM completed_jobs 
       WHERE fiat_paid = false 
       AND payout_method NOT IN ('SOL', 'USDC')
       ORDER BY completed_at ASC`
    );

    const pending = result.rows;

    if (pending.length === 0) {
      logger.info("No pending fiat payouts");
      return;
    }

    logger.info(`Processing ${pending.length} pending fiat payouts`);

    // Group by payout method
    const paypalBatch = pending.filter((p: any) => p.payout_method === "PAYPAL");
    const mpesaBatch = pending.filter((p: any) => p.payout_method === "MPESA");
    const upiBatch = pending.filter((p: any) => p.payout_method === "UPI");
    const alipayBatch = pending.filter((p: any) => p.payout_method === "ALIPAY");

    // Process each batch
    const results = {
      paypal: { success: 0, failed: 0 },
      mpesa: { success: 0, failed: 0 },
      upi: { success: 0, failed: 0 },
      alipay: { success: 0, failed: 0 },
    };

    if (paypalBatch.length > 0) {
      try {
        const result = await processPayPalBatch(paypalBatch);
        results.paypal = result;
      } catch (error: any) {
        logger.error("PayPal batch processing failed", { error });
        results.paypal.failed = paypalBatch.length;
      }
    }

    if (mpesaBatch.length > 0) {
      try {
        const result = await processMPesaBatch(mpesaBatch);
        results.mpesa = result;
      } catch (error: any) {
        logger.error("M-Pesa batch processing failed", { error });
        results.mpesa.failed = mpesaBatch.length;
      }
    }

    if (upiBatch.length > 0) {
      try {
        const result = await processUPIBatch(upiBatch);
        results.upi = result;
      } catch (error: any) {
        logger.error("UPI batch processing failed", { error });
        results.upi.failed = upiBatch.length;
      }
    }

    if (alipayBatch.length > 0) {
      try {
        const result = await processAlipayBatch(alipayBatch);
        results.alipay = result;
      } catch (error: any) {
        logger.error("Alipay batch processing failed", { error });
        results.alipay.failed = alipayBatch.length;
      }
    }

    const totalSuccess = 
      results.paypal.success + 
      results.mpesa.success + 
      results.upi.success + 
      results.alipay.success;
    
    const totalFailed = 
      results.paypal.failed + 
      results.mpesa.failed + 
      results.upi.failed + 
      results.alipay.failed;

    logger.info("Fiat payout batch processing completed", {
      totalSuccess,
      totalFailed,
      results,
    });
  } catch (error: any) {
    logger.error("Fiat payout processing failed", { error });
  }
}

/**
 * Start the fiat payout batcher
 * Runs every hour
 */
export function startFiatPayoutBatcher() {
  logger.info("Starting fiat payout batcher (runs every hour)");
  
  // Run immediately
  processFiatPayouts();
  
  // Then run every hour (3600000 ms)
  setInterval(() => {
    processFiatPayouts();
  }, 3600000);
}

// If run directly, start the batcher
if (require.main === module) {
  startFiatPayoutBatcher();
}

