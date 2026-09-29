# Leo v1 audit (September 2026)

Leo v1 (January 2026, `@anthropic/leo@0.1.0`) was a working prototype on its author's machine. It
was not a working product. This is the audit that led to the v2 rewrite. The findings are ordered
by how badly they hurt a real user.

## 1. It could not work after `npm install`

| Finding | Evidence | Effect |
|---|---|---|
| The agent's tools were shell commands like `cd ${PROJECT_ROOT} && npx tsx src/cli/perplexity-search.ts` | `src/agent.ts` system prompt and subagent prompts | `package.json#files` shipped only `dist/`. `src/` wasn't published and `tsx` was a devDependency, so every research, scrape, SERP, and publish step failed on a clean install. |
| The system prompt pointed at files that didn't exist | `src/servers/cms/insertImages.js`, `src/servers/cms/sanity/publishDraft.ts` (the real ones are under `src/servers/sanity/`) | Image insertion and Sanity publishing failed even from a source checkout. |
| Skills, slash commands and hooks lived in the package's `.claude/`, but were loaded with `settingSources: ['project']` relative to the user's cwd | `src/agent.ts` | None of them loaded for users, and the prompt referenced skills (`cms-operations`, `keyword-queue`) that never existed. |
| `npm test` pointed at a missing file | `"test": "tsx src/tests/context-bar.test.ts"`; `src/tests/` was empty | No tests at all. |
| Published under `@anthropic/leo`, author "Anthropic" | `package.json` | The package couldn't be published under a scope the author doesn't own, and it misrepresented who made it. |

## 2. External APIs had drifted or broken

| Service | v1 | Status in Sept 2026 |
|---|---|---|
| Perplexity | `POST /chat/completions` with `model: "sonar"` | **Sonar Chat Completions support ended 2026-09-27.** Requests are being migrated to the Agent API (`/v1/agent`). |
| Firecrawl | `/v1/scrape` with `formats: ['markdown','html','rawHtml']` | v2 is current. v1 fetched three copies of every page, and rawHtml was used only for regex schema sniffing. |
| OpenRouter images | Chat completions with `modalities: ['image','text']` | The Image API (`/api/v1/images`, June 2026) is where new models ship. |
| Agent SDK | `@anthropic-ai/claude-agent-sdk@^0.1.0` | 0.3.x. Zod 4 peer, V2 session API removed, `settingSources` defaults changed, `Skill` in `allowedTools` deprecated. |
| Sanity client | v6 | v8 (ESM-only, Node 22.12+). |
| Ink | 6, plus `ink-spinner`, `ink-text-input`, `ink-big-text` (all unmaintained) | Ink 7 ships `useAnimation`, `useWindowSize`, `usePaste` natively. |

## 3. Architecture: an LLM doing a script's job

v1 used an orchestrator agent that asked subagents to call shell scripts and then hand-write JSON
files for the next subagent to read.

- **Unreliable.** Every hop between two pieces of code went through a model writing a file, so one
  mis-typed key broke the next phase. The prompt had to include "ALWAYS Read before Write" rules
  just to stop overwrites.
- **Expensive.** A model was paid to run `ls`, `pwd`, and `cat leo.config.json` at the start of
  every session (the "CRITICAL: Initialization Phase"). A model was also paid to count headings
  and average word counts.
- **Unsafe.** It ran `permissionMode: 'bypassPermissions'` with unrestricted `Bash`, `Write` and
  `Edit`, in whatever directory the user launched it from.
- **Not resumable.** Progress lived in the conversation, so a crash at step 6 of 7 meant starting
  over.

## 4. Correctness bugs

- **Wrong streaming handler.** Streaming read `msg.stream_type` / `msg.content`, fields the SDK
  never sends (it sends `event: BetaRawMessageStreamEvent`), and `includePartialMessages` was
  never enabled. Nothing streamed.
- **Misattributed tool calls.** Tool calls were assigned to subagents with a "current subagent"
  flag instead of `parent_tool_use_id`. Parallel subagents scrambled the UI.
- **False 404s.** The scraper flagged pages as `not_found` when their text contained the
  substring "404" or "not found", so every article about fixing 404 errors was discarded.
- **Timeouts reported as success.** A 30-minute global timeout aborted the whole session. The
  resulting `AbortError` surfaced as success, because `result` messages with error subtypes other
  than `error_during_execution` were ignored.
- **Fake MCP client.** `client.ts` described a "Code Execution pattern" MCP client, but
  `callMCPTool` only `console.log`ged its input and returned a placeholder.
- **Default config overwrote the user's.** `mergeWithDefaults` spread `DEFAULT_CONFIG` over nested
  objects inconsistently, and there was no schema validation.
- **Dead or user-specific integrations.** Ahrefs code was unused. The Supabase queue expected one
  specific private table schema (`keyword_queue` with `roi`, `bv`).

## 5. What v2 changes

| Area | v2 |
|---|---|
| Architecture | Deterministic pipeline, with Claude only where judgment is needed (brief, draft, image direction, and research when no research API is set). Each stage checkpoints to `.leo/runs/<slug>/` and resumes. |
| Agent SDK | 0.3.x. Isolated calls (no user settings, connectors, hooks or memory), native structured outputs validated with Zod 4, `maxBudgetUsd` per call, real token streaming. |
| Safety | No Bash, no file-writing tools. Pipeline calls get either no tools or `WebSearch`/`WebFetch`. Chat gets Leo's own typed MCP tools, with `permissionMode: 'dontAsk'`. |
| Providers | Only Claude is required. DataForSEO → Firecrawl search → Claude web search. Firecrawl → built-in fetch. Perplexity Agent API → Claude web search. OpenRouter Image API → skip. |
| CLI | Commander 15 subcommands, `--json` NDJSON event stream, plain output when piped, meaningful exit codes (0 / 1 / 130), `leo doctor`. |
| TUI | Ink 7 + React 19. One event stream drives the TUI, plain logs and JSON. |
| Tooling | TypeScript 7, tsdown, Vitest 5 (24 tests, including resume and budget), Biome 2, Node ≥ 22.12. |

One issue only surfaced while testing v2 against a real machine. The Agent SDK subprocess inherits
the user's Claude Code environment by default: claude.ai connectors, synced skills and plugins,
hooks, and memory. On the author's machine that added about 209K tokens of tool definitions to a
two-line prompt, and Haiku rejected it as too long. `isolatedOptions()` in
`src/pipeline/claude.ts` turns all of that off, and a test pins it.
