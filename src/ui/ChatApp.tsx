import { TextInput } from '@inkjs/ui';
import { Box, Static, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { type ChatEvent, ChatSession } from '../agent/session';
import type { Project } from '../core/project';
import { formatUsd, hostname, truncate } from '../core/text';
import { Banner, RunPanel, Spinner } from './components';
import { initialRunView, type RunView, reduceRun } from './run-state';
import { icons, theme } from './theme';

type Entry =
  | { id: number; kind: 'user' | 'assistant' | 'tool' | 'info' | 'error'; text: string }
  | { id: number; kind: 'run'; run: RunView }
  | { id: number; kind: 'banner' };
type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'id'> : never) : never;

const COMMANDS = ['/help', '/cost', '/exit'];
const HELP = [
  'Ask for topic ideas, keyword research, or an article: "write about pricing page teardown".',
  'Leo runs the full pipeline when you ask for an article and shows each stage live.',
  '/cost  session spend    /exit  quit    esc  interrupt    ctrl+c twice  quit',
].join('\n');

function toolLabel(name: string, input: Record<string, unknown>): string | null {
  if (name === 'WebSearch') return `Search “${truncate(String(input.query ?? ''), 60)}”`;
  if (name === 'WebFetch') return `Read ${hostname(String(input.url ?? ''))}`;
  if (name === 'mcp__leo__write_article') return null; // the run panel says it better
  return name.replace(/^mcp__leo__/, '').replace(/_/g, ' ');
}

/** Minimal inline markdown: **bold** and `code`, everything else as-is. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <Text>
      {parts.map((part, i) =>
        part.startsWith('**') ? (
          <Text key={i} bold>
            {part.slice(2, -2)}
          </Text>
        ) : part.startsWith('`') ? (
          <Text key={i} color={theme.accentSoft}>
            {part.slice(1, -1)}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function EntryView({ entry, width }: { entry: Entry; width: number }) {
  switch (entry.kind) {
    case 'banner':
      return <Banner subtitle="research-first writing agent · /help for commands" />;
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color={theme.muted}>{icons.arrow} </Text>
          <Text color={theme.muted}>{entry.text}</Text>
        </Box>
      );
    case 'assistant':
      return (
        <Box marginTop={1}>
          <Box width={2} flexShrink={0}>
            <Text color={theme.accent}>{icons.bullet}</Text>
          </Box>
          <Inline text={entry.text.trim()} />
        </Box>
      );
    case 'tool':
      return (
        <Box paddingLeft={2}>
          <Text color={theme.muted}>└ {entry.text}</Text>
        </Box>
      );
    case 'run':
      return (
        <Box marginTop={1} paddingLeft={2}>
          <RunPanel run={entry.run} width={width - 2} />
        </Box>
      );
    case 'error':
      return (
        <Box marginTop={1}>
          <Text color={theme.error}>
            {icons.failed} {entry.text}
          </Text>
        </Box>
      );
    default:
      return (
        <Box marginTop={1}>
          <Text color={theme.muted}>{entry.text}</Text>
        </Box>
      );
  }
}

export function ChatApp({ project }: { project: Project }) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, kind: 'banner' }]);
  const [live, setLive] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const session = useRef<ChatSession | null>(null);
  const nextId = useRef(1);
  const liveRef = useRef('');
  const runRef = useRef<RunView | null>(null);
  const lastCtrlC = useRef(0);

  const push = (entry: NewEntry) =>
    setEntries((prev) => [...prev, { ...entry, id: nextId.current++ } as Entry]);

  const flushLive = () => {
    if (liveRef.current.trim()) push({ kind: 'assistant', text: liveRef.current });
    liveRef.current = '';
    setLive('');
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: one session per project; handlers only touch refs and setters
  useEffect(() => {
    const onEvent = (event: ChatEvent) => {
      switch (event.type) {
        case 'text':
          liveRef.current += event.text;
          setLive(liveRef.current);
          break;
        case 'text-done':
          flushLive();
          break;
        case 'tool': {
          flushLive();
          const label = toolLabel(event.name, event.input);
          if (label) push({ kind: 'tool', text: label });
          break;
        }
        case 'pipeline': {
          const next = reduceRun(runRef.current ?? initialRunView(), event.event);
          runRef.current = next;
          setRun(next);
          if (event.event.type === 'run:done' || event.event.type === 'run:error') {
            push({ kind: 'run', run: next });
            runRef.current = null;
            setRun(null);
          }
          break;
        }
        case 'turn-end':
          flushLive();
          setCost(event.costUsd);
          setBusy(false);
          break;
        case 'error':
          flushLive();
          push({ kind: 'error', text: event.message });
          setBusy(false);
          break;
      }
    };
    session.current = new ChatSession(project, onEvent);
    return () => session.current?.close();
  }, [project]);

  const quit = () => {
    session.current?.close();
    exit();
  };

  useInput((input, key) => {
    if (key.escape && busy) {
      void session.current?.interrupt();
      push({ kind: 'info', text: 'Interrupted.' });
    }
    if (key.ctrl && input === 'c') {
      if (busy) void session.current?.interrupt();
      const now = Date.now();
      if (!busy || now - lastCtrlC.current < 1500) quit();
      lastCtrlC.current = now;
    }
  });

  const submit = (value: string) => {
    const text = value.trim();
    setInputKey((k) => k + 1);
    if (!text) return;
    if (text === '/exit' || text === '/quit') return quit();
    if (text === '/help') return push({ kind: 'info', text: HELP });
    if (text === '/cost')
      return push({ kind: 'info', text: `Chat session spend: ${formatUsd(cost)}` });
    if (busy) return;
    push({ kind: 'user', text });
    setBusy(true);
    session.current?.send(text);
  };

  return (
    <Box flexDirection="column">
      <Static items={entries}>
        {(entry) => <EntryView key={entry.id} entry={entry} width={columns} />}
      </Static>

      {live && (
        <Box marginTop={1}>
          <Box width={2} flexShrink={0}>
            <Text color={theme.accent}>{icons.bullet}</Text>
          </Box>
          <Inline text={live} />
        </Box>
      )}
      {run && (
        <Box marginTop={1} paddingLeft={2}>
          <RunPanel run={run} width={columns - 2} />
        </Box>
      )}
      {busy && !live && !run && (
        <Box marginTop={1}>
          <Spinner />
          <Text color={theme.muted}> thinking</Text>
        </Box>
      )}

      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={busy ? theme.muted : theme.accent}
        paddingX={1}
        width={Math.min(columns, 100)}
      >
        <Text color={theme.accent}>{icons.arrow} </Text>
        <TextInput
          key={inputKey}
          isDisabled={busy}
          placeholder={busy ? 'working… esc to interrupt' : 'What should we write about?'}
          suggestions={COMMANDS}
          onSubmit={submit}
        />
      </Box>
      <Box paddingX={1} justifyContent="space-between" width={Math.min(columns, 100)}>
        <Text color={theme.muted}>
          {project.config.blog.name} · {project.config.models.analyst}
        </Text>
        <Text color={theme.muted}>{formatUsd(cost)}</Text>
      </Box>
    </Box>
  );
}
