// xAI/Grok Provider - Good reasoning, balanced cost
import type { Message, BrainResponse } from '../types';

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';

// Models available on xAI
export const XAI_MODELS = {
  grok: 'grok-beta',           // Main Grok model
  grokVision: 'grok-vision-beta', // With vision
} as const;

// Get API key from localStorage (set at runtime, not bundled)
function getApiKey(): string | null {
  return localStorage.getItem('nulla_xai_key');
}

export function setXaiApiKey(key: string) {
  localStorage.setItem('nulla_xai_key', key);
}

export async function callXAI(
  messages: Message[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<BrainResponse> {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error('XAI_API_KEY not configured - set via setXaiApiKey()');
  }

  const model = options.model || XAI_MODELS.grok;
  const startTime = performance.now();

  const response = await fetch(XAI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1024,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`xAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = performance.now() - startTime;

  return {
    content: data.choices[0]?.message?.content || '',
    provider: 'xai',
    model,
    tokensUsed: data.usage?.total_tokens || 0,
    latencyMs,
  };
}

