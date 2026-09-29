import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  type Article,
  headings,
  insertImageAfterHeading,
  lintArticle,
  serializeArticle,
  stripLeadingH1,
} from '../core/article';
import { hasProvider } from '../core/env';
import type { Emit, StageId } from '../core/events';
import { mapLimit } from '../core/http';
import type { Project } from '../core/project';
import { Run } from '../core/runs';
import { formatUsd, hostname, slugify } from '../core/text';
import { dataForSeoSerp } from '../providers/dataforseo';
import { fetchPage } from '../providers/fetch-page';
import { firecrawlScrape, firecrawlSearch } from '../providers/firecrawl';
import { generateImage } from '../providers/openrouter';
import { perplexityResearch } from '../providers/perplexity';
import type { FetchedPage, ResearchNote, SearchResult } from '../providers/types';
import { isUsable, type PageSummary, pickCompetitors, summarizePage } from './analyze';
import { generateObject, generateText } from './claude';
import * as prompts from './prompts';
import { type Brief, BriefSchema, ImagePlanSchema, ResearchSchema } from './schemas';

export interface WriteOptions {
  keyword: string;
  fresh?: boolean;
  images?: boolean;
  budgetUsd?: number;
  signal?: AbortSignal;
}

export interface WriteResult {
  slug: string;
  articlePath: string;
  title: string;
  words: number;
  costUsd: number;
  warnings: string[];
}

