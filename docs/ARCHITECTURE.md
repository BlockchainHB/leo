# Architecture

Leo has one job: turn a keyword into an article that is better informed than what already ranks for it, without surprising you on cost or safety. This document explains how the code is organized around that job, and the decisions behind it.

## Layers

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Front ends          cli.ts (commander) · ui/ (Ink) · reporters for tui,  │
│                     plain and json · agent/ (chat + Leo's own tools)     │
├──────────────────────────────────────────────────────────────────────────┤
│ Pipeline            run.ts (stages) · claude.ts (Agent SDK wrapper) ·    │
│                     prompts · schemas (zod) · analyze · publish          │
├──────────────────────────────────────────────────────────────────────────┤
│ Providers           dataforseo · firecrawl · fetch-page · perplexity ·   │
│                     openrouter · sanity                                  │
├──────────────────────────────────────────────────────────────────────────┤
│ Core                config (zod) · events · runs (checkpoints) · queue · │
│                     http (retry, backoff) · article · text               │
└──────────────────────────────────────────────────────────────────────────┘
```

Dependencies only point downward. **Core** has no knowledge of Claude, providers or the terminal, which is why most of it is tested as plain functions. **Providers** are thin, typed HTTP clients that all go through `core/http.ts` for timeouts, retries and `Retry-After`. The **pipeline** decides what to call and when, and the **front ends** only consume events.

## A pipeline, not one big agent

The obvious design for a writing agent is a single orchestrator that plans, calls tools, and hands work to subagents. Leo deliberately doesn't do that.

Most of the work has a known path: search, fetch the top pages, count their headings, assemble a file. A model adds cost, latency and variance to those steps and nothing else. So they run as plain TypeScript, and Claude is called only where judgment is the product:

| Step | Model | Why a model |
| --- | --- | --- |
| Content brief | Sonnet, structured output | Choosing the angle, the outline and the gaps is the core editorial decision |
| Draft | Opus, streamed | Writing |
| Image direction | Haiku, structured output | Turning headings into consistent, text-free prompts |
| Research (fallback) | Sonnet with `WebSearch` and `WebFetch` | Only when no research API is configured |
| Search results (fallback) | Haiku with `WebSearch` | Only when neither DataForSEO nor Firecrawl is configured |

Each of these is one small, isolated `query()` call in [`src/pipeline/claude.ts`](../src/pipeline/claude.ts). `generateObject()` passes a zod schema as the SDK's native `outputFormat` and validates the result, so downstream code gets typed data instead of parsing prose. `generateText()` streams token deltas for the live draft preview.

## Isolation

The Agent SDK runs Claude Code as its engine, and by default that engine loads the user's own Claude Code environment: claude.ai connectors, synced skills and plugins, hooks and memory. On a machine with many connectors that attached roughly 209K tokens of tool definitions to a two-line prompt, enough for Haiku to reject the request.

`isolatedOptions()` turns all of it off: `settingSources: []`, `strictMcpConfig`, and inline settings that disable connectors, skill and plugin sync, hooks and auto-memory. Pipeline calls also set `persistSession: false` and `permissionMode: 'dontAsk'`, and they enable only the tools that step needs, usually none. A test pins these options so they can't regress quietly.

## Checkpoints and resume

A run lives in `.leo/runs/<slug>/`:

```
run.json          stage status, summaries, durations and cost
serp.json         search results
research.json     research notes with sources
competitors.json  structure of each readable competitor page
brief.json        the validated brief
draft.md          the raw draft
images/ + images.json
article.md        the assembled article with frontmatter
```

Every write is atomic (write to `.tmp`, then rename). Before running a stage, the pipeline checks whether that stage is marked done *and* its artifact exists. If so, it loads the artifact and emits a `cached` event instead of calling anything. That makes crashes, Ctrl+C and budget stops cheap: the next run pays only for what's left. `--fresh` ignores the cache.

## Budgets

`budgetUsd` (default $3, or `--budget`) is a ceiling on Claude spend for one article. Before each stage the pipeline checks what's left, and every Claude call gets `maxBudgetUsd` set to that remainder. If the SDK reports `error_max_budget_usd`, the stage fails with a clear message and the run can be resumed with a higher budget. Research gets at most half of what's left, so a long web search can't starve the draft.

## Fallbacks

Every provider is optional except Claude. `hasProvider()` checks the environment, and each stage tries providers in order of quality:

- **Search results:** DataForSEO, then Firecrawl search, then Claude web search.
- **Competitor pages:** Firecrawl, then the built-in fetcher (`providers/fetch-page.ts`), which extracts headings and text from server-rendered HTML with no dependencies.
- **Research:** three Perplexity Agent API queries in parallel, then Claude web search if all of them fail or no key is set.

Pages that come back too thin to analyze (under 250 words or fewer than two headings) are dropped rather than fed to the brief as noise.

## Events and front ends

The pipeline never prints. It emits a typed `PipelineEvent` stream (`run:start`, `stage:start`, `stage:progress`, `stage:done`, `stage:skip`, `stage:error`, `draft:delta`, `cost`, `run:done`, `run:error`) through an `emit` function passed in by the caller.

- **TUI** (`ui/reporters.tsx`): a pure reducer (`ui/run-state.ts`) folds events into a view, rendered with Ink 7 and `useSyncExternalStore`.
- **Plain** output is used automatically when stdout isn't a TTY or `CI` is set.
- **JSON** (`--json`) writes one event per line, skipping draft deltas.
- **Chat** (`agent/`) exposes the pipeline as an in-process MCP tool, `write_article`. Its events are forwarded into the chat UI, so a run started from a conversation renders exactly like one started from the command line.

## Chat mode

`leo` with no arguments opens a single long-lived streaming `query()` fed by an async iterable of user turns. The agent has `WebSearch`, `WebFetch` and Leo's own typed tools (`write_article`, `read_article`, `list_articles`, `publish_article`, `queue_keywords`, `list_queue`) and nothing else: no shell, no file edits. The system prompt tells it that `write_article` costs money and publishing needs the user's go-ahead. Escape interrupts the current turn and aborts any running pipeline.

## Publishing

`leo publish` reads `article.md` and either copies it with its images to `content/posts/<slug>/index.md`, or sends it to Sanity. The Sanity path uploads images as assets, converts markdown to Portable Text using `marked`'s lexer (nested marks, links, lists, code blocks and images survive), and writes the post as a draft (`drafts.leo-<slug>`), so a person reviews it before it goes live.

## Testing

`npm test` runs Vitest over three suites:

- **core:** config defaults and error paths, text helpers, frontmatter round-trips, image insertion, linting, the queue, and the isolation options.
- **providers:** HTTP retry behavior, Perplexity response parsing, HTML extraction, page analysis, competitor selection, and markdown to Portable Text.
- **pipeline:** a full run with Claude and fetch mocked, a failure followed by a resume that reuses four stages without new calls, budget enforcement, and a rendered frame of the run panel.

## Prior art

- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (Anthropic), on preferring workflows where the path is known.
- [Command Line Interface Guidelines](https://clig.dev), for output, exit codes and `NO_COLOR` behavior.
