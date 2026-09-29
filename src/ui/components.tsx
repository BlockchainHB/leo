import { Box, Text, useAnimation } from 'ink';
import Gradient from 'ink-gradient';
import { STAGE_LABELS, STAGES } from '../core/events';
import { displayPath, formatDuration, formatUsd, truncate } from '../core/text';
import type { RunView, StageView } from './run-state';
import { icons, theme } from './theme';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({ color = theme.accent }: { color?: string }) {
  const { frame } = useAnimation({ interval: 80 });
  return <Text color={color}>{FRAMES[frame % FRAMES.length]}</Text>;
}

/** Re-renders once a second so running timers tick. */
export function Elapsed({ since }: { since: number }) {
  useAnimation({ interval: 1000 });
  return <Text color={theme.muted}>{formatDuration(Date.now() - since)}</Text>;
}

const WORDMARK = [
  '██╗     ███████╗ ██████╗ ',
  '██║     ██╔════╝██╔═══██╗',
  '██║     █████╗  ██║   ██║',
  '██║     ██╔══╝  ██║   ██║',
  '███████╗███████╗╚██████╔╝',
  '╚══════╝╚══════╝ ╚═════╝ ',
];

export function Banner({ subtitle }: { subtitle?: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Gradient colors={[theme.accent, theme.accentSoft]}>{WORDMARK.join('\n')}</Gradient>
      {subtitle && <Text color={theme.muted}>{subtitle}</Text>}
    </Box>
  );
}

function StageIcon({ status }: { status: StageView['status'] }) {
  switch (status) {
    case 'running':
      return <Spinner />;
    case 'done':
      return <Text color={theme.success}>{icons.done}</Text>;
    case 'failed':
      return <Text color={theme.error}>{icons.failed}</Text>;
    case 'skipped':
      return <Text color={theme.muted}>{icons.skipped}</Text>;
    default:
      return <Text color={theme.muted}>{icons.pending}</Text>;
  }
}

function StageRow({ label, stage, width }: { label: string; stage: StageView; width: number }) {
  const dim = stage.status === 'pending' || stage.status === 'skipped';
  const time =
    stage.status === 'running' && stage.startedAt ? (
      <Elapsed since={stage.startedAt} />
    ) : stage.durationMs ? (
      <Text color={theme.muted}>{formatDuration(stage.durationMs)}</Text>
    ) : null;
  const detailWidth = Math.max(10, width - 30);
  return (
    <Box>
      <Box width={2}>
        <StageIcon status={stage.status} />
      </Box>
      <Box width={19}>
        <Text color={dim ? theme.muted : undefined} bold={stage.status === 'running'}>
          {label}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={stage.status === 'failed' ? theme.error : theme.muted} wrap="truncate-end">
          {stage.detail ? truncate(stage.detail, detailWidth) : ''}
        </Text>
      </Box>
      <Box width={8} justifyContent="flex-end">
        {time}
      </Box>
    </Box>
  );
}

export function RunPanel({ run, width }: { run: RunView; width: number }) {
  const drafting = run.stages.draft.status === 'running';
  const preview = run.draftTail
    .split('\n')
    .filter((line) => line.trim())
    .slice(-4);

  return (
    <Box flexDirection="column" width={Math.min(width, 100)}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text>
          <Text color={theme.accent}>{icons.bullet}</Text>
          <Text bold> leo</Text>
          <Text color={theme.muted}> {run.resumed ? 'resuming' : 'writing'} </Text>
          <Text>“{truncate(run.keyword, 48)}”</Text>
        </Text>
        <Text color={theme.muted}>
          {formatUsd(run.totalUsd)} ·{' '}
          {run.done ? formatDuration(run.done.durationMs) : <Elapsed since={run.startedAt} />}
        </Text>
      </Box>

      {STAGES.map((id) => (
        <StageRow
          key={id}
          label={STAGE_LABELS[id]}
          stage={run.stages[id]}
          width={Math.min(width, 100)}
        />
      ))}

      {drafting && preview.length > 0 && (
        <Box
          marginTop={1}
          paddingLeft={2}
          borderStyle="bold"
          borderLeft
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          borderColor={theme.muted}
          flexDirection="column"
        >
          {preview.map((line, i) => (
            <Text key={`${i}-${line.slice(0, 8)}`} color={theme.muted} wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      )}

      {run.done && <DoneSummary done={run.done} />}
      {run.error && !run.done && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.error}>
            {icons.failed} {run.error}
          </Text>
          <Text color={theme.muted}>Progress is saved. Run the same command again to resume.</Text>
        </Box>
      )}
    </Box>
  );
}

function DoneSummary({ done }: { done: NonNullable<RunView['done']> }) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>{done.title}</Text>
      <Text color={theme.muted}>
        {done.words.toLocaleString()} words · {formatUsd(done.costUsd)} ·{' '}
        {displayPath(done.articlePath)}
      </Text>
      {done.warnings.map((warning) => (
        <Text key={warning} color={theme.warn}>
          ! {warning}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color={theme.muted}>next </Text>
        <Text color={theme.accent}>leo publish {done.slug}</Text>
      </Box>
    </Box>
  );
}
