import { countWords, hostname } from '../core/text';
import type { FetchedPage, SearchResult } from '../providers/types';

export interface PageSummary {
  url: string;
  title: string;
  wordCount: number;
  headings: { level: number; text: string }[];
  hasFaq: boolean;
  listCount: number;
}

/** Deterministic structure analysis. No LLM needed to count headings. */
export function summarizePage(page: FetchedPage): PageSummary {
  const headings = [...page.markdown.matchAll(/^(#{2,4})\s+(.+?)\s*#*$/gm)].map((m) => ({
    level: m[1]?.length ?? 2,
    text: (m[2] ?? '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .trim(),
  }));
  return {
    url: page.url,
    title: page.title,
    wordCount: countWords(page.markdown),
    headings: headings.slice(0, 40),
    hasFaq: headings.some((h) => /\bfaqs?\b|frequently asked/i.test(h.text)),
    listCount: (page.markdown.match(/^\s*(?:[-*]|\d+\.)\s/gm) ?? []).length,
  };
}

/** Pages that look blocked or empty are worse than no data for the brief. */
export function isUsable(summary: PageSummary): boolean {
  return summary.wordCount >= 250 && summary.headings.length >= 2;
}

const SKIP_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'pinterest.com',
  'amazon.com',
  'ebay.com',
];

/** Article-like competitors worth reading, one per domain. */
export function pickCompetitors(
  results: SearchResult[],
  limit: number,
  ownUrl?: string,
): SearchResult[] {
  const own = ownUrl ? hostname(ownUrl) : null;
  const seen = new Set<string>();
  const picked: SearchResult[] = [];
  for (const result of results) {
    const domain = hostname(result.url);
    if (seen.has(domain) || domain === own) continue;
    if (SKIP_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;
    if (/\.(pdf|docx?|xlsx?)$/i.test(result.url)) continue;
    seen.add(domain);
    picked.push(result);
    if (picked.length >= limit) break;
  }
  return picked;
}
