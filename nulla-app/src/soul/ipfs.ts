// Nulla Soul - IPFS Permanent Storage via Pinata
// Free tier: 1GB storage, 100 pins

const PINATA_API = 'https://api.pinata.cloud';
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

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

// Get Pinata JWT from localStorage
function getPinataJWT(): string | null {
  return localStorage.getItem('nulla_pinata_jwt');
}

// Set Pinata JWT
export function setPinataJWT(jwt: string): void {
  localStorage.setItem('nulla_pinata_jwt', jwt);
  console.log('[IPFS] Pinata JWT saved');
}

// Check if Pinata is configured
export function isPinataConfigured(): boolean {
  return !!getPinataJWT();
}

// Upload soul snapshot to IPFS via Pinata
export async function uploadToIPFS(snapshot: SoulSnapshot): Promise<string | null> {
  const jwt = getPinataJWT();
  
  if (!jwt) {
    console.warn('[IPFS] No Pinata JWT configured, using localStorage fallback');
    return saveToLocalStorage(snapshot);
  }
  
  try {
    const data = JSON.stringify(snapshot);
    const blob = new Blob([data], { type: 'application/json' });
    
    const formData = new FormData();
    formData.append('file', blob, `nulla-soul-${Date.now()}.json`);
    
    // Add metadata
    const metadata = JSON.stringify({
      name: `Nulla Soul Snapshot`,
      keyvalues: {
        stage: snapshot.stage.toString(),
        xp: snapshot.xp.toString(),
        timestamp: snapshot.timestamp.toString()
      }
    });
    formData.append('pinataMetadata', metadata);
    
    const response = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Pinata error: ${error.message || response.status}`);
    }
    
    const result = await response.json();
    const ipfsHash = result.IpfsHash;
    const uri = `${IPFS_GATEWAY}/${ipfsHash}`;
    
    console.log('[IPFS] Uploaded! Hash:', ipfsHash);
    
    // Save reference locally
    saveLatestReference(ipfsHash, uri);
    
    return uri;
    
  } catch (error) {
    console.error('[IPFS] Upload failed:', error);
    // Fallback to localStorage
    return saveToLocalStorage(snapshot);
  }
}

// Fetch soul snapshot from IPFS
export async function fetchFromIPFS(uri: string): Promise<SoulSnapshot | null> {
  try {
    // Handle local fallback
    if (uri.startsWith('local://')) {
      return loadFromLocalStorage(uri);
    }
    
    // Fetch from IPFS gateway
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }
    
    const snapshot = await response.json();
    return snapshot as SoulSnapshot;
    
  } catch (error) {
    console.error('[IPFS] Fetch failed:', error);
    return null;
  }
}

// List all pinned souls (for history)
export async function listPinnedSouls(): Promise<Array<{ hash: string; timestamp: number }>> {
  const jwt = getPinataJWT();
  
  if (!jwt) {
    // Return local backups
    return getLocalBackupList();
  }
  
  try {
    const response = await fetch(`${PINATA_API}/data/pinList?status=pinned&metadata[name]=Nulla Soul Snapshot`, {
      headers: {
        'Authorization': `Bearer ${jwt}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Pinata list error: ${response.status}`);
    }
    
    const result = await response.json();
    return result.rows.map((row: any) => ({
      hash: row.ipfs_pin_hash,
      timestamp: new Date(row.date_pinned).getTime()
    }));
    
  } catch (error) {
    console.error('[IPFS] List failed:', error);
    return getLocalBackupList();
  }
}

// ============ LOCAL STORAGE FALLBACK ============

async function hashSnapshot(snapshot: SoulSnapshot): Promise<string> {
  const data = JSON.stringify(snapshot);
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function saveToLocalStorage(snapshot: SoulSnapshot): Promise<string> {
  const hash = await hashSnapshot(snapshot);
  const shortHash = hash.slice(0, 16);
  const data = JSON.stringify(snapshot);
  
  localStorage.setItem(`nulla_soul_${shortHash}`, data);
  saveLatestReference(shortHash, `local://${shortHash}`);
  
  console.log('[Soul] Saved locally:', shortHash);
  return `local://${shortHash}`;
}

function loadFromLocalStorage(uri: string): SoulSnapshot | null {
  const hash = uri.replace('local://', '');
  const data = localStorage.getItem(`nulla_soul_${hash}`);
  
  if (data) {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

function saveLatestReference(hash: string, uri: string): void {
  const ref = {
    hash,
    uri,
    timestamp: Date.now()
  };
  localStorage.setItem('nulla_soul_latest', JSON.stringify(ref));
  
  // Also maintain a history
  const history = JSON.parse(localStorage.getItem('nulla_soul_history') || '[]');
  history.unshift(ref);
  // Keep last 20
  localStorage.setItem('nulla_soul_history', JSON.stringify(history.slice(0, 20)));
}

function getLocalBackupList(): Array<{ hash: string; timestamp: number }> {
  const history = JSON.parse(localStorage.getItem('nulla_soul_history') || '[]');
  return history;
}

// ============ EXPORTS ============

// Get the latest soul backup reference
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

// Create soul snapshot from brain state
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

// Quick upload helper
export async function backupSoul(brainState: any): Promise<string | null> {
  const snapshot = createSoulSnapshot(brainState);
  return uploadToIPFS(snapshot);
}

// Restore latest soul
export async function restoreLatestSoul(): Promise<SoulSnapshot | null> {
  const latest = getLatestBackup();
  if (!latest) return null;
  return fetchFromIPFS(latest.uri);
}

