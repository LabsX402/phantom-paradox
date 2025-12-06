// Nulla Brain - Smart Provider Router
// Rotates between providers based on query complexity and budget

import type { Message, BrainResponse, Provider, QueryComplexity } from './types';
import { callGroq, GROQ_MODELS } from './providers/groq';
import { callXAI, XAI_MODELS } from './providers/xai';
import { callOpenAI, OPENAI_MODELS } from './providers/openai';

// Usage tracking (persisted to localStorage)
interface DailyUsage {
  date: string;
  groq: { tokens: number; cost: number };
  xai: { tokens: number; cost: number };
  openai: { tokens: number; cost: number };
}

// Cost per 1K tokens (approximate)
const COSTS = {
  groq: 0.0001,    // Nearly free
  xai: 0.002,      // ~$2/million
  openai: 0.003,   // ~$3/million for gpt-4o-mini
};

// Daily limits (in USD) - can be configured at runtime
const DEFAULT_LIMITS = {
  groq: 0.30,
  xai: 0.10,
  openai: 0.15,
};

function getLimits() {
  const stored = localStorage.getItem('nulla_brain_limits');
  if (stored) {
    try {
      return { ...DEFAULT_LIMITS, ...JSON.parse(stored) };
    } catch {
      return DEFAULT_LIMITS;
    }
  }
  return DEFAULT_LIMITS;
}

export function setLimits(limits: Partial<typeof DEFAULT_LIMITS>) {
  const current = getLimits();
  localStorage.setItem('nulla_brain_limits', JSON.stringify({ ...current, ...limits }));
}

const LIMITS = getLimits();

// Get today's usage from localStorage
function getTodayUsage(): DailyUsage {
  const today = new Date().toISOString().split('T')[0];
  const stored = localStorage.getItem('nulla_brain_usage');
  
  if (stored) {
    const usage = JSON.parse(stored) as DailyUsage;
    if (usage.date === today) return usage;
  }
  
  // New day, reset
  return {
    date: today,
    groq: { tokens: 0, cost: 0 },
    xai: { tokens: 0, cost: 0 },
    openai: { tokens: 0, cost: 0 },
  };
}

// Save usage
function saveUsage(usage: DailyUsage) {
  localStorage.setItem('nulla_brain_usage', JSON.stringify(usage));
}

// Update usage after a call
function trackUsage(provider: Provider, tokens: number) {
  const usage = getTodayUsage();
  const cost = (tokens / 1000) * COSTS[provider as keyof typeof COSTS];
  
  if (provider in usage) {
    (usage as any)[provider].tokens += tokens;
    (usage as any)[provider].cost += cost;
  }
  
  saveUsage(usage);
  console.log(`[Brain] ${provider}: ${tokens} tokens, $${cost.toFixed(4)} today`);
}

// Check if provider is within budget
function isWithinBudget(provider: Provider): boolean {
  const usage = getTodayUsage();
  const limit = LIMITS[provider as keyof typeof LIMITS];
  const current = (usage as any)[provider]?.cost || 0;
  return current < limit;
}

// Classify query complexity based on length and keywords
function classifyQuery(message: string): QueryComplexity {
  const lower = message.toLowerCase();
  
  // Complex: long, reasoning, creative
  if (message.length > 500) return 'complex';
  if (lower.includes('explain') && lower.includes('why')) return 'complex';
  if (lower.includes('write') || lower.includes('create') || lower.includes('story')) return 'complex';
  if (lower.includes('analyze') || lower.includes('compare')) return 'complex';
  
  // Medium: moderate reasoning
  if (message.length > 200) return 'medium';
  if (lower.includes('how') || lower.includes('what if')) return 'medium';
  if (lower.includes('help me') || lower.includes('suggest')) return 'medium';
  
  // Simple: short, basic
  return 'simple';
}

// Select best provider for query
function selectProvider(complexity: QueryComplexity): Provider {
  // Priority based on complexity
  const priority: Record<QueryComplexity, Provider[]> = {
    simple: ['groq', 'xai', 'openai'],   // Groq first (fastest, cheapest)
    medium: ['xai', 'groq', 'openai'],   // xAI first (good reasoning)
    complex: ['openai', 'xai', 'groq'],  // OpenAI first (best quality)
  };
  
  // Find first provider within budget
  for (const provider of priority[complexity]) {
    if (isWithinBudget(provider)) {
      return provider;
    }
  }
  
  // All over budget, use groq anyway (it's nearly free)
  console.warn('[Brain] All providers over daily budget, defaulting to Groq');
  return 'groq';
}

// Get model for provider and complexity
function getModel(provider: Provider, complexity: QueryComplexity): string {
  switch (provider) {
    case 'groq':
      return complexity === 'complex' ? GROQ_MODELS.balanced : GROQ_MODELS.fast;
    case 'xai':
      return XAI_MODELS.grok;
    case 'openai':
      return complexity === 'complex' ? OPENAI_MODELS.best : OPENAI_MODELS.fast;
    default:
      return GROQ_MODELS.fast;
  }
}

// Main router function
export async function routeQuery(
  messages: Message[],
  options: {
    forceProvider?: Provider;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<BrainResponse> {
  // Get last user message for classification
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const complexity = lastUserMessage 
    ? classifyQuery(lastUserMessage.content) 
    : 'simple';
  
  // Select provider
  const provider = options.forceProvider || selectProvider(complexity);
  const model = getModel(provider, complexity);
  
  console.log(`[Brain] Routing: ${complexity} query → ${provider} (${model})`);
  
  try {
    let response: BrainResponse;
    
    switch (provider) {
      case 'groq':
        response = await callGroq(messages, { model, ...options });
        break;
      case 'xai':
        response = await callXAI(messages, { model, ...options });
        break;
      case 'openai':
        response = await callOpenAI(messages, { model, ...options });
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
    
    // Track usage
    trackUsage(provider, response.tokensUsed);
    
    return response;
    
  } catch (error) {
    console.error(`[Brain] ${provider} failed:`, error);
    
    // Fallback to next provider
    const fallbackOrder: Provider[] = ['groq', 'xai', 'openai'];
    const currentIndex = fallbackOrder.indexOf(provider);
    
    for (let i = currentIndex + 1; i < fallbackOrder.length; i++) {
      const fallback = fallbackOrder[i];
      console.log(`[Brain] Falling back to ${fallback}...`);
      
      try {
        const fallbackModel = getModel(fallback, complexity);
        let response: BrainResponse;
        
        switch (fallback) {
          case 'groq':
            response = await callGroq(messages, { model: fallbackModel, ...options });
            break;
          case 'xai':
            response = await callXAI(messages, { model: fallbackModel, ...options });
            break;
          case 'openai':
            response = await callOpenAI(messages, { model: fallbackModel, ...options });
            break;
          default:
            continue;
        }
        
        trackUsage(fallback, response.tokensUsed);
        return response;
        
      } catch (fallbackError) {
        console.error(`[Brain] Fallback ${fallback} also failed:`, fallbackError);
      }
    }
    
    // All failed
    throw new Error('All LLM providers failed');
  }
}

// Get current usage stats
export function getUsageStats() {
  const usage = getTodayUsage();
  return {
    ...usage,
    limits: LIMITS,
    remaining: {
      groq: Math.max(0, LIMITS.groq - usage.groq.cost),
      xai: Math.max(0, LIMITS.xai - usage.xai.cost),
      openai: Math.max(0, LIMITS.openai - usage.openai.cost),
    },
  };
}

