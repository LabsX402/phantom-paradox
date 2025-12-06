// Groq Provider - Fastest, Primary
import type { Message, BrainResponse } from '../types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Models available on Groq
export const GROQ_MODELS = {
  fast: 'llama-3.1-8b-instant',      // Fastest, simple queries
  balanced: 'llama-3.1-70b-versatile', // Best quality on Groq
  mixtral: 'mixtral-8x7b-32768',      // Good for reasoning
} as const;

// Get API key from localStorage (set at runtime, not bundled)
function getApiKey(): string | null {
  return localStorage.getItem('nulla_groq_key');
}

export function setGroqApiKey(key: string) {
  localStorage.setItem('nulla_groq_key', key);
}

export async function callGroq(
  messages: Message[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<BrainResponse> {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error('GROQ_API_KEY not configured - set via setGroqApiKey()');
  }

  const model = options.model || GROQ_MODELS.fast;
  const startTime = performance.now();

  const response = await fetch(GROQ_API_URL, {
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
    throw new Error(`Groq API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const latencyMs = performance.now() - startTime;

  return {
    content: data.choices[0]?.message?.content || '',
    provider: 'groq',
    model,
    tokensUsed: data.usage?.total_tokens || 0,
    latencyMs,
  };
}

