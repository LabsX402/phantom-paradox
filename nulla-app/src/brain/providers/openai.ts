// OpenAI Provider - Best quality, reserved for complex queries
import type { Message, BrainResponse } from '../types';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Models available on OpenAI
export const OPENAI_MODELS = {
  fast: 'gpt-4o-mini',        // Cheap and fast
  best: 'gpt-4o',             // Best quality
  turbo: 'gpt-3.5-turbo',     // Legacy fallback
} as const;

// Get API key from localStorage (set at runtime, not bundled)
function getApiKey(): string | null {
  return localStorage.getItem('nulla_openai_key');
}

export function setOpenaiApiKey(key: string) {
  localStorage.setItem('nulla_openai_key', key);
}

export async function callOpenAI(
  messages: Message[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<BrainResponse> {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured - set via setOpenaiApiKey()');
  }

  const model = options.model || OPENAI_MODELS.fast;
  const startTime = performance.now();

  const response = await fetch(OPENAI_API_URL, {
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
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = performance.now() - startTime;

  return {
    content: data.choices[0]?.message?.content || '',
    provider: 'openai',
    model,
    tokensUsed: data.usage?.total_tokens || 0,
    latencyMs,
  };
}

