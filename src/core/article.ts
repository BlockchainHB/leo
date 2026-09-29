import { parse, stringify } from 'yaml';
import { countWords } from './text';

export interface ArticleMeta {
  title: string;
  slug: string;
  description: string;
  excerpt: string;
  keyword: string;
  category?: string;
  author?: string;
  date: string;
  heroImage?: { src: string; alt: string };
  sources: { title: string; url: string }[];
}

export interface Article {
  meta: ArticleMeta;
  body: string;
}

export function serializeArticle({ meta, body }: Article): string {
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
  return `---\n${stringify(clean, { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

export function parseArticle(markdown: string): Article {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  if (!match) throw new Error('Article is missing its frontmatter block');
  return {
    meta: parse(match[1] ?? '') as ArticleMeta,
    body: markdown.slice(match[0].length).trim(),
  };
}

/** Removes a leading H1 because the title lives in frontmatter. */
export function stripLeadingH1(body: string): string {
  return body.replace(/^\s*#\s+[^\n]+\n+/, '');
}

export function headings(body: string, level = 2): string[] {
  const pattern = new RegExp(`^${'#'.repeat(level)}\\s+(.+)$`, 'gm');
  return [...body.matchAll(pattern)].map((m) => (m[1] ?? '').trim());
}

/**
 * Inserts an image right after the first paragraph that follows `heading`.
 * Matching is whitespace/case-insensitive so small model drift still lands.
 */
export function insertImageAfterHeading(
  body: string,
  heading: string,
  image: { src: string; alt: string },
): { body: string; inserted: boolean } {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const target = normalize(heading);
  const lines = body.split('\n');
  const index = lines.findIndex((line) => {
    const m = /^#{2,3}\s+(.+)$/.exec(line);
    return !!m && normalize(m[1] ?? '') === target;
  });
  if (index === -1) return { body, inserted: false };

  let insertAt = index + 1;
  while (insertAt < lines.length && lines[insertAt]?.trim() === '') insertAt++;
  while (
    insertAt < lines.length &&
    lines[insertAt]?.trim() !== '' &&
    !/^#/.test(lines[insertAt] ?? '')
  )
    insertAt++;

  const alt = image.alt.replace(/[[\]]/g, '');
  lines.splice(insertAt, 0, '', `![${alt}](${image.src})`);
  return { body: lines.join('\n'), inserted: true };
}

export interface LintResult {
  words: number;
  warnings: string[];
}

export function lintArticle(
  body: string,
  options: { targetWords?: number; avoid: string[] },
): LintResult {
  const warnings: string[] = [];
  const words = countWords(body);

  if (options.targetWords && words < options.targetWords * 0.8) {
    warnings.push(`${words} words is well under the ${options.targetWords}-word target`);
  }
  const avoidsEmDash = options.avoid.some((phrase) => /em.?dash/i.test(phrase));
  const emDashes = (body.match(/—/g) ?? []).length;
  if (avoidsEmDash && emDashes > 0) warnings.push(`${emDashes} em dash(es) slipped through`);

  const lower = body.toLowerCase();
  for (const phrase of options.avoid) {
    if (/em.?dash/i.test(phrase)) continue;
    if (lower.includes(phrase.toLowerCase())) warnings.push(`uses avoided phrase “${phrase}”`);
  }
  if (!/\]\(https?:\/\//.test(body)) warnings.push('no outbound source links');
  return { words, warnings };
}
