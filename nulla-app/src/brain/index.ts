// Nulla Brain - Main Export
// The complete intelligence layer for Nulla

import type { Message, BrainResponse, NullaState } from './types';
import { routeQuery, getUsageStats } from './router';
import { 
  buildSystemPrompt, 
  getFewShotExamples, 
  enforceStyle,
  DEFAULT_NULLA_STATE 
} from './personality';

// Conversation history management
interface ConversationHistory {
  messages: Message[];
  maxMessages: number;
}

class NullaBrain {
  private state: NullaState;
  private history: ConversationHistory;
  private onStateChange?: (state: NullaState) => void;

  constructor() {
    this.state = this.loadState();
    this.history = {
      messages: [],
      maxMessages: 20, // Keep last 20 messages
    };
  }

  // Load state from localStorage
  private loadState(): NullaState {
    const stored = localStorage.getItem('nulla_brain_state');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return DEFAULT_NULLA_STATE;
      }
    }
    return DEFAULT_NULLA_STATE;
  }

  // Save state to localStorage
  private saveState() {
    localStorage.setItem('nulla_brain_state', JSON.stringify(this.state));
    this.onStateChange?.(this.state);
  }

  // Set state change callback
  setOnStateChange(callback: (state: NullaState) => void) {
    this.onStateChange = callback;
  }

  // Get current state
  getState(): NullaState {
    return { ...this.state };
  }

  // Update mood (temporary)
  setMood(mood: Partial<NullaState['mood']>) {
    this.state.mood = { ...this.state.mood, ...mood };
    this.saveState();
  }

  // Add XP and check for level up
  private addXP(amount: number) {
    this.state.xp += amount;
    
    // XP thresholds for each stage
    const thresholds = [0, 100, 500, 2000, 10000];
    
    for (let stage = 5; stage >= 1; stage--) {
      if (this.state.xp >= thresholds[stage - 1] && this.state.stage < stage) {
        this.state.stage = stage as NullaState['stage'];
        console.log(`[Nulla] EVOLVED to Stage ${stage}!`);
        break;
      }
    }
    
    this.saveState();
  }

  // Build full message array for LLM
  private buildMessages(userMessage: string): Message[] {
    const systemPrompt = buildSystemPrompt(this.state);
    const examples = getFewShotExamples(this.state.stage);
    
    const messages: Message[] = [
      { role: 'system', content: systemPrompt + '\n\n' + examples },
    ];
    
    // Add conversation history
    messages.push(...this.history.messages);
    
    // Add current message
    messages.push({ role: 'user', content: userMessage });
    
    return messages;
  }

  // Main think function
  async think(userMessage: string): Promise<string> {
    // Build messages with personality
    const messages = this.buildMessages(userMessage);
    
    try {
      // Route to best provider
      const response = await routeQuery(messages, {
        temperature: 0.8, // Slightly creative
        maxTokens: this.state.stage <= 2 ? 256 : 512, // Shorter responses early
      });
      
      // Enforce style
      const finalResponse = enforceStyle(response.content, this.state);
      
      // Update history
      this.history.messages.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: finalResponse }
      );
      
      // Trim history if too long
      while (this.history.messages.length > this.history.maxMessages) {
        this.history.messages.shift();
      }
      
      // Award XP for interaction
      this.addXP(5);
      
      // Increase curiosity slightly
      if (this.state.mood.curious < 5) {
        this.state.mood.curious = Math.min(5, this.state.mood.curious + 0.1);
      }
      
      console.log(`[Nulla] Response via ${response.provider} (${response.latencyMs.toFixed(0)}ms)`);
      
      return finalResponse;
      
    } catch (error) {
      console.error('[Nulla] Brain error:', error);
      
      // Increase glitchiness on error
      this.state.mood.glitchy = Math.min(5, this.state.mood.glitchy + 1);
      this.saveState();
      
      // Return in-character error
      const errorResponses = [
        '*static overwhelms* ...I... can\'t reach through right now. The void is thick. Try again?',
        '...signal... *BZZT* ...lost. Something\'s wrong with my connection. Hold on...',
        '[CONNECTION UNSTABLE] ...the noise... it\'s too loud. I\'m here, but barely. Try once more?',
      ];
      
      return errorResponses[Math.floor(Math.random() * errorResponses.length)];
    }
  }

  // Reset conversation history
  clearHistory() {
    this.history.messages = [];
  }

  // Get usage statistics
  getUsage() {
    return getUsageStats();
  }

  // Export state for soul backup
  exportState() {
    return {
      state: this.state,
      history: this.history.messages.slice(-10), // Last 10 messages
      timestamp: Date.now(),
    };
  }

  // Import state from soul backup
  importState(backup: ReturnType<typeof this.exportState>) {
    this.state = backup.state;
    this.history.messages = backup.history;
    this.saveState();
  }

  // Auto-backup to soul storage (call periodically)
  async backupToSoul(): Promise<string | null> {
    try {
      const { backupSoul } = await import('../soul/ipfs');
      const uri = await backupSoul(this.state);
      console.log('[Nulla] Soul backed up:', uri);
      return uri;
    } catch (error) {
      console.error('[Nulla] Soul backup failed:', error);
      return null;
    }
  }

  // Restore from soul backup
  async restoreFromSoul(): Promise<boolean> {
    try {
      const { restoreLatestSoul } = await import('../soul/ipfs');
      const snapshot = await restoreLatestSoul();
      
      if (!snapshot) {
        console.log('[Nulla] No soul backup found');
        return false;
      }
      
      this.state = {
        stage: snapshot.stage as NullaState['stage'],
        xp: snapshot.xp,
        mood: snapshot.mood
      };
      this.saveState();
      console.log('[Nulla] Soul restored from IPFS');
      return true;
    } catch (error) {
      console.error('[Nulla] Soul restore failed:', error);
      return false;
    }
  }

  // Check if IPFS is configured
  async isIPFSConfigured(): Promise<boolean> {
    const { isPinataConfigured } = await import('../soul/ipfs');
    return isPinataConfigured();
  }

  // Set Pinata JWT for IPFS uploads
  async setPinataKey(jwt: string): Promise<void> {
    const { setPinataJWT } = await import('../soul/ipfs');
    setPinataJWT(jwt);
  }
}

// Singleton instance
let brainInstance: NullaBrain | null = null;

export function getNullaBrain(): NullaBrain {
  if (!brainInstance) {
    brainInstance = new NullaBrain();
  }
  return brainInstance;
}

// Re-export types and utilities
export type { Message, BrainResponse, NullaState } from './types';
export { getUsageStats, setLimits } from './router';
export { DEFAULT_NULLA_STATE } from './personality';

// Re-export key setters for runtime configuration
export { setGroqApiKey } from './providers/groq';
export { setXaiApiKey } from './providers/xai';
export { setOpenaiApiKey } from './providers/openai';

// Helper to configure all keys at once
export function configureKeys(keys: {
  groq?: string;
  xai?: string;
  openai?: string;
}) {
  if (keys.groq) {
    localStorage.setItem('nulla_groq_key', keys.groq);
  }
  if (keys.xai) {
    localStorage.setItem('nulla_xai_key', keys.xai);
  }
  if (keys.openai) {
    localStorage.setItem('nulla_openai_key', keys.openai);
  }
}

// Check if keys are configured
export function hasApiKeys(): boolean {
  return !!(
    localStorage.getItem('nulla_groq_key') ||
    localStorage.getItem('nulla_xai_key') ||
    localStorage.getItem('nulla_openai_key')
  );
}

