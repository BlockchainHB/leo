import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArticle } from '../src/core/article';
import { parseConfig } from '../src/core/config';
import type { PipelineEvent } from '../src/core/events';
import type { Project } from '../src/core/project';
import { RunPanel } from '../src/ui/components';
import { initialRunView, reduceRun } from '../src/ui/run-state';

const claude = vi.hoisted(() => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock('../src/pipeline/claude', () => claude);

const { writeArticle } = await import('../src/pipeline/run');
const { publishRun } = await import('../src/pipeline/publish');

const brief = {
  title: 'SaaS Pricing: A Practical Guide',
  searchIntent: 'informational',
  angle: 'Price on value metrics, not costs',
  targetWords: 120,
  description: 'How to price a SaaS product using value metrics, tiers and real data.',
  excerpt: 'Pricing is a product decision. Here is how to make it.',
  outline: [
    {
      heading: 'Start with the value metric',
      points: ['what it is'],
      facts: [{ fact: 'X', url: 'https://src.com/a' }],
    },
    { heading: 'Design three tiers', points: ['good/better/best'], facts: [] },
    { heading: 'Test and iterate', points: ['experiments'], facts: [] },
  ],
  gaps: ['usage-based hybrids'],
  faqs: ['How often should I change prices?'],
  internalLinks: [],
};

const draft = `# SaaS Pricing\n\nHook paragraph with a [source](https://src.com/a).\n\n## Start with the value metric\n\n${'Value words here. '.repeat(20)}\n\n## Design three tiers\n\nTiers.\n\n## Test and iterate\n\nIterate.`;

function makeProject(): Project {
  const root = mkdtempSync(join(tmpdir(), 'leo-run-'));
  const stateDir = join(root, '.leo');
  const runsDir = join(stateDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const config = parseConfig({
    blog: { name: 'Acme', niche: 'SaaS', audience: 'founders', url: 'https://acme.com' },
    images: { enabled: false },
  });
  return { root, configPath: join(root, 'leo.config.json'), config, stateDir, runsDir };
}

beforeEach(() => {
  for (const key of [
    'DATAFORSEO_LOGIN',
    'FIRECRAWL_API_KEY',
    'PERPLEXITY_API_KEY',
    'OPENROUTER_API_KEY',
  ]) {
    vi.stubEnv(key, '');
  }
  claude.generateObject.mockReset();
  claude.generateText.mockReset();
  claude.generateObject.mockImplementation(
    async (options: { prompt: string; tools?: string[] }) => {
      if (options.tools?.includes('WebFetch')) {
        return {
          output: {
            notes: [
              { query: 'q', answer: 'a', sources: [{ url: 'https://src.com/a', title: 'Src' }] },
            ],
          },
          costUsd: 0.1,
        };
      }
      if (options.tools?.includes('WebSearch')) {
        return {
          output: {
            results: [
              { url: 'https://acme.com/own', title: 'Ours', description: '' },
              { url: 'https://rival.com/pricing', title: 'Rival', description: 'd' },
            ],
          },
          costUsd: 0.02,
        };
      }
      return { output: brief, costUsd: 0.2 };
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          `<article><h2>Intro</h2><p>${'text '.repeat(400)}</p><h2>Tiers</h2></article>`,
          {
            headers: { 'content-type': 'text/html' },
          },
        ),
    ),
  );
});

describe('writeArticle', () => {
  it('runs every stage with fallbacks and assembles a valid article', async () => {
    claude.generateText.mockImplementation(async (options: { onText?: (t: string) => void }) => {
      options.onText?.('Hook ');
      return { output: draft, costUsd: 0.5 };
    });
    const project = makeProject();
    const events: PipelineEvent[] = [];
    const result = await writeArticle(project, { keyword: 'how to price saas' }, (e) =>
      events.push(e),
    );

    expect(result.slug).toBe('how-to-price-saas');
    expect(result.costUsd).toBeCloseTo(0.82);
    const article = parseArticle(readFileSync(result.articlePath, 'utf8'));
    expect(article.meta.title).toBe(brief.title);
    expect(article.meta.sources).toEqual([{ url: 'https://src.com/a', title: 'Src' }]);
    expect(article.body.startsWith('Hook paragraph')).toBe(true); // H1 stripped

    // Competitor scraping skipped our own domain and used the built-in fetcher.
    const competitors = JSON.parse(
      readFileSync(join(project.runsDir, result.slug, 'competitors.json'), 'utf8'),
    );
    expect(competitors.pages.map((p: { url: string }) => p.url)).toEqual([
      'https://rival.com/pricing',
    ]);

    const types = events.map((e) =>
      e.type.startsWith('stage') ? `${e.type}:${'stage' in e ? e.stage : ''}` : e.type,
    );
    expect(types).toContain('stage:skip:images');
    expect(types).toContain('draft:delta');
    expect(types.at(-1)).toBe('run:done');

    const published = await publishRun(project, result.slug);
    expect(existsSync(join(project.root, 'content/posts', result.slug, 'index.md'))).toBe(true);
    expect(published.provider).toBe('local');
  });

  it('resumes from the failed stage without paying for earlier ones again', async () => {
    const project = makeProject();
    claude.generateText.mockRejectedValueOnce(
      Object.assign(new Error('overloaded'), { costUsd: 0.05 }),
    );
    await expect(writeArticle(project, { keyword: 'resume me' }, () => {})).rejects.toThrow(
      'overloaded',
    );
    const callsAfterFailure = claude.generateObject.mock.calls.length;

    claude.generateText.mockResolvedValueOnce({ output: draft, costUsd: 0.5 });
    const events: PipelineEvent[] = [];
    await writeArticle(project, { keyword: 'resume me' }, (e) => events.push(e));

    expect(claude.generateObject.mock.calls.length).toBe(callsAfterFailure);
    expect(events[0]).toMatchObject({ type: 'run:start', resumed: true });
    const cached = events.filter((e) => e.type === 'stage:done' && e.summary.endsWith('cached'));
    expect(cached.map((e) => 'stage' in e && e.stage)).toEqual([
      'serp',
      'research',
      'competitors',
      'brief',
    ]);
  });

  it('stops before spending past the budget', async () => {
    const project = makeProject();
    claude.generateObject.mockResolvedValue({ output: { results: [] }, costUsd: 5 });
    await expect(
      writeArticle(project, { keyword: 'pricey', budgetUsd: 1 }, () => {}),
    ).rejects.toThrow(/Budget/);
  });
});

describe('run view', () => {
  it('reduces events and renders the stage list', () => {
    const events: PipelineEvent[] = [
      { type: 'run:start', keyword: 'saas pricing', slug: 'saas-pricing', resumed: false },
      {
        type: 'stage:done',
        stage: 'serp',
        summary: '10 results via DataForSEO',
        durationMs: 2000,
        costUsd: 0,
      },
      { type: 'stage:start', stage: 'research' },
      { type: 'stage:progress', stage: 'research', message: 'search 2: saas pricing models' },
      { type: 'stage:skip', stage: 'images', reason: 'disabled' },
      { type: 'cost', totalUsd: 0.42 },
    ];
    const view = events.reduce((s, e) => reduceRun(s, e, 0), initialRunView());
    expect(view.stages.research.status).toBe('running');

    const { lastFrame, unmount } = render(createElement(RunPanel, { run: view, width: 100 }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('“saas pricing”');
    expect(frame).toContain('10 results via DataForSEO');
    expect(frame).toContain('search 2: saas pricing models');
    expect(frame).toContain('$0.42');
    unmount();
  });
});
