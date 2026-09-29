import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from './project';
import { slugify } from './text';

export type QueueStatus = 'pending' | 'running' | 'done' | 'failed';

export interface QueueItem {
  id: number;
  keyword: string;
  slug: string;
  status: QueueStatus;
  addedAt: string;
  updatedAt: string;
  error?: string;
}

interface QueueFile {
  version: 2;
  nextId: number;
  items: QueueItem[];
}

export class Queue {
  private readonly file: string;
  private data: QueueFile;

  constructor(project: Project) {
    this.file = join(project.stateDir, 'queue.json');
    this.data = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, 'utf8')) as QueueFile)
      : { version: 2, nextId: 1, items: [] };
  }

  get items(): readonly QueueItem[] {
    return this.data.items;
  }

  add(keywords: string[]): { added: QueueItem[]; skipped: string[] } {
    const added: QueueItem[] = [];
    const skipped: string[] = [];
    for (const raw of keywords) {
      const keyword = raw.trim();
      if (!keyword) continue;
      const slug = slugify(keyword);
      if (this.data.items.some((item) => item.slug === slug && item.status !== 'failed')) {
        skipped.push(keyword);
        continue;
      }
      const now = new Date().toISOString();
      const item: QueueItem = {
        id: this.data.nextId++,
        keyword,
        slug,
        status: 'pending',
        addedAt: now,
        updatedAt: now,
      };
      this.data.items.push(item);
      added.push(item);
    }
    this.save();
    return { added, skipped };
  }

  next(): QueueItem | undefined {
    return this.data.items.find((item) => item.status === 'pending');
  }

  set(id: number, status: QueueStatus, error?: string): void {
    const item = this.data.items.find((i) => i.id === id);
    if (!item) return;
    item.status = status;
    item.updatedAt = new Date().toISOString();
    if (error) item.error = error;
    else delete item.error;
    this.save();
  }

  remove(id: number): boolean {
    const before = this.data.items.length;
    this.data.items = this.data.items.filter((item) => item.id !== id);
    this.save();
    return this.data.items.length < before;
  }

  clear(status?: QueueStatus): number {
    const before = this.data.items.length;
    this.data.items = status ? this.data.items.filter((item) => item.status !== status) : [];
    this.save();
    return before - this.data.items.length;
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}
