import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  headings,
  insertImageAfterHeading,
  lintArticle,
  parseArticle,
  serializeArticle,
  stripLeadingH1,
} from '../src/core/article';
import { ConfigError, parseConfig } from '../src/core/config';
import type { Project } from '../src/core/project';
import { Queue } from '../src/core/queue';
import { countWords, formatDuration, formatUsd, slugify } from '../src/core/text';

const minimal = {
  blog: { name: 'Acme', niche: 'pricing', audience: 'founders' },
};

describe('config', () => {
  it('fills nested defaults from a minimal config', () => {
    const config = parseConfig(minimal);
    expect(config.publish).toEqual({ provider: 'local', dir: 'content/posts' });
    expect(config.writing.includeFaq).toBe(true);
    expect(config.models.writer).toBe('claude-opus-5-5');
    expect(config.images.enabled).toBe(true);
    expect(config.budgetUsd).toBe(3);
  });

  it('reports every issue with its path', () => {
    try {
      parseConfig({ blog: { name: '' }, publish: { provider: 'sanity' } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues.join('\n');
      expect(issues).toContain('blog.name');
      expect(issues).toContain('blog.niche');
      expect(issues).toContain('publish.projectId');
    }
  });
});

describe('text helpers', () => {
  it('slugifies keywords', () => {
    expect(slugify('How to Price a SaaS Product?')).toBe('how-to-price-a-saas-product');
    expect(slugify('Café & Crème')).toBe('cafe-and-creme');
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('a '.repeat(100)).length).toBeLessThanOrEqual(80);
  });

  it('counts words without markdown noise', () => {
    expect(
      countWords('## Heading\n\nSome [linked text](https://x.com) here.\n\n![alt](a.png)'),
    ).toBe(5);
  });

  it('formats money and time', () => {
    expect(formatUsd(0.004)).toBe('<$0.01');
    expect(formatUsd(1.234)).toBe('$1.23');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(9_400)).toBe('9s');
  });
});

describe('article', () => {
  const body =
    '## Why it matters\n\nFirst paragraph.\nStill first.\n\nSecond.\n\n## FAQ\n\n### Q?\n\nA.';

  it('round-trips frontmatter', () => {
    const article = {
      meta: {
        title: 'T: a “quoted” title',
        slug: 't',
        description: 'd',
        excerpt: 'e',
        keyword: 'k',
        date: '2026-09-28',
        sources: [{ title: 'S', url: 'https://s.com' }],
      },
      body,
    };
    expect(parseArticle(serializeArticle(article))).toEqual(article);
  });

  it('inserts images after the first paragraph under a fuzzy-matched heading', () => {
    const { body: out, inserted } = insertImageAfterHeading(body, 'why IT matters!', {
      src: 'images/a.webp',
      alt: 'An [alt]',
    });
    expect(inserted).toBe(true);
    expect(out).toContain('Still first.\n\n![An alt](images/a.webp)\n\nSecond.');
    expect(insertImageAfterHeading(body, 'Nope', { src: 'x', alt: 'y' }).inserted).toBe(false);
  });

  it('extracts headings and strips a leading H1', () => {
    expect(headings(body)).toEqual(['Why it matters', 'FAQ']);
    expect(stripLeadingH1('# Title\n\nText')).toBe('Text');
  });

  it('lints for length, em dashes, avoided phrases and sources', () => {
    const { warnings } = lintArticle('Short — text. Let us delve.', {
      targetWords: 1000,
      avoid: ['em dashes', 'delve'],
    });
    expect(warnings).toHaveLength(4);
  });
});

describe('queue', () => {
  const project = { stateDir: mkdtempSync(join(tmpdir(), 'leo-q-')) } as Project;

  it('dedupes by slug and walks items in order', () => {
    const queue = new Queue(project);
    const { added, skipped } = queue.add(['SEO basics', 'seo  basics', 'Link building', ' ']);
    expect(added.map((i) => i.keyword)).toEqual(['SEO basics', 'Link building']);
    expect(skipped).toEqual(['seo  basics']);

    const first = queue.next();
    expect(first?.keyword).toBe('SEO basics');
    queue.set(first?.id ?? 0, 'done');
    expect(new Queue(project).next()?.keyword).toBe('Link building');
    expect(queue.clear('done')).toBe(1);
  });
});

describe('claude isolation', () => {
  it('never inherits the user’s Claude Code connectors, skills, hooks or memory', async () => {
    const { isolatedOptions } = await import('../src/pipeline/claude');
    const options = isolatedOptions();
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.settings).toMatchObject({
      disableClaudeAiConnectors: true,
      syncClaudeAiSkills: false,
      syncClaudeAiPlugins: false,
      disableAllHooks: true,
      autoMemoryEnabled: false,
    });
  });
});
