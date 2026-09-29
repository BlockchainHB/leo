/**
 * Every run emits a typed event stream. The Ink UI, the `--json` NDJSON
 * output, and the chat agent all consume the same events, so the pipeline
 * never knows or cares how it's being displayed.
 */

export const STAGES = ['serp', 'research', 'competitors', 'brief', 'draft', 'images'] as const;
export type StageId = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageId, string> = {
  serp: 'Search results',
  research: 'Research',
  competitors: 'Competitor pages',
  brief: 'Content brief',
  draft: 'Draft',
  images: 'Images',
};

export type PipelineEvent =
  | { type: 'run:start'; keyword: string; slug: string; resumed: boolean }
  | { type: 'stage:start'; stage: StageId; detail?: string }
  | { type: 'stage:progress'; stage: StageId; message: string }
  | { type: 'stage:skip'; stage: StageId; reason: string }
  | { type: 'stage:done'; stage: StageId; summary: string; durationMs: number; costUsd: number }
  | { type: 'stage:error'; stage: StageId; error: string }
  | { type: 'draft:delta'; text: string }
  | { type: 'cost'; totalUsd: number }
  | {
      type: 'run:done';
      slug: string;
      articlePath: string;
      title: string;
      words: number;
      costUsd: number;
      durationMs: number;
      warnings: string[];
    }
  | { type: 'run:error'; error: string };

export type Emit = (event: PipelineEvent) => void;
