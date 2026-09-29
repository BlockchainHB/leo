import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Emit } from '../core/events';
import type { Project } from '../core/project';
import { Queue } from '../core/queue';
import { Run } from '../core/runs';
import { formatUsd } from '../core/text';
import { publishRun } from '../pipeline/publish';
import { writeArticle } from '../pipeline/run';

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const fail = (error: unknown) => ({ ...text(`Error: ${(error as Error).message}`), isError: true });

/**
 * Leo's capabilities, exposed to the chat agent as an in-process MCP server.
 * The agent decides *when* to write; the deterministic pipeline decides *how*.
 */
export function createLeoTools(project: Project, hooks: { emit: Emit; signal: () => AbortSignal }) {
  return createSdkMcpServer({
    name: 'leo',
    version: '2.0.0',
    alwaysLoad: true,
    timeout: 30 * 60_000,
    tools: [
      tool(
        'write_article',
        'Research and write a complete SEO article for a keyword: search results, research, competitor analysis, brief, draft, and images. Takes a few minutes and costs roughly $0.50 to $2. Only call this when the user asks for an article.',
        {
          keyword: z.string().describe('Target search keyword, as a searcher would type it'),
          fresh: z.boolean().optional().describe('Ignore cached stages from an earlier run'),
        },
        async ({ keyword, fresh }) => {
          try {
            const result = await writeArticle(
              project,
              { keyword, fresh, signal: hooks.signal() },
              hooks.emit,
            );
            return text(
              [
                `Finished "${result.title}" (${result.words} words, ${formatUsd(result.costUsd)}).`,
                `slug: ${result.slug}`,
                `file: ${result.articlePath}`,
                result.warnings.length ? `warnings: ${result.warnings.join('; ')}` : 'no warnings',
              ].join('\n'),
            );
          } catch (error) {
            return fail(error);
          }
        },
      ),
      tool(
        'read_article',
        'Read a finished article (frontmatter + markdown) by slug.',
        { slug: z.string() },
        async ({ slug }) => {
          const run = Run.load(project, slug);
          if (!run) return fail(new Error(`No run named ${slug}`));
          try {
            return text(run.readText('article.md').slice(0, 40_000));
          } catch {
            return fail(new Error(`${slug} has no finished article yet`));
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'list_articles',
        'List previous runs with status, cost, and whether they were published.',
        {},
        async () => {
          const runs = Run.list(project).slice(0, 30);
          if (!runs.length) return text('No articles yet.');
          return text(
            runs
              .map(
                (r) =>
                  `${r.slug} · ${r.status} · ${formatUsd(r.costUsd)} · ${r.updatedAt.slice(0, 10)}${r.published ? ` · published (${r.published.provider})` : ''}`,
              )
              .join('\n'),
          );
        },
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'publish_article',
        `Publish a finished article to the configured destination (${project.config.publish.provider}). Confirm with the user first.`,
        { slug: z.string() },
        async ({ slug }) => {
          try {
            const result = await publishRun(project, slug);
            return text(`Published to ${result.provider}: ${result.location}`);
          } catch (error) {
            return fail(error);
          }
        },
      ),
      tool(
        'queue_keywords',
        'Add keywords to the writing queue for later batch runs (`leo write --queue`).',
        { keywords: z.array(z.string()).min(1) },
        async ({ keywords }) => {
          const { added, skipped } = new Queue(project).add(keywords);
          return text(
            `Queued ${added.length}.${skipped.length ? ` Already queued: ${skipped.join(', ')}.` : ''}`,
          );
        },
      ),
      tool(
        'list_queue',
        'Show the keyword queue.',
        {},
        async () => {
          const items = new Queue(project).items;
          return text(
            items.length
              ? items.map((i) => `#${i.id} ${i.status} ${i.keyword}`).join('\n')
              : 'Queue is empty.',
          );
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  });
}
