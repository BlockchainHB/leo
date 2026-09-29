import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArticle, serializeArticle } from '../core/article';
import { hasProvider } from '../core/env';
import type { Project } from '../core/project';
import { Run } from '../core/runs';
import { publishToSanity } from '../providers/sanity';

export interface PublishResult {
  provider: 'local' | 'sanity';
  location: string;
}

export async function publishRun(project: Project, slug: string): Promise<PublishResult> {
  const run = Run.load(project, slug);
  if (!run || !existsSync(run.path('article.md'))) {
    throw new Error(`No finished article for "${slug}". Run \`leo write\` first.`);
  }
  const article = parseArticle(run.readText('article.md'));
  const target = project.config.publish;
  let result: PublishResult;

  if (target.provider === 'sanity') {
    if (!hasProvider('sanity')) throw new Error('SANITY_API_TOKEN is not set');
    const { documentId } = await publishToSanity(article, target, run.dir);
    result = {
      provider: 'sanity',
      location: `${target.projectId}/${target.dataset} · ${documentId}`,
    };
  } else {
    const dir = resolve(project.root, target.dir, slug);
    mkdirSync(dir, { recursive: true });
    if (existsSync(run.path('images')))
      cpSync(run.path('images'), join(dir, 'images'), { recursive: true });
    writeFileSync(join(dir, 'index.md'), serializeArticle(article));
    result = { provider: 'local', location: relative(process.cwd(), join(dir, 'index.md')) };
  }

  run.record.published = { ...result, at: new Date().toISOString() };
  run.save();
  return result;
}
