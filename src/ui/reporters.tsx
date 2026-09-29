import { Box, render, Static, Text, useInput, useWindowSize } from 'ink';
import { useSyncExternalStore } from 'react';
import { type Emit, type PipelineEvent, STAGE_LABELS } from '../core/events';
import { displayPath, formatDuration, formatUsd } from '../core/text';
import { RunPanel } from './components';
import { type RunView, reduceRun } from './run-state';
import { theme } from './theme';

export interface Reporter {
  emit: Emit;
  /** Free-form line for non-run output (queue progress, notices). */
  note(message: string): void;
  close(): Promise<void>;
}

export type ReporterMode = 'tui' | 'plain' | 'json';

export function pickReporterMode(json: boolean): ReporterMode {
  if (json) return 'json';
  return process.stdout.isTTY && !process.env.CI ? 'tui' : 'plain';
}

export function createReporter(mode: ReporterMode, onCancel: () => void): Reporter {
  if (mode === 'json') return jsonReporter();
  if (mode === 'plain') return plainReporter();
  return inkReporter(onCancel);
}

/** NDJSON on stdout: one event per line, for scripts and CI. */
function jsonReporter(): Reporter {
  const write = (value: object) => process.stdout.write(`${JSON.stringify(value)}\n`);
  return {
    emit: (event) => {
      if (event.type !== 'draft:delta') write({ ...event, at: new Date().toISOString() });
    },
    note: (message) => write({ type: 'note', message }),
    close: async () => {},
  };
}

/** Line-per-event output for pipes and CI logs. */
function plainReporter(): Reporter {
  const log = (line: string) => process.stdout.write(`${line}\n`);
  return {
    emit: (event: PipelineEvent) => {
      switch (event.type) {
        case 'run:start':
          log(`leo ${event.resumed ? 'resuming' : 'writing'} "${event.keyword}"`);
          break;
        case 'stage:start':
          log(`  … ${STAGE_LABELS[event.stage]}`);
          break;
        case 'stage:done':
          log(
            `  ✓ ${STAGE_LABELS[event.stage]}: ${event.summary} (${formatDuration(event.durationMs)})`,
          );
          break;
        case 'stage:skip':
          log(`  – ${STAGE_LABELS[event.stage]}: ${event.reason}`);
          break;
        case 'stage:error':
          log(`  ✗ ${STAGE_LABELS[event.stage]}: ${event.error}`);
          break;
        case 'run:done':
          log(`done: ${event.title}`);
          log(
            `  ${event.words} words · ${formatUsd(event.costUsd)} · ${displayPath(event.articlePath)}`,
          );
          for (const w of event.warnings) log(`  ! ${w}`);
          break;
        case 'run:error':
          log(`failed: ${event.error}`);
          break;
      }
    },
    note: (message) => log(message),
    close: async () => {},
  };
}

class RunStore {
  runs: RunView[] = [];
  notes: string[] = [];
  private listeners = new Set<() => void>();
  private snapshot = { runs: this.runs, notes: this.notes };

  emit = (event: PipelineEvent) => {
    if (event.type === 'run:start') {
      this.runs = [...this.runs, reduceRun({} as RunView, event)];
    } else if (this.runs.length) {
      const last = this.runs.length - 1;
      this.runs = this.runs.with(last, reduceRun(this.runs[last] as RunView, event));
    }
    this.publish();
  };

  note = (message: string) => {
    this.notes = [...this.notes, message];
    this.publish();
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = () => this.snapshot;

  private publish() {
    this.snapshot = { runs: this.runs, notes: this.notes };
    for (const listener of this.listeners) listener();
  }
}

type StaticItem = { key: string; note: string } | { key: string; run: RunView };

function WriteApp({ store, onCancel }: { store: RunStore; onCancel: () => void }) {
  const { runs, notes } = useSyncExternalStore(store.subscribe, store.get);
  const { columns } = useWindowSize();
  useInput((input, key) => {
    if (key.ctrl && input === 'c') onCancel();
  });
  const items: StaticItem[] = [
    ...notes.map((note, i) => ({ key: `note-${i}`, note })),
    ...runs.slice(0, -1).map((run, i) => ({ key: `run-${i}`, run })),
  ];
  const current = runs.at(-1);
  return (
    <>
      <Static items={items}>
        {(item) =>
          'run' in item ? (
            <Box key={item.key} marginBottom={1}>
              <RunPanel run={item.run} width={columns} />
            </Box>
          ) : (
            <Text key={item.key} color={theme.muted}>
              {item.note}
            </Text>
          )
        }
      </Static>
      {current && <RunPanel run={current} width={columns} />}
    </>
  );
}

function inkReporter(onCancel: () => void): Reporter {
  const store = new RunStore();
  const instance = render(<WriteApp store={store} onCancel={onCancel} />, { exitOnCtrlC: false });
  return {
    emit: store.emit,
    note: store.note,
    close: async () => {
      // Let the final frame paint before unmounting.
      await new Promise((resolve) => setTimeout(resolve, 50));
      instance.unmount();
      await instance.waitUntilExit();
    },
  };
}
