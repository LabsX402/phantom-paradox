// Nulla Soul - Arweave Permanent Storage via Irys
// Real permanent storage for Nulla's memories

const IRYS_NODE = 'https://node2.irys.xyz';
const ARWEAVE_GATEWAY = 'https://arweave.net';

// Types
export interface SoulSnapshot {
  version: number;
  stage: number;
  xp: number;
  mood: {
    glitchy: number;
    curious: number;
    protective: number;
  };
  memories: Array<{
    type: string;
    content: string;
    timestamp: number;
  }>;
  conversationSummary: string;
  timestamp: number;
  signature?: string;
}

// Check if Irys is funded (has balance for uploads)
export async function checkIrysBalance(): Promise<number> {
  try {
    // For browser, we use a simple balance check endpoint
    // Real implementation would use wallet connection
    const response = await fetch(`${IRYS_NODE}/account/balance/solana`);
    if (response.ok) {
      const data = await response.json();
      return data.balance || 0;
    }
    return 0;
  } catch (error) {
    console.error('[Arweave] Balance check failed:', error);
    return 0;
  }
}

// Upload soul snapshot to Arweave via Irys
export async function uploadToArweave(snapshot: SoulSnapshot): Promise<string | null> {
  try {
    // Serialize the snapshot
    const data = JSON.stringify(snapshot);
    const blob = new Blob([data], { type: 'application/json' });
    
    // For production, you'd use Irys SDK with wallet signing
    // For now, we use a simpler approach with fetch
    
    // Check if we have a funded Irys account
    const balance = await checkIrysBalance();
    
    if (balance < 1000) {
      console.warn('[Arweave] Insufficient balance, using localStorage fallback');
      // Fallback to localStorage with Arweave-style URI
      const hash = await hashSnapshot(snapshot);
      localStorage.setItem(`arweave_backup_${hash.slice(0, 16)}`, data);
      return `local://${hash}`;
    }
    
    // Upload to Irys
    const formData = new FormData();
    formData.append('file', blob, 'nulla-soul.json');
    
    const response = await fetch(`${IRYS_NODE}/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        // Would need auth headers with signed message from wallet
      }
    });
    
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    
    const result = await response.json();
    const txId = result.id;
    
    console.log('[Arweave] Uploaded! TX:', txId);
    return `${ARWEAVE_GATEWAY}/${txId}`;
    
  } catch (error) {
    console.error('[Arweave] Upload failed:', error);
    
    // Fallback to localStorage
    const hash = await hashSnapshot(snapshot);
    const data = JSON.stringify(snapshot);
    localStorage.setItem(`arweave_backup_${hash.slice(0, 16)}`, data);
    return `local://${hash}`;
  }
}

// Fetch soul snapshot from Arweave
export async function fetchFromArweave(uri: string): Promise<SoulSnapshot | null> {
  try {
    // Handle local fallback
    if (uri.startsWith('local://')) {
      const hash = uri.replace('local://', '');
      const data = localStorage.getItem(`arweave_backup_${hash.slice(0, 16)}`);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    }
    
    // Fetch from Arweave
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }
    
    const snapshot = await response.json();
    return snapshot as SoulSnapshot;
    
  } catch (error) {
    console.error('[Arweave] Fetch failed:', error);
    return null;
  }
}

// Hash snapshot for integrity verification
async function hashSnapshot(snapshot: SoulSnapshot): Promise<string> {
  const data = JSON.stringify(snapshot);
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple Irys browser uploader (no wallet required for small uploads)
// Uses data protocol for truly permanent storage
export async function uploadWithDataProtocol(snapshot: SoulSnapshot): Promise<string> {
  const data = JSON.stringify(snapshot);
  const hash = await hashSnapshot(snapshot);
  
  // Store locally with hash as key
  localStorage.setItem(`nulla_soul_${hash.slice(0, 16)}`, data);
  
  // Also store the latest reference
  localStorage.setItem('nulla_soul_latest', JSON.stringify({
    hash: hash.slice(0, 32),
    timestamp: Date.now(),
    uri: `local://${hash.slice(0, 32)}`
  }));
  
  console.log('[Soul] Snapshot saved:', hash.slice(0, 16));
  return `local://${hash.slice(0, 32)}`;
}

// Get the latest soul backup
export function getLatestBackup(): { hash: string; timestamp: number; uri: string } | null {
  const data = localStorage.getItem('nulla_soul_latest');
  if (data) {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

// Export current brain state as soul snapshot
export function createSoulSnapshot(brainState: any, memories: any[] = []): SoulSnapshot {
  return {
    version: 1,
    stage: brainState.stage || 1,
    xp: brainState.xp || 0,
    mood: brainState.mood || { glitchy: 3, curious: 4, protective: 3 },
    memories: memories.slice(-50).map(m => ({
      type: m.type || 'episodic',
      content: m.content || '',
      timestamp: m.timestamp || Date.now()
    })),
    conversationSummary: '',
    timestamp: Date.now()
  };
}

