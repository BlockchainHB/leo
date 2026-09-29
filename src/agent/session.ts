import { type Query, query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PipelineEvent } from '../core/events';
import type { Project } from '../core/project';
import { isolatedOptions } from '../pipeline/claude';
import { createLeoTools } from './tools';

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'text-done' }
  | { type: 'tool'; name: string; input: Record<string, unknown> }
  | { type: 'pipeline'; event: PipelineEvent }
  | { type: 'turn-end'; costUsd: number }
  | { type: 'error'; message: string };

function systemPrompt(project: Project): string {
  const { blog, publish } = project.config;
  return `You are Leo, a research-first content strategist and writer working in the user's terminal.
Today is ${new Date().toISOString().slice(0, 10)}.

You work for ${blog.name}, a publication about ${blog.niche} for ${blog.audience}.
Voice: ${blog.voice}. Articles publish to ${publish.provider === 'sanity' ? 'Sanity (as drafts)' : 'local markdown files'}.

What you can do:
- Brainstorm topics and keywords. Use WebSearch to check what's actually ranking and current.
- write_article runs the full pipeline (research, competitor analysis, brief, draft, images).
  It costs real money, so only run it when the user asks for an article or agrees to one.
- read_article, list_articles, publish_article, queue_keywords, list_queue.

Style: this is a terminal. Be brief and concrete. Plain sentences, short lists when useful,
no headings, no emoji. After write_article finishes, summarize in two lines and suggest one
next step. Never publish without the user's explicit go-ahead.`;
}

/** Lets us push user turns into a single long-lived streaming query. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(text: string) {
    this.pending.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    });
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      const next = this.pending.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }
}

export class ChatSession {
  private readonly inbox = new Inbox();
  private readonly query: Query;
  private pipelineController = new AbortController();

  constructor(
    project: Project,
    private readonly onEvent: (event: ChatEvent) => void,
  ) {
    const leo = createLeoTools(project, {
      emit: (event) => onEvent({ type: 'pipeline', event }),
      signal: () => this.pipelineController.signal,
    });

    this.query = query({
      prompt: this.inbox,
      options: {
        model: project.config.models.analyst,
        systemPrompt: systemPrompt(project),
        tools: ['WebSearch', 'WebFetch'],
        mcpServers: { leo },
        allowedTools: ['WebSearch', 'WebFetch', 'mcp__leo__*'],
        permissionMode: 'dontAsk',
        includePartialMessages: true,
        cwd: project.root,
        ...isolatedOptions(),
      },
    });
    void this.pump();
  }

  send(text: string) {
    if (this.pipelineController.signal.aborted) this.pipelineController = new AbortController();
    this.inbox.push(text);
  }

  async interrupt() {
    this.pipelineController.abort(new Error('Cancelled'));
    await this.query.interrupt().catch(() => {});
  }

  close() {
    this.pipelineController.abort();
    this.inbox.close();
    this.query.close();
  }

  private async pump() {
    try {
      for await (const message of this.query) {
        if (message.type === 'stream_event' && message.parent_tool_use_id === null) {
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            this.onEvent({ type: 'text', text: event.delta.text });
          } else if (event.type === 'content_block_stop') {
            this.onEvent({ type: 'text-done' });
          }
        } else if (message.type === 'assistant' && message.parent_tool_use_id === null) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use') {
              this.onEvent({
                type: 'tool',
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
            }
          }
        } else if (message.type === 'result') {
          if (message.subtype !== 'success') {
            this.onEvent({ type: 'error', message: message.errors?.join('; ') || message.subtype });
          }
          this.onEvent({ type: 'turn-end', costUsd: message.total_cost_usd });
        }
      }
    } catch (error) {
      this.onEvent({ type: 'error', message: (error as Error).message });
    }
  }
}
