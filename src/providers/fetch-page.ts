import { request } from '../core/http';
import type { FetchedPage } from './types';

const USER_AGENT =
  'Mozilla/5.0 (compatible; LeoBot/2.0; +https://github.com/BlockchainHB/leo) content research';

/**
 * Zero-dependency fallback when Firecrawl isn't configured. It won't beat a
 * headless browser on JS-heavy sites, but most articles are server-rendered
 * and this is plenty to read their structure.
 */
export async function fetchPage(url: string, signal?: AbortSignal): Promise<FetchedPage> {
  const response = await request(url, {
    service: new URL(url).hostname,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    timeoutMs: 30_000,
    retries: 1,
    signal,
  });
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('html')) throw new Error(`${url} is not an HTML page (${type})`);
  const html = await response.text();
  return {
    url: response.url || url,
    title: decode(match(html, /<title[^>]*>([\s\S]*?)<\/title>/i)),
    description: decode(
      match(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) ||
        match(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    ),
    markdown: htmlToMarkdown(html),
    source: 'fetch',
  };
}

function match(html: string, pattern: RegExp): string {
  return pattern.exec(html)?.[1]?.trim() ?? '';
}

export function htmlToMarkdown(html: string): string {
  const main =
    match(html, /<article[^>]*>([\s\S]*?)<\/article>/i) ||
    match(html, /<main[^>]*>([\s\S]*?)<\/main>/i) ||
    match(html, /<body[^>]*>([\s\S]*?)<\/body>/i) ||
    html;

  return decode(
    main
      .replace(
        /<(script|style|noscript|svg|nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi,
        '',
      )
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(
        /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
        (_, level: string, text: string) => `\n\n${'#'.repeat(Number(level))} ${strip(text)}\n\n`,
      )
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text: string) => `\n- ${strip(text)}`)
      .replace(/<(p|div|section|tr|br|blockquote)[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity);
}
