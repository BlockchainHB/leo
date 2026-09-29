import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

export const CONFIG_FILE = 'leo.config.json';

const PublishSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('local'),
    dir: z.string().default('content/posts'),
  }),
  z.object({
    provider: z.literal('sanity'),
    projectId: z.string().min(1),
    dataset: z.string().default('production'),
    postType: z.string().default('post'),
    apiVersion: z.string().default('2026-09-01'),
  }),
]);

export const ConfigSchema = z.object({
  blog: z.object({
    name: z.string().min(1),
    url: z.url().optional(),
    niche: z.string().min(1),
    audience: z.string().min(1),
    voice: z.string().default('clear, confident, practical'),
  }),
  author: z.object({ name: z.string().min(1) }).optional(),
  writing: z
    .object({
      pointOfView: z
        .enum(['first-person', 'second-person', 'third-person'])
        .default('second-person'),
      /** Overrides the word target the brief derives from competitors. */
      targetWords: z.number().int().positive().optional(),
      includeFaq: z.boolean().default(true),
      avoid: z.array(z.string()).default(['em dashes', 'in today’s fast-paced world', 'delve']),
      rules: z.array(z.string()).default([]),
    })
    .prefault({}),
  seo: z
    .object({
      location: z.string().default('United States'),
      language: z.string().default('en'),
      competitors: z.number().int().min(0).max(10).default(5),
    })
    .prefault({}),
  images: z
    .object({
      enabled: z.boolean().default(true),
      model: z.string().default('google/gemini-3.1-flash-image'),
      style: z
        .string()
        .default('clean editorial 3D illustration, soft studio lighting, restrained palette'),
      sections: z.number().int().min(0).max(6).default(2),
    })
    .prefault({}),
  internalLinks: z
    .array(
      z.object({ title: z.string(), url: z.string(), topics: z.array(z.string()).default([]) }),
    )
    .default([]),
  categories: z.array(z.string()).default([]),
  publish: PublishSchema.prefault({ provider: 'local' }),
  models: z
    .object({
      writer: z.string().default('claude-opus-5-5'),
      analyst: z.string().default('claude-sonnet-5-5'),
      fast: z.string().default('claude-haiku-4-5'),
    })
    .prefault({}),
  /** Hard ceiling on Claude spend for a single article run. */
  budgetUsd: z.number().positive().default(3),
});

export type LeoConfig = z.infer<typeof ConfigSchema>;
export type ConfigInput = z.input<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Walks up from `start` to find the nearest leo.config.json. */
export function findConfig(start = process.cwd()): string | null {
  let dir = resolve(start);
  while (true) {
    const candidate = join(dir, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function parseConfig(raw: unknown): LeoConfig {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`${CONFIG_FILE} is invalid`, issues);
  }
  return result.data;
}

export function loadConfig(path: string): LeoConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Could not read ${path}: ${(error as Error).message}`);
  }
  return parseConfig(raw);
}

export function writeConfig(path: string, config: ConfigInput): void {
  parseConfig(config);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
