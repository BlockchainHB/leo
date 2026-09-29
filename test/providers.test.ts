import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapLimit, request } from '../src/core/http';
import { isUsable, pickCompetitors, summarizePage } from '../src/pipeline/analyze';
import { htmlToMarkdown } from '../src/providers/fetch-page';
import { perplexityResearch } from '../src/providers/perplexity';
import { markdownToPortableText } from '../src/providers/sanity';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('http', () => {
  it('retries retryable statuses, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await request('https://x.test', { service: 'X' });
    expect(await response.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('https://x.test', { service: 'X' })).rejects.toThrow(
      'X returned 401: nope',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('limits concurrency and keeps order', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });
});

describe('perplexity', () => {
  it('parses Agent API text, citations and search results', async () => {
    vi.stubEnv('PERPLEXITY_API_KEY', 'test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: 'Answer.',
                  annotations: [{ type: 'url_citation', url: 'https://a.com', title: 'A' }],
                },
              ],
            },
            {
              type: 'search_results',
              results: [{ url: 'https://a.com' }, { url: 'https://b.com', title: 'B' }],
            },
          ],
        }),
      ),
    );
    const note = await perplexityResearch('q');
    expect(note).toEqual({
      query: 'q',
      answer: 'Answer.',
      sources: [
        { url: 'https://a.com', title: 'A' },
        { url: 'https://b.com', title: 'B' },
      ],
    });
  });
});

describe('page analysis', () => {
  const html = `<html><head><title>Guide &amp; Tips</title></head><body>
    <nav><a>Home</a></nav>
    <article><h1>Guide</h1><p>${'word '.repeat(300)}</p>
    <h2>Getting <em>started</em></h2><ul><li>One</li><li>Two</li></ul>
    <h2>Frequently Asked Questions</h2><h3>Is it free?</h3><p>Yes.</p></article>
    <script>track()</script></body></html>`;

  it('turns HTML into structured markdown without chrome or scripts', () => {
    const md = htmlToMarkdown(html);
    expect(md).toContain('## Getting started');
    expect(md).toContain('- One');
    expect(md).not.toMatch(/Home|track/);
  });

  it('summarizes structure deterministically', () => {
    const summary = summarizePage({
      url: 'u',
      title: 't',
      description: '',
      markdown: htmlToMarkdown(html),
      source: 'fetch',
    });
    expect(summary.headings.map((h) => h.text)).toEqual([
      'Getting started',
      'Frequently Asked Questions',
      'Is it free?',
    ]);
    expect(summary.hasFaq).toBe(true);
    expect(summary.listCount).toBe(2);
    expect(isUsable(summary)).toBe(true);
  });

  it('does not flag pages as broken just for mentioning "404"', () => {
    const summary = summarizePage({
      url: 'u',
      title: 't',
      description: '',
      markdown: `## Fixing 404 errors\n\n${'text '.repeat(300)}\n\n## Page not found pages`,
      source: 'fetch',
    });
    expect(isUsable(summary)).toBe(true);
  });

  it('picks one article-like result per domain, skipping video and own site', () => {
    const r = (url: string) => ({ position: 0, url, title: '', description: '', domain: '' });
    const picked = pickCompetitors(
      [
        r('https://youtube.com/watch'),
        r('https://a.com/1'),
        r('https://www.a.com/2'),
        r('https://me.com/x'),
        r('https://b.com/doc.pdf'),
        r('https://c.com/'),
      ],
      5,
      'https://me.com',
    );
    expect(picked.map((p) => p.url)).toEqual(['https://a.com/1', 'https://c.com/']);
  });
});

describe('markdown → portable text', () => {
  it('handles headings, nested marks, links, lists and images', () => {
    const blocks = markdownToPortableText(
      '## Title\n\nSome **bold _and em_** with a [link](https://x.com).\n\n- one\n- two\n  1. nested\n\n![Alt](images/a.webp)\n\n```ts\nconst a = 1;\n```',
      (src, alt) => ({ _type: 'image', _key: 'k', src, alt }),
    ) as Array<Record<string, unknown>>;

    expect(blocks.map((b) => b.style ?? b._type)).toEqual([
      'h2',
      'normal',
      'normal',
      'normal',
      'normal',
      'image',
      'code',
    ]);

    const paragraph = blocks[1] as {
      children: { text: string; marks: string[] }[];
      markDefs: { _key: string; href: string }[];
    };
    expect(paragraph.children.find((c) => c.text === 'and em')?.marks).toEqual(['strong', 'em']);
    const linkDef = paragraph.markDefs[0];
    expect(linkDef?.href).toBe('https://x.com');
    expect(paragraph.children.find((c) => c.text === 'link')?.marks).toEqual([linkDef?._key]);

    expect(blocks[4]).toMatchObject({ listItem: 'number', level: 2 });
    expect(blocks[5]).toMatchObject({ src: 'images/a.webp', alt: 'Alt' });
    expect(blocks[6]).toMatchObject({ code: 'const a = 1;', language: 'ts' });
  });
});
