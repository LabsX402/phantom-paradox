/**
 * IPFS Storage for Intent Storage
 * Supports Pinata, Filecoin, and IPFS gateways
 */

import { logger } from "../shared/logger";
import { TradeIntent } from "../netting/types";

const IPFS_PROVIDER = process.env.IPFS_PROVIDER || "pinata"; // "pinata" | "filecoin" | "gateway"

interface IPFSResult {
  cid: string;
  url: string;
}

/**
 * Pin to Pinata
 */
async function pinToPinata(data: any): Promise<IPFSResult> {
  const pinataApiKey = process.env.PINATA_API_KEY;
  const pinataSecretKey = process.env.PINATA_SECRET_KEY;

  if (!pinataApiKey || !pinataSecretKey) {
    throw new Error("Pinata credentials not set");
  }

  // Convert data to JSON
  const jsonData = JSON.stringify(data);
  const blob = new Blob([jsonData], { type: "application/json" });
  const formData = new FormData();
  formData.append("file", blob, "intent.json");

  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      pinata_api_key: pinataApiKey,
      pinata_secret_api_key: pinataSecretKey,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Pinata upload failed: ${response.statusText}`);
  }

  const result = await response.json();
  const cid = result.IpfsHash;
  
  return {
    cid,
    url: `https://gateway.pinata.cloud/ipfs/${cid}`,
  };
}

/**
 * Store on Filecoin (via NFT.Storage or similar)
 */
async function storeOnFilecoin(data: any): Promise<IPFSResult> {
  const nftStorageKey = process.env.NFT_STORAGE_KEY;

  if (!nftStorageKey) {
    throw new Error("NFT.Storage key not set");
  }

  const jsonData = JSON.stringify(data);
  const blob = new Blob([jsonData], { type: "application/json" });

  const response = await fetch("https://api.nft.storage/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${nftStorageKey}`,
    },
    body: blob,
  });

  if (!response.ok) {
    throw new Error(`Filecoin upload failed: ${response.statusText}`);
  }

  const result = await response.json();
  const cid = result.value.cid;
  
  return {
    cid,
    url: `https://${cid}.ipfs.nftstorage.link/`,
  };
}

/**
 * Store intents to IPFS with auto-failover
 */
export async function storeIntentsToIPFS(intents: TradeIntent[]): Promise<IPFSResult> {
  try {
    const data = {
      intents,
      timestamp: new Date().toISOString(),
      version: "1.0",
    };

    let result: IPFSResult;
    let lastError: Error | null = null;

    // Try primary provider first
    if (IPFS_PROVIDER === "pinata") {
      try {
        result = await pinToPinata(data);
        logger.info("[IPFS] Stored intents to IPFS (Pinata)", {
          cid: result.cid,
          url: result.url,
          numIntents: intents.length,
        });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn("[IPFS] Pinata upload failed, trying Filecoin fallback", { error: lastError.message });
        
        // Auto-failover to Filecoin
        if (process.env.IPFS_FALLBACK_TO_FILECOIN !== "false") {
          try {
            result = await storeOnFilecoin(data);
            logger.info("[IPFS] Stored intents to IPFS (Filecoin fallback)", {
              cid: result.cid,
              url: result.url,
              numIntents: intents.length,
            });
            return result;
          } catch (fallbackError) {
            logger.error("[IPFS] Both Pinata and Filecoin failed", { 
              pinataError: lastError.message,
              filecoinError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            });
            throw lastError; // Throw original error
          }
        } else {
          throw lastError;
        }
      }
    } else if (IPFS_PROVIDER === "filecoin") {
      try {
        result = await storeOnFilecoin(data);
        logger.info("[IPFS] Stored intents to IPFS (Filecoin)", {
          cid: result.cid,
          url: result.url,
          numIntents: intents.length,
        });
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn("[IPFS] Filecoin upload failed, trying Pinata fallback", { error: lastError.message });
        
        // Auto-failover to Pinata
        if (process.env.IPFS_FALLBACK_TO_PINATA !== "false") {
          try {
            result = await pinToPinata(data);
            logger.info("[IPFS] Stored intents to IPFS (Pinata fallback)", {
              cid: result.cid,
              url: result.url,
              numIntents: intents.length,
            });
            return result;
          } catch (fallbackError) {
            logger.error("[IPFS] Both Filecoin and Pinata failed", { 
              filecoinError: lastError.message,
              pinataError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            });
            throw lastError; // Throw original error
          }
        } else {
          throw lastError;
        }
      }
    } else {
      throw new Error(`Unsupported IPFS provider: ${IPFS_PROVIDER}`);
    }
  } catch (error) {
    logger.error("[IPFS] Failed to store intents", { error });
    throw error;
  }
}

/**
 * Retrieve intents from IPFS with auto-failover
 */
export async function retrieveIntentsFromIPFS(cid: string): Promise<TradeIntent[]> {
  try {
    // Try multiple gateways for redundancy (auto-failover)
    const gateways = [
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
      `https://cloudflare-ipfs.com/ipfs/${cid}`,
      `https://${cid}.ipfs.nftstorage.link/`,
      `https://dweb.link/ipfs/${cid}`,
      `https://ipfs.filebase.io/ipfs/${cid}`,
    ];

    let lastError: Error | null = null;

    for (const gateway of gateways) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout per gateway
        
        const response = await fetch(gateway, {
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          logger.info("[IPFS] Retrieved intents from IPFS", {
            cid,
            gateway,
            numIntents: data.intents?.length || 0,
          });
          return data.intents || [];
        } else {
          lastError = new Error(`Gateway returned ${response.status}: ${response.statusText}`);
          logger.warn("[IPFS] Gateway returned error, trying next", { gateway, status: response.status });
        }
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn("[IPFS] Gateway failed, trying next", { gateway, error: lastError.message });
      }
    }

    // If all gateways fail, try Filecoin alternative if configured
    if (IPFS_PROVIDER === "filecoin" || process.env.IPFS_FALLBACK_TO_FILECOIN === "true") {
      try {
        logger.info("[IPFS] All gateways failed, trying Filecoin fallback");
        const nftStorageKey = process.env.NFT_STORAGE_KEY;
        if (nftStorageKey) {
          const filecoinUrl = `https://${cid}.ipfs.nftstorage.link/`;
          const response = await fetch(filecoinUrl);
          if (response.ok) {
            const data = await response.json();
            logger.info("[IPFS] Retrieved from Filecoin fallback", { cid, numIntents: data.intents?.length || 0 });
            return data.intents || [];
          }
        }
      } catch (error) {
        logger.warn("[IPFS] Filecoin fallback also failed", { error });
      }
    }

    throw lastError || new Error(`Failed to retrieve from all IPFS gateways: ${cid}`);
  } catch (error) {
    logger.error("[IPFS] Failed to retrieve intents", { cid, error });
    throw error;
  }
}

/**
 * Store batch metadata to IPFS
 */
export async function storeBatchToIPFS(batchId: string, batchData: any): Promise<IPFSResult> {
  const data = {
    batchId,
    ...batchData,
    timestamp: new Date().toISOString(),
  };

  if (IPFS_PROVIDER === "pinata") {
    return await pinToPinata(data);
  } else if (IPFS_PROVIDER === "filecoin") {
    return await storeOnFilecoin(data);
  } else {
    throw new Error(`Unsupported IPFS provider: ${IPFS_PROVIDER}`);
  }
}

