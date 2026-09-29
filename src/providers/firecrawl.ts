import { requireEnv } from '../core/env';
import { requestJson } from '../core/http';
import { hostname } from '../core/text';
import type { FetchedPage, SearchResult } from './types';

const API = 'https://api.firecrawl.dev/v2';

function headers() {
  return {
    Authorization: `Bearer ${requireEnv('FIRECRAWL_API_KEY')}`,
    'Content-Type': 'application/json',
  };
}

interface ScrapeResponse {
  success: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: { title?: string; description?: string; url?: string; statusCode?: number };
  };
}

export async function firecrawlScrape(url: string, signal?: AbortSignal): Promise<FetchedPage> {
  const body = await requestJson<ScrapeResponse>(`${API}/scrape`, {
    service: 'Firecrawl',
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    timeoutMs: 90_000,
    signal,
  });
  const data = body.data;
  if (!body.success || !data?.markdown) {
    throw new Error(`Firecrawl could not scrape ${url}${body.error ? `: ${body.error}` : ''}`);
  }
  const status = data.metadata?.statusCode;
  if (status && status >= 400) throw new Error(`${url} returned ${status}`);
  return {
    url: data.metadata?.url ?? url,
    title: data.metadata?.title ?? '',
    description: data.metadata?.description ?? '',
    markdown: data.markdown,
    source: 'firecrawl',
  };
}

interface SearchResponse {
  success: boolean;
  data?: { web?: { url: string; title?: string; description?: string }[] };
}

export async function firecrawlSearch(
  query: string,
  options: { limit?: number; location?: string; signal?: AbortSignal } = {},
): Promise<SearchResult[]> {
  const body = await requestJson<SearchResponse>(`${API}/search`, {
    service: 'Firecrawl',
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      query,
      limit: options.limit ?? 10,
      location: options.location,
      sources: [{ type: 'web' }],
    }),
    signal: options.signal,
  });
  return (body.data?.web ?? []).map((item, index) => ({
    position: index + 1,
    url: item.url,
    title: item.title ?? '',
    description: item.description ?? '',
    domain: hostname(item.url),
  }));
}
