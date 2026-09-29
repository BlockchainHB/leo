import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Loads `.env` from the project root without overriding variables that are
 * already set, so shell exports and CI secrets always win.
 */
export function loadDotEnv(root: string): string[] {
  const file = join(root, '.env');
  if (!existsSync(file)) return [];
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  const loaded: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined && value) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}

export type ProviderId =
  | 'claude'
  | 'dataforseo'
  | 'firecrawl'
  | 'perplexity'
  | 'openrouter'
  | 'sanity';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  purpose: string;
  env: string[];
  fallback: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'claude',
    label: 'Claude',
    purpose: 'analysis, briefs, writing',
    env: ['ANTHROPIC_API_KEY'],
    fallback: 'Claude Code sign-in, Bedrock, or Vertex credentials',
  },
  {
    id: 'dataforseo',
    label: 'DataForSEO',
    purpose: 'live Google SERP',
    env: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
    fallback: 'Firecrawl search, then Claude web search',
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    purpose: 'competitor scraping',
    env: ['FIRECRAWL_API_KEY'],
    fallback: 'built-in HTML fetch',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    purpose: 'fresh, cited research',
    env: ['PERPLEXITY_API_KEY'],
    fallback: 'Claude web search',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    purpose: 'image generation',
    env: ['OPENROUTER_API_KEY'],
    fallback: 'images skipped',
  },
  {
    id: 'sanity',
    label: 'Sanity',
    purpose: 'CMS publishing',
    env: ['SANITY_API_TOKEN'],
    fallback: 'local markdown',
  },
];

export function hasProvider(id: ProviderId): boolean {
  const info = PROVIDERS.find((p) => p.id === id);
  return !!info && info.env.every((key) => !!process.env[key]);
}

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}
