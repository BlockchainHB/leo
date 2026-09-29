import { requireEnv } from '../core/env';
import { requestJson } from '../core/http';
import { hostname } from '../core/text';
import type { SearchResult } from './types';

interface SerpItem {
  type: string;
  rank_group?: number;
  url?: string;
  title?: string;
  description?: string;
  domain?: string;
}

interface SerpResponse {
  status_code: number;
  status_message: string;
  tasks?: { status_code: number; status_message: string; result?: { items?: SerpItem[] }[] }[];
}

/** Live Google organic results via DataForSEO's `live/advanced` endpoint. */
export async function dataForSeoSerp(
  keyword: string,
  options: { location: string; language: string; depth?: number; signal?: AbortSignal },
): Promise<SearchResult[]> {
  const auth = Buffer.from(
    `${requireEnv('DATAFORSEO_LOGIN')}:${requireEnv('DATAFORSEO_PASSWORD')}`,
  ).toString('base64');

  const body = await requestJson<SerpResponse>(
    'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
    {
      service: 'DataForSEO',
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          keyword,
          location_name: options.location,
          language_code: options.language,
          device: 'desktop',
          depth: options.depth ?? 10,
        },
      ]),
      signal: options.signal,
    },
  );

  // DataForSEO reports errors inside a 200 response.
  const task = body.tasks?.[0];
  if (task?.status_code !== 20000) {
    throw new Error(`DataForSEO: ${task?.status_message ?? body.status_message}`);
  }

  return (task.result?.[0]?.items ?? [])
    .filter((item) => item.type === 'organic' && item.url)
    .map((item, index) => ({
      position: item.rank_group ?? index + 1,
      url: item.url as string,
      title: item.title ?? '',
      description: item.description ?? '',
      domain: item.domain ?? hostname(item.url as string),
    }));
}
