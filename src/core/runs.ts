import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { STAGES, type StageId } from './events';
import type { Project } from './project';

export type StageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface StageRecord {
  status: StageStatus;
  summary?: string;
  error?: string;
  costUsd: number;
  durationMs?: number;
}

export interface RunRecord {
  version: 2;
  keyword: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'done' | 'failed';
  costUsd: number;
  stages: Record<StageId, StageRecord>;
  published?: { provider: string; location: string; at: string };
}

/**
 * A run lives in `.leo/runs/<slug>/`: `run.json` plus one artifact per stage.
 * Stages are resumable: a finished stage with its artifact on disk is reused
 * instead of paying for it again.
 */
export class Run {
  readonly dir: string;
  record: RunRecord;

  private constructor(dir: string, record: RunRecord) {
    this.dir = dir;
    this.record = record;
  }

  static open(project: Project, keyword: string, slug: string, fresh = false): Run {
    const dir = join(project.runsDir, slug);
    const file = join(dir, 'run.json');
    if (!fresh && existsSync(file)) {
      const record = JSON.parse(readFileSync(file, 'utf8')) as RunRecord;
      record.status = 'running';
      return new Run(dir, record);
    }
    mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString();
    const stages = Object.fromEntries(
      STAGES.map((id) => [id, { status: 'pending', costUsd: 0 } satisfies StageRecord]),
    ) as Record<StageId, StageRecord>;
    const run = new Run(dir, {
      version: 2,
      keyword,
      slug,
      createdAt: now,
      updatedAt: now,
      status: 'running',
      costUsd: 0,
      stages,
    });
    run.save();
    return run;
  }

  static load(project: Project, slug: string): Run | null {
    const dir = join(project.runsDir, slug);
    const file = join(dir, 'run.json');
    if (!existsSync(file)) return null;
    return new Run(dir, JSON.parse(readFileSync(file, 'utf8')) as RunRecord);
  }

  static list(project: Project): RunRecord[] {
    if (!existsSync(project.runsDir)) return [];
    return readdirSync(project.runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(project.runsDir, entry.name, 'run.json'))
      .filter((file) => existsSync(file))
      .map((file) => JSON.parse(readFileSync(file, 'utf8')) as RunRecord)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get isResumed(): boolean {
    return STAGES.some((id) => this.record.stages[id].status === 'done');
  }

  path(name: string): string {
    return join(this.dir, name);
  }

  isCached(stage: StageId, artifact: string): boolean {
    return this.record.stages[stage].status === 'done' && existsSync(this.path(artifact));
  }

  update(stage: StageId, patch: Partial<StageRecord>): void {
    Object.assign(this.record.stages[stage], patch);
    this.record.costUsd = STAGES.reduce((sum, id) => sum + this.record.stages[id].costUsd, 0);
    this.save();
  }

  finish(status: RunRecord['status']): void {
    this.record.status = status;
    this.save();
  }

  readJson<T>(name: string): T {
    return JSON.parse(readFileSync(this.path(name), 'utf8')) as T;
  }

  writeJson(name: string, value: unknown): void {
    this.writeText(name, `${JSON.stringify(value, null, 2)}\n`);
  }

  readText(name: string): string {
    return readFileSync(this.path(name), 'utf8');
  }

  /** Atomic write so a crash never leaves a half-written artifact behind. */
  writeText(name: string, content: string): void {
    const target = this.path(name);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, content);
    renameSync(tmp, target);
  }

  save(): void {
    this.record.updatedAt = new Date().toISOString();
    this.writeJson('run.json', this.record);
  }
}
