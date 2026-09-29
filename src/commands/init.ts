import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import { CONFIG_FILE, type ConfigInput, writeConfig } from '../core/config';
import { PROVIDERS } from '../core/env';

function check<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Setup cancelled. Nothing was written.');
    process.exit(130);
  }
  return value as Exclude<T, symbol>;
}

const required = (label: string) => (value: string | undefined) =>
  value?.trim() ? undefined : `${label} is required`;

export async function initCommand(): Promise<number> {
  const root = process.cwd();
  const configPath = join(root, CONFIG_FILE);

  p.intro(' leo init ');

  if (existsSync(configPath)) {
    const overwrite = check(
      await p.confirm({
        message: `${CONFIG_FILE} already exists here. Replace it?`,
        initialValue: false,
      }),
    );
    if (!overwrite) {
      p.outro('Kept your existing config.');
      return 0;
    }
  }

  const blog = await p.group(
    {
      name: () => p.text({ message: 'What is the blog called?', validate: required('Name') }),
      url: () =>
        p.text({
          message: 'Its URL (used to skip your own pages in search results)',
          placeholder: 'https://example.com',
          validate: (v) =>
            !v || /^https?:\/\/\S+$/.test(v) ? undefined : 'Must start with http(s)://',
        }),
      niche: () =>
        p.text({
          message: 'What does it cover?',
          placeholder: 'B2B SaaS pricing',
          validate: required('Niche'),
        }),
      audience: () =>
        p.text({
          message: 'Who reads it?',
          placeholder: 'founders and PMs at early-stage startups',
          validate: required('Audience'),
        }),
      voice: () =>
        p.text({
          message: 'How should it sound?',
          placeholder: 'clear, confident, practical',
          defaultValue: 'clear, confident, practical',
        }),
      author: () => p.text({ message: 'Author name (optional)' }),
    },
    { onCancel: () => check(Symbol()) },
  );

  const destination = check(
    await p.select({
      message: 'Where should finished articles go?',
      options: [
        { value: 'local', label: 'Markdown files', hint: 'content/posts/<slug>/index.md' },
        { value: 'sanity', label: 'Sanity CMS', hint: 'saved as drafts for review' },
      ],
    }),
  );

  let publish: ConfigInput['publish'] = { provider: 'local', dir: 'content/posts' };
  if (destination === 'sanity') {
    const projectId = check(
      await p.text({ message: 'Sanity project ID', validate: required('Project ID') }),
    );
    const dataset = check(
      await p.text({ message: 'Dataset', defaultValue: 'production', placeholder: 'production' }),
    );
    publish = { provider: 'sanity', projectId, dataset: dataset || 'production' };
  }

  const images = check(
    await p.confirm({
      message: 'Generate a hero and section images? (needs OpenRouter)',
      initialValue: true,
    }),
  );

  const config: ConfigInput = {
    blog: {
      name: blog.name,
      url: blog.url || undefined,
      niche: blog.niche,
      audience: blog.audience,
      voice: blog.voice || 'clear, confident, practical',
    },
    ...(blog.author ? { author: { name: blog.author } } : {}),
    publish,
    images: { enabled: images },
  };
  writeConfig(configPath, config);

  const envPath = join(root, '.env');
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const missing = PROVIDERS.flatMap((provider) =>
    provider.env
      .filter((key) => !process.env[key] && !new RegExp(`^${key}=.+`, 'm').test(existing))
      .map((key) => ({ key, provider })),
  ).filter(({ provider }) => provider.id !== 'sanity' || destination === 'sanity');

  if (missing.length) {
    p.note(
      missing.map(({ key, provider }) => `${key.padEnd(20)} ${provider.purpose}`).join('\n'),
      'API keys (all optional except Claude, and Leo falls back when one is missing)',
    );
    const addKeys = check(
      await p.confirm({ message: 'Paste keys now? They go in .env', initialValue: true }),
    );
    if (addKeys) {
      const lines: string[] = [];
      for (const { key } of missing) {
        const value = check(await p.password({ message: `${key} (leave empty to skip)` }));
        if (value?.trim()) lines.push(`${key}=${value.trim()}`);
      }
      if (lines.length) {
        appendFileSync(
          envPath,
          `${existing && !existing.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n`,
        );
      }
    }
  }

  ensureGitignore(root);

  p.outro(`Ready. Try:  leo write "${exampleKeyword(blog.niche)}"`);
  return 0;
}

function ensureGitignore(root: string) {
  const path = join(root, '.gitignore');
  const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const needed = ['.env', '.leo/'].filter((entry) => !content.split('\n').includes(entry));
  if (needed.length) {
    writeFileSync(
      path,
      `${content}${content && !content.endsWith('\n') ? '\n' : ''}${needed.join('\n')}\n`,
    );
  }
}

function exampleKeyword(niche: string): string {
  return `${niche.toLowerCase()} for beginners`;
}
