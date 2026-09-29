import { requireEnv } from '../core/env';
import { requestJson } from '../core/http';
import type { ResearchNote } from './types';

interface AgentResponse {
  output?: Array<
    | {
        type: 'message';
        content?: {
          type: string;
          text?: string;
          annotations?: { type: string; url?: string; title?: string }[];
        }[];
      }
    | { type: 'search_results'; results?: { url: string; title?: string }[] }
    | { type: string }
  >;
}

/**
 * Perplexity Agent API (`/v1/agent`). Sonar chat completions were retired on
 * 2026-09-27, so this is the supported way to get cited web answers.
 */
export async function perplexityResearch(
  query: string,
  options: { recency?: 'day' | 'week' | 'month' | 'year'; signal?: AbortSignal } = {},
): Promise<ResearchNote> {
  const body = await requestJson<AgentResponse>('https://api.perplexity.ai/v1/agent', {
    service: 'Perplexity',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('PERPLEXITY_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      preset: 'low',
      input: query,
      tools: [
        { type: 'web_search', max_results: 8, search_recency_filter: options.recency ?? 'year' },
      ],
    }),
    timeoutMs: 120_000,
    signal: options.signal,
  });

  let answer = '';
  const sources = new Map<string, string>();
  for (const item of body.output ?? []) {
    if (item.type === 'message' && 'content' in item) {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text) answer += part.text;
        for (const note of part.annotations ?? []) {
          if (note.url && !sources.has(note.url)) sources.set(note.url, note.title ?? note.url);
        }
      }
    } else if (item.type === 'search_results' && 'results' in item) {
      for (const result of item.results ?? []) {
        if (!sources.has(result.url)) sources.set(result.url, result.title ?? result.url);
      }
    }
  }

  if (!answer) throw new Error('Perplexity returned no answer');
  return {
    query,
    answer: answer.trim(),
    sources: [...sources].map(([url, title]) => ({ url, title })),
  };
}
