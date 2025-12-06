// Nulla Brain - Type Definitions

export type Provider = 'groq' | 'xai' | 'openai' | 'local';

export type QueryComplexity = 'simple' | 'medium' | 'complex';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BrainConfig {
  provider: Provider;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  costPer1kTokens: number;
  dailyLimit: number;
}

export interface UsageStats {
  provider: Provider;
  tokensUsed: number;
  costUsd: number;
  timestamp: number;
}

export interface BrainResponse {
  content: string;
  provider: Provider;
  model: string;
  tokensUsed: number;
  latencyMs: number;
}

// Nulla's personality stages
export type NullaStage = 1 | 2 | 3 | 4 | 5;

export interface NullaState {
  stage: NullaStage;
  xp: number;
  mood: {
    glitchy: number;  // 0-5
    curious: number;  // 0-5
    protective: number; // 0-5
  };
}

