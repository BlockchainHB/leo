import {
  type EffortLevel,
  type Options,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import pkg from '../../package.json' with { type: 'json' };

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly costUsd = 0,
  ) {
    super(message);
    this.name = 'ClaudeError';
  }
}

/**
 * Leo runs Claude Code as an embedded engine, so it must not inherit the
 * user's own Claude Code setup. Without this, a user's claude.ai connectors,
 * synced skills, plugins, hooks, and memory are all loaded into every call.
 * On one real machine that was ~209K tokens of tool definitions attached to
 * a two-line prompt.
 */
export function isolatedOptions(): Partial<Options> {
  return {
    settingSources: [],
    strictMcpConfig: true,
    settings: {
      disableClaudeAiConnectors: true,
      syncClaudeAiSkills: false,
      syncClaudeAiPlugins: false,
      disableBundledSkills: true,
      disableAllHooks: true,
      autoMemoryEnabled: false,
    },
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: `leo-agent/${pkg.version}` },
  };
}

interface BaseOptions {
  prompt: string;
  system: string;
  model: string;
  effort?: EffortLevel;
  /** Built-in tools this call may use. Empty (the default) means pure generation. */
  tools?: string[];
  maxTurns?: number;
  budgetUsd: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
}

export interface ClaudeResult<T> {
  output: T;
  costUsd: number;
}

/**
 * One focused Agent SDK call. Leo runs each pipeline step as its own small,
 * isolated query:
 * - no user or project settings are loaded,
 * - only the tools the step needs are enabled,
 * - nothing is persisted,
 * - spend is capped per call.
 */
async function run(
  options: BaseOptions,
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> },
): Promise<{ text: string; structured: unknown; costUsd: number }> {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const tools = options.tools ?? [];
  const stream = query({
    prompt: options.prompt,
    options: {
      model: options.model,
      ...(options.effort && { effort: options.effort }),
      systemPrompt: options.system,
      tools,
      allowedTools: tools,
      permissionMode: 'dontAsk',
      persistSession: false,
      maxTurns: options.maxTurns ?? (tools.length ? 12 : 3),
      maxBudgetUsd: Math.max(options.budgetUsd, 0.05),
      includePartialMessages: !!options.onText,
      ...(outputFormat && { outputFormat }),
      abortController,
      ...isolatedOptions(),
    },
  });

  let costUsd = 0;
  try {
    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (
        message.type === 'stream_event' &&
        options.onText &&
        message.parent_tool_use_id === null
      ) {
        const event = message.event;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          options.onText(event.delta.text);
        }
      } else if (message.type === 'assistant' && options.onToolUse) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            options.onToolUse(block.name, block.input as Record<string, unknown>);
          }
        }
      } else if (message.type === 'result') {
        costUsd = message.total_cost_usd;
        if (message.subtype === 'success' && message.is_error) {
          throw new ClaudeError(`Claude API error: ${message.result}`, costUsd);
        }
        if (message.subtype === 'success') {
          return { text: message.result, structured: message.structured_output, costUsd };
        }
        const reason =
          message.subtype === 'error_max_budget_usd'
            ? `hit the $${options.budgetUsd.toFixed(2)} budget for this step`
            : message.subtype === 'error_max_turns'
              ? 'ran out of turns'
              : message.subtype === 'error_max_structured_output_retries'
                ? 'could not produce valid structured output'
                : (message.errors?.join('; ') ?? 'failed during execution');
        throw new ClaudeError(`Claude ${reason}`, costUsd);
      }
    }
  } catch (error) {
    if (error instanceof ClaudeError) throw error;
    if (options.signal?.aborted) throw new ClaudeError('Cancelled', costUsd);
    throw new ClaudeError(explain(error), costUsd);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
  throw new ClaudeError('Claude ended without a result', costUsd);
}

/** Free-form text (used for the draft, streamed token by token). */
export async function generateText(options: BaseOptions): Promise<ClaudeResult<string>> {
  const { text, costUsd } = await run(options);
  return { output: text, costUsd };
}

/** Schema-validated JSON via the SDK's native structured outputs. */
export async function generateObject<T extends z.ZodType>(
  options: BaseOptions & { schema: T },
): Promise<ClaudeResult<z.infer<T>>> {
  const schema = z.toJSONSchema(options.schema, { target: 'draft-7' }) as Record<string, unknown>;
  const { structured, costUsd } = await run(options, { type: 'json_schema', schema });
  const parsed = options.schema.safeParse(structured);
  if (!parsed.success) {
    throw new ClaudeError(`Structured output failed validation: ${parsed.error.message}`, costUsd);
  }
  return { output: parsed.data, costUsd };
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/api key|authentication|401|login/i.test(message)) {
    return 'Claude authentication failed. Set ANTHROPIC_API_KEY (see `leo doctor`).';
  }
  return message;
}