export class PipelineError extends Error {
  constructor(
    readonly stage: StageId,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

interface SerpArtifact {
  source: string;
  results: SearchResult[];
}
interface ResearchArtifact {
  source: string;
  notes: ResearchNote[];
}
interface CompetitorArtifact {
  pages: PageSummary[];
  failed: { url: string; error: string }[];
}
interface ImagesArtifact {
  hero?: { src: string; alt: string };
  sections: { heading: string; src: string; alt: string }[];
}

interface StageOutcome<T> {
  value: T;
  summary: string;
  costUsd?: number;
}

/**
 * The writing pipeline. Where the path is known it runs as plain code:
 * search, scrape, count, assemble. Claude is called only for the steps that
 * need judgment: brief, draft, image direction, and research when no
 * research API is configured. Each stage checkpoints to disk, so a failed or
 * cancelled run resumes where it stopped.
 */
export async function writeArticle(
  project: Project,
  options: WriteOptions,
  emit: Emit,
): Promise<WriteResult> {
  const { config } = project;
  const keyword = options.keyword.trim();
  const slug = slugify(keyword);
  const run = Run.open(project, keyword, slug, options.fresh);
  const budget = options.budgetUsd ?? config.budgetUsd;
  const signal = options.signal;
  const started = Date.now();
  const remaining = () => budget - run.record.costUsd;

  emit({ type: 'run:start', keyword, slug, resumed: run.isResumed });

  async function stage<T>(
    id: StageId,
    artifact: string,
    fn: () => Promise<StageOutcome<T>>,
    load: () => T,
  ): Promise<T> {
    if (run.isCached(id, artifact)) {
      const record = run.record.stages[id];
      emit({
        type: 'stage:done',
        stage: id,
        summary: `${record.summary ?? 'done'} · cached`,
        durationMs: 0,
        costUsd: 0,
      });
      return load();
    }
    signal?.throwIfAborted();
    if (remaining() <= 0) {
      throw new PipelineError(
        id,
        `Budget of ${formatUsd(budget)} used up. Raise it with --budget.`,
      );
    }
    const t0 = Date.now();
    emit({ type: 'stage:start', stage: id });
    run.update(id, { status: 'running', error: undefined, costUsd: 0 });
    try {
      const outcome = await fn();
      const durationMs = Date.now() - t0;
      run.update(id, {
        status: 'done',
        summary: outcome.summary,
        costUsd: outcome.costUsd ?? 0,
        durationMs,
      });
      emit({
        type: 'stage:done',
        stage: id,
        summary: outcome.summary,
        durationMs,
        costUsd: outcome.costUsd ?? 0,
      });
      emit({ type: 'cost', totalUsd: run.record.costUsd });
      return outcome.value;
    } catch (error) {
      const message = signal?.aborted ? 'Cancelled' : (error as Error).message;
      const spent = (error as { costUsd?: number }).costUsd ?? 0;
      run.update(id, { status: 'failed', error: message, costUsd: spent });
      emit({ type: 'stage:error', stage: id, error: message });
      throw error instanceof PipelineError ? error : new PipelineError(id, message);
    }
  }

  const progress = (id: StageId) => (message: string) =>
    emit({ type: 'stage:progress', stage: id, message });

  try {
    // 1. Search results ────────────────────────────────────────────────────
    const serp = await stage<SerpArtifact>(
      'serp',
      'serp.json',
      async () => {
        const value = await searchResults(keyword, project, progress('serp'), remaining(), signal);
        run.writeJson('serp.json', value.artifact);
        return {
          value: value.artifact,
          summary: `${value.artifact.results.length} results via ${value.artifact.source}`,
          costUsd: value.costUsd,
        };
      },
      () => run.readJson('serp.json'),
    );

    // 2 + 3. Research and competitor reading run in parallel ───────────────
    const [research, competitors] = await Promise.all([
      stage<ResearchArtifact>(
        'research',
        'research.json',
        async () => {
          const value = await researchTopic(
            keyword,
            project,
            progress('research'),
            remaining() / 2,
            signal,
          );
          run.writeJson('research.json', value.artifact);
          const sources = new Set(value.artifact.notes.flatMap((n) => n.sources.map((s) => s.url)))
            .size;
          return {
            value: value.artifact,
            summary: `${value.artifact.notes.length} notes, ${sources} sources via ${value.artifact.source}`,
            costUsd: value.costUsd,
          };
        },
        () => run.readJson('research.json'),
      ),
      stage<CompetitorArtifact>(
        'competitors',
        'competitors.json',
        async () => {
          const value = await readCompetitors(
            serp.results,
            project,
            progress('competitors'),
            signal,
          );
          run.writeJson('competitors.json', value);
          const avg = value.pages.length
            ? Math.round(value.pages.reduce((s, p) => s + p.wordCount, 0) / value.pages.length)
            : 0;
          return {
            value,
            summary: value.pages.length
              ? `${value.pages.length} read, avg ${avg.toLocaleString()} words${value.failed.length ? `, ${value.failed.length} unreadable` : ''}`
              : 'none readable, briefing from search data',
          };
        },
        () => run.readJson('competitors.json'),
      ),
    ]);

    // 4. Brief ─────────────────────────────────────────────────────────────
    const brief = await stage<Brief>(
      'brief',
      'brief.json',
      async () => {
        const { output, costUsd } = await generateObject({
          schema: BriefSchema,
          model: config.models.analyst,
          effort: 'medium',
          system: prompts.BRIEF_SYSTEM,
          prompt: prompts.briefPrompt({
            keyword,
            config,
            serp: serp.results,
            competitors: competitors.pages,
            research: research.notes,
          }),
          budgetUsd: remaining(),
          signal,
        });
        run.writeJson('brief.json', output);
        return {
          value: output,
          summary: `${output.outline.length} sections, ~${output.targetWords.toLocaleString()} words, ${output.gaps.length} gaps`,
          costUsd,
        };
      },
      () => run.readJson('brief.json'),
    );

    // 5. Draft ─────────────────────────────────────────────────────────────
    const draft = await stage<string>(
      'draft',
      'draft.md',
      async () => {
        const { output, costUsd } = await generateText({
          model: config.models.writer,
          effort: 'high',
          system: prompts.writerSystem(config),
          prompt: prompts.writerPrompt(keyword, brief, config),
          budgetUsd: remaining(),
          signal,
          onText: (text) => emit({ type: 'draft:delta', text }),
        });
        const body = stripLeadingH1(
          output.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1'),
        ).trim();
        run.writeText('draft.md', `${body}\n`);
        const { words } = lintArticle(body, { avoid: [] });
        return { value: body, summary: `${words.toLocaleString()} words`, costUsd };
      },
      () => run.readText('draft.md'),
    );

    // 6. Images ────────────────────────────────────────────────────────────
    const wantImages = (options.images ?? true) && config.images.enabled;
    let images: ImagesArtifact = { sections: [] };
    if (!wantImages || !hasProvider('openrouter')) {
      const reason = !wantImages ? 'disabled' : 'set OPENROUTER_API_KEY to enable';
      run.update('images', { status: 'skipped', summary: reason });
      emit({ type: 'stage:skip', stage: 'images', reason });
    } else {
      images = await stage<ImagesArtifact>(
        'images',
        'images.json',
        async () => {
          const value = await illustrate(
            run,
            brief.title,
            draft,
            project,
            progress('images'),
            remaining(),
            signal,
          );
          run.writeJson('images.json', value.artifact);
          const count = (value.artifact.hero ? 1 : 0) + value.artifact.sections.length;
          return { value: value.artifact, summary: `${count} generated`, costUsd: value.costUsd };
        },
        () => run.readJson('images.json'),
      );
    }

    // Assemble ─────────────────────────────────────────────────────────────
    let body = draft;
    for (const image of images.sections) {
      body = insertImageAfterHeading(body, image.heading, image).body;
    }
    const sources = uniqueSources(brief, research.notes);
    const article: Article = {
      meta: {
        title: brief.title,
        slug,
        description: brief.description,
        excerpt: brief.excerpt,
        keyword,
        category: brief.category,
        author: config.author?.name,
        date: new Date().toISOString().slice(0, 10),
        heroImage: images.hero,
        sources,
      },
      body,
    };
    run.writeText('article.md', serializeArticle(article));
    const lint = lintArticle(body, { targetWords: brief.targetWords, avoid: config.writing.avoid });
    run.finish('done');

    const result: WriteResult = {
      slug,
      articlePath: run.path('article.md'),
      title: brief.title,
      words: lint.words,
      costUsd: run.record.costUsd,
      warnings: lint.warnings,
    };
    emit({ type: 'run:done', ...result, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    run.finish('failed');
    emit({ type: 'run:error', error: (error as Error).message });
    throw error;
  }
}

// ─── Stage implementations ────────────────────────────────────────────────

type Progress = (message: string) => void;

async function searchResults(
  keyword: string,
  project: Project,
  progress: Progress,
  budgetUsd: number,
  signal?: AbortSignal,
): Promise<{ artifact: SerpArtifact; costUsd: number }> {
  const { seo } = project.config;
  const errors: string[] = [];

  if (hasProvider('dataforseo')) {
    try {
      progress('querying DataForSEO');
      const results = await dataForSeoSerp(keyword, { ...seo, signal });
      return { artifact: { source: 'DataForSEO', results }, costUsd: 0 };
    } catch (error) {
      errors.push((error as Error).message);
      progress('DataForSEO failed, falling back');
    }
  }
  if (hasProvider('firecrawl')) {
    try {
      progress('querying Firecrawl search');
      const results = await firecrawlSearch(keyword, { limit: 10, location: seo.location, signal });
      return { artifact: { source: 'Firecrawl', results }, costUsd: 0 };
    } catch (error) {
      errors.push((error as Error).message);
      progress('Firecrawl search failed, falling back');
    }
  }

  progress('asking Claude to search the web');
  const { output, costUsd } = await generateObject({
    schema: z.object({
      results: z.array(z.object({ url: z.string(), title: z.string(), description: z.string() })),
    }),
    model: project.config.models.fast,
    tools: ['WebSearch'],
    system: 'You report web search results faithfully. Do not invent URLs.',
    prompt: `Search the web for "${keyword}" and list the top 10 organic results in order (title, URL, one-line description).`,
    budgetUsd: Math.min(budgetUsd, 0.5),
    signal,
    onToolUse: () => progress('searching'),
  });
  return {
    artifact: {
      source: errors.length ? 'Claude web search (fallback)' : 'Claude web search',
      results: output.results.map((r, i) => ({ ...r, position: i + 1, domain: hostname(r.url) })),
    },
    costUsd,
  };
}

async function researchTopic(
  keyword: string,
  project: Project,
  progress: Progress,
  budgetUsd: number,
  signal?: AbortSignal,
): Promise<{ artifact: ResearchArtifact; costUsd: number }> {
  if (hasProvider('perplexity')) {
    const questions = [
      `What are the most important current facts, statistics, and recent changes about ${keyword}? Include dates.`,
      `What mistakes and misconceptions do people commonly have about ${keyword}?`,
      `What expert, practical advice and concrete examples exist for ${keyword}?`,
    ];
    progress(`running ${questions.length} Perplexity queries`);
    const settled = await Promise.allSettled(
      questions.map((q) => perplexityResearch(q, { recency: 'year', signal })),
    );
    const notes = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    if (notes.length) return { artifact: { source: 'Perplexity', notes }, costUsd: 0 };
    progress('Perplexity failed, falling back to Claude web search');
  }

  let searches = 0;
  const { output, costUsd } = await generateObject({
    schema: ResearchSchema,
    model: project.config.models.analyst,
    effort: 'low',
    tools: ['WebSearch', 'WebFetch'],
    maxTurns: 24,
    system: prompts.RESEARCH_SYSTEM,
    prompt: prompts.researchPrompt(keyword, project.config),
    budgetUsd,
    signal,
    onToolUse: (name, input) => {
      if (name === 'WebSearch') progress(`search ${++searches}: ${String(input.query ?? '')}`);
      if (name === 'WebFetch') progress(`reading ${hostname(String(input.url ?? ''))}`);
    },
  });
  return { artifact: { source: 'Claude web search', notes: output.notes }, costUsd };
}

async function readCompetitors(
  results: SearchResult[],
  project: Project,
  progress: Progress,
  signal?: AbortSignal,
): Promise<CompetitorArtifact> {
  const targets = pickCompetitors(results, project.config.seo.competitors, project.config.blog.url);
  const failed: CompetitorArtifact['failed'] = [];
  let done = 0;

  const pages = await mapLimit(targets, 3, async (target) => {
    let page: FetchedPage | null = null;
    try {
      if (hasProvider('firecrawl')) {
        try {
          page = await firecrawlScrape(target.url, signal);
        } catch {
          page = await fetchPage(target.url, signal);
        }
      } else {
        page = await fetchPage(target.url, signal);
      }
    } catch (error) {
      failed.push({ url: target.url, error: (error as Error).message });
    }
    progress(`${++done}/${targets.length} · ${target.domain}`);
    if (!page) return null;
    const summary = summarizePage({ ...page, title: page.title || target.title });
    if (!isUsable(summary)) {
      failed.push({
        url: target.url,
        error: 'too little readable content (blocked or JS-rendered)',
      });
      return null;
    }
    return summary;
  });

  return { pages: pages.filter((p): p is PageSummary => p !== null), failed };
}

async function illustrate(
  run: Run,
  title: string,
  draft: string,
  project: Project,
  progress: Progress,
  budgetUsd: number,
  signal?: AbortSignal,
): Promise<{ artifact: ImagesArtifact; costUsd: number }> {
  const { config } = project;
  const h2s = headings(draft).filter((h) => !/faq|frequently asked/i.test(h));
  progress('planning images');
  const plan = await generateObject({
    schema: ImagePlanSchema,
    model: config.models.fast,
    system: prompts.IMAGE_SYSTEM,
    prompt: prompts.imagePrompt(title, h2s, config),
    budgetUsd: Math.min(budgetUsd, 0.25),
    signal,
  });

  const jobs: {
    kind: 'hero' | 'section';
    heading?: string;
    prompt: string;
    alt: string;
    name: string;
  }[] = [
    { kind: 'hero', prompt: plan.output.hero.prompt, alt: plan.output.hero.alt, name: 'hero' },
    ...plan.output.sections
      .filter((s) => h2s.includes(s.heading))
      .slice(0, config.images.sections)
      .map((s, i) => ({ kind: 'section' as const, ...s, name: `section-${i + 1}` })),
  ];

  mkdirSync(run.path('images'), { recursive: true });
  let imageCost = 0;
  let done = 0;
  const generated = await mapLimit(jobs, 2, async (job) => {
    try {
      const image = await generateImage({
        model: config.images.model,
        prompt: `${job.prompt}. Style: ${config.images.style}. No text, letters, or logos.`,
        aspectRatio: job.kind === 'hero' ? '16:9' : '3:2',
        signal,
      });
      const src = `images/${job.name}.${image.extension}`;
      writeFileSync(run.path(src), image.bytes);
      imageCost += image.costUsd;
      progress(`${++done}/${jobs.length} images`);
      return { ...job, src };
    } catch (error) {
      progress(`${job.name} failed: ${(error as Error).message}`);
      return null;
    }
  });

  const ok = generated.filter((g): g is NonNullable<typeof g> => g !== null);
  if (!ok.length)
    throw new Error('Every image request failed. Check OPENROUTER_API_KEY and credits.');
  const hero = ok.find((g) => g.kind === 'hero');
  return {
    artifact: {
      hero: hero && { src: hero.src, alt: hero.alt },
      sections: ok
        .filter((g) => g.kind === 'section' && g.heading)
        .map((g) => ({ heading: g.heading as string, src: g.src, alt: g.alt })),
    },
    costUsd: plan.costUsd + imageCost,
  };
}

function uniqueSources(brief: Brief, notes: ResearchNote[]): { title: string; url: string }[] {
  const cited = new Set(brief.outline.flatMap((s) => s.facts.map((f) => f.url)));
  const all = new Map<string, string>();
  for (const note of notes) for (const s of note.sources) all.set(s.url, s.title);
  return [...cited]
    .filter((url) => /^https?:\/\//.test(url))
    .map((url) => ({ url, title: all.get(url) ?? hostname(url) }));
}
