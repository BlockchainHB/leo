import { type PipelineEvent, STAGES, type StageId } from '../core/events';

export interface StageView {
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  detail?: string;
  startedAt?: number;
  durationMs?: number;
}

export interface RunView {
  keyword: string;
  slug: string;
  resumed: boolean;
  startedAt: number;
  stages: Record<StageId, StageView>;
  draftTail: string;
  totalUsd: number;
  done?: Extract<PipelineEvent, { type: 'run:done' }>;
  error?: string;
}

export function initialRunView(keyword = ''): RunView {
  return {
    keyword,
    slug: '',
    resumed: false,
    startedAt: Date.now(),
    stages: Object.fromEntries(STAGES.map((id) => [id, { status: 'pending' }])) as Record<
      StageId,
      StageView
    >,
    draftTail: '',
    totalUsd: 0,
  };
}

const TAIL = 600;

export function reduceRun(state: RunView, event: PipelineEvent, now = Date.now()): RunView {
  const stage = (id: StageId, patch: Partial<StageView>) => ({
    ...state,
    stages: { ...state.stages, [id]: { ...state.stages[id], ...patch } },
  });

  switch (event.type) {
    case 'run:start':
      return {
        ...initialRunView(event.keyword),
        slug: event.slug,
        resumed: event.resumed,
        startedAt: now,
      };
    case 'stage:start':
      return stage(event.stage, { status: 'running', detail: event.detail, startedAt: now });
    case 'stage:progress':
      return stage(event.stage, { detail: event.message });
    case 'stage:skip':
      return stage(event.stage, { status: 'skipped', detail: event.reason });
    case 'stage:done':
      return stage(event.stage, {
        status: 'done',
        detail: event.summary,
        durationMs: event.durationMs,
      });
    case 'stage:error':
      return stage(event.stage, { status: 'failed', detail: event.error });
    case 'draft:delta':
      return { ...state, draftTail: (state.draftTail + event.text).slice(-TAIL) };
    case 'cost':
      return { ...state, totalUsd: event.totalUsd };
    case 'run:done':
      return { ...state, done: event, totalUsd: event.costUsd };
    case 'run:error':
      return { ...state, error: event.error };
  }
}
