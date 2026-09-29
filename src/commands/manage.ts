import { dirname } from 'node:path';
import { styleText } from 'node:util';
import { findConfig, loadConfig } from '../core/config';
import { hasProvider, loadDotEnv, PROVIDERS } from '../core/env';
import { openProject } from '../core/project';
import { Queue } from '../core/queue';
import { Run } from '../core/runs';
import { formatUsd, truncate } from '../core/text';
import { publishRun } from '../pipeline/publish';

const dim = (s: string) => styleText('gray', s);
const ok = (s: string) => styleText('green', s);
const bad = (s: string) => styleText('red', s);
const warn = (s: string) => styleText('yellow', s);

function print(json: boolean | undefined, value: unknown, human: () => void) {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else human();
}

export async function publishCommand(slug: string, flags: { json?: boolean }): Promise<number> {
  const project = openProject();
  const result = await publishRun(project, slug);
  print(flags.json, result, () =>
    console.log(`${ok('✓')} Published to ${result.provider}: ${result.location}`),
  );
  return 0;
}

export function queueAdd(keywords: string[], flags: { json?: boolean }): number {
  const queue = new Queue(openProject());
  const { added, skipped } = queue.add(keywords);
  print(flags.json, { added, skipped }, () => {
    for (const item of added) console.log(`${ok('+')} ${item.keyword} ${dim(`#${item.id}`)}`);
    for (const keyword of skipped) console.log(`${dim('=')} ${keyword} ${dim('already queued')}`);
  });
  return 0;
}

export function queueList(flags: { json?: boolean; all?: boolean }): number {
  const queue = new Queue(openProject());
  const items = flags.all ? queue.items : queue.items.filter((i) => i.status !== 'done');
  print(flags.json, items, () => {
    if (!items.length) {
      console.log(dim('Queue is empty. Add keywords with `leo queue add "keyword" "another"`.'));
      return;
    }
    const badge = {
      pending: dim('pending'),
      running: warn('running'),
      done: ok('done'),
      failed: bad('failed'),
    };
    for (const item of items) {
      console.log(
        `${dim(`#${String(item.id).padEnd(3)}`)} ${badge[item.status].padEnd(18)} ${item.keyword}${
          item.error ? dim(`  ${truncate(item.error, 60)}`) : ''
        }`,
      );
    }
  });
  return 0;
}

export function queueRemove(ids: string[], flags: { json?: boolean }): number {
  const queue = new Queue(openProject());
  const removed = ids.map(Number).filter((id) => queue.remove(id));
  print(flags.json, { removed }, () => console.log(`Removed ${removed.length} item(s)`));
  return removed.length ? 0 : 1;
}

export function queueClear(flags: { json?: boolean; done?: boolean }): number {
  const queue = new Queue(openProject());
  const count = queue.clear(flags.done ? 'done' : undefined);
  print(flags.json, { cleared: count }, () => console.log(`Cleared ${count} item(s)`));
  return 0;
}

export function runsCommand(flags: { json?: boolean }): number {
  const runs = Run.list(openProject());
  print(flags.json, runs, () => {
    if (!runs.length) {
      console.log(dim('No runs yet. Try `leo write "your keyword"`.'));
      return;
    }
    for (const run of runs) {
      const status =
        run.status === 'done'
          ? ok('done   ')
          : run.status === 'failed'
            ? bad('failed ')
            : warn('partial');
      const published = run.published ? dim(` · published to ${run.published.provider}`) : '';
      console.log(
        `${status} ${run.slug.padEnd(42)} ${dim(formatUsd(run.costUsd).padStart(6))} ${dim(run.updatedAt.slice(0, 10))}${published}`,
      );
    }
  });
  return 0;
}

export function doctorCommand(flags: { json?: boolean }): number {
  const configPath = findConfig();
  let configError: string | null = null;
  if (configPath) {
    loadDotEnv(dirname(configPath));
    try {
      loadConfig(configPath);
    } catch (error) {
      configError = [
        (error as Error).message,
        ...((error as { issues?: string[] }).issues ?? []),
      ].join('\n  ');
    }
  }

  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 12);
  const providers = PROVIDERS.map((p) => ({ ...p, configured: hasProvider(p.id) }));
  const report = {
    node: { version: process.versions.node, ok: nodeOk },
    config: { path: configPath, ok: !!configPath && !configError, error: configError },
    providers: providers.map(({ id, label, configured, fallback }) => ({
      id,
      label,
      configured,
      fallback,
    })),
  };

  print(flags.json, report, () => {
    console.log(
      `${nodeOk ? ok('✓') : bad('✗')} Node ${process.versions.node}${nodeOk ? '' : dim('  needs 22.12+')}`,
    );
    if (!configPath) console.log(`${bad('✗')} No leo.config.json ${dim('run `leo init`')}`);
    else if (configError) console.log(`${bad('✗')} ${configError}`);
    else console.log(`${ok('✓')} Config ${dim(configPath)}`);
    console.log('');
    for (const p of providers) {
      const mark = p.configured ? ok('✓') : p.id === 'claude' ? warn('?') : dim('○');
      const note = p.configured
        ? dim(p.purpose)
        : p.id === 'claude'
          ? dim('no ANTHROPIC_API_KEY; will try Claude Code sign-in')
          : dim(`not set · ${p.fallback}`);
      console.log(`${mark} ${p.label.padEnd(11)} ${note}`);
    }
  });
  return nodeOk && (!configPath || !configError) ? 0 : 1;
}
