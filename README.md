```
██╗     ███████╗ ██████╗
██║     ██╔════╝██╔═══██╗
██║     █████╗  ██║   ██║
██║     ██╔══╝  ██║   ██║
███████╗███████╗╚██████╔╝
╚══════╝╚══════╝ ╚═════╝
```

**Leo is a research-first writing agent for your terminal.** Give it a keyword. It reads what
currently ranks, researches the topic with sources, finds what competitors miss, writes a draft that
cites its facts, illustrates it, and publishes to Sanity or markdown.

```bash
npm install -g leo-agent
leo init
leo write how to design cli error messages
```

```
◆ leo writing “designing cli error messages”                       $0.29 · 1m 49s

✓ Search results     9 results via Claude web search                      29s
✓ Research           3 notes, 6 sources via Claude web search             25s
✓ Competitor pages   3 read, avg 970 words, 1 unreadable                   1s
✓ Content brief      8 sections, ~1,100 words, 4 gaps                     19s
✓ Draft              1,323 words                                          36s
– Images             disabled

Designing CLI Error Messages: A Practical Guide
1,323 words · $0.29 · .leo/runs/designing-cli-error-messages/article.md

next leo publish designing-cli-error-messages
```

That run is real. The output is in [`examples/`](examples/designing-cli-error-messages.md), along
with the [brief](examples/designing-cli-error-messages.brief.json) it was written from.

## Why it's built this way

**A pipeline where the path is known, an agent where it isn't.** Searching, scraping, counting
headings, and assembling files are deterministic, so they run as plain TypeScript. Claude is called
for the steps that need judgment:

- the brief (what to cover, which gaps to exploit, how long to go),
- the draft,
- art direction for images,
- research, when no research API is configured.

Each of those is one small, isolated [Claude Agent SDK][sdk] call, with a Zod schema for structured
output, a spend cap, and only the tools it needs.

```
 keyword
    │
    ▼
 Search results ── DataForSEO → Firecrawl search → Claude web search
    │
    ├──────────────────────────┐   (parallel)
    ▼                          ▼
 Research                    Competitor pages
 Perplexity Agent API        Firecrawl → built-in fetch
 → Claude web search         structure analysis in code
    │                          │
    └────────────┬─────────────┘
                 ▼
          Content brief ─── Claude Sonnet, structured output (Zod)
                 ▼
               Draft ────── Claude Opus, streamed live
                 ▼
              Images ────── Claude Haiku art direction → OpenRouter Image API
                 ▼
      .leo/runs/<slug>/article.md ──▶ leo publish ──▶ Sanity draft | content/posts/
```

**Every stage checkpoints.** Artifacts land in `.leo/runs/<slug>/` (`serp.json`, `research.json`,
`brief.json`, `draft.md`, and so on). If a run fails or you press Ctrl+C, run the same command again:
finished stages are reused, not paid for twice.

**Only Claude is required.** Every other provider has a fallback. With no keys but a Claude sign-in,
Leo still searches, reads competitors, and writes a sourced article. `leo doctor` shows what's
active.

**Budgets are enforced, not suggested.** Each run has a ceiling (`budgetUsd`, default $3, or
`--budget`). Every Claude call is capped at what's left, and the run stops cleanly before going
over.

**One event stream, three front ends.** The pipeline emits typed events. The Ink TUI, the plain-text
log (used when output is piped), and `--json` NDJSON all consume the same stream. The chat agent
reuses it to show live progress when it starts a run.

**Isolated from your own Claude Code setup.** The Agent SDK runs Claude Code under the hood, which
by default loads your connectors, skills, plugins, hooks, and memory. Leo turns all of that off
(`isolatedOptions()` in [`src/pipeline/claude.ts`](src/pipeline/claude.ts)). On one real machine,
leaving it on attached about 209K tokens of tool definitions to a two-line prompt.

## Commands

| Command | What it does |
|---|---|
| `leo` | Chat. Brainstorm topics, check what ranks, and ask for an article to watch it run live. |
| `leo init` | Create `leo.config.json`, add API keys to `.env`, and update `.gitignore`. |
| `leo write <keyword>` | Run the pipeline. Flags: `--publish`, `--no-images`, `--fresh`, `--budget <usd>`, `--json`. |
| `leo write --queue [n]` | Work through the queue. `--next` does one. |
| `leo queue add "a" "b"` | Queue keywords. Also `queue ls`, `queue rm <id>`, `queue clear [--done]`. |
| `leo publish <slug>` | Publish to Sanity (as a draft for review) or to `content/posts/<slug>/index.md`. |
| `leo runs` | Past articles with status and cost. |
| `leo doctor` | Check Node, config, and providers. Exits non-zero if something's broken. |

Every command accepts `--json`. `leo write --json` streams one event per line:

```bash
leo write --queue 10 --json | jq -c 'select(.type == "run:done") | {slug, words, costUsd}'
```

Exit codes: `0` success, `1` failure, `130` cancelled.

## Configuration

`leo init` writes this for you. Only `blog` is required. Everything else has a default, and the
file is validated with a Zod schema that reports every problem by path.

```jsonc
{
  "blog": {
    "name": "Shipyard",
    "url": "https://shipyard.dev",          // your own pages are skipped as competitors
    "niche": "developer tooling and CLI design",
    "audience": "senior engineers who build internal tools",
    "voice": "direct, opinionated, practical"
  },
  "author": { "name": "Hasaam" },
  "writing": { "pointOfView": "second-person", "includeFaq": true, "avoid": ["em dashes", "delve"], "rules": [] },
  "seo": { "location": "United States", "language": "en", "competitors": 5 },
  "images": { "enabled": true, "model": "google/gemini-3.1-flash-image", "sections": 2 },
  "internalLinks": [{ "title": "Our CLI style guide", "url": "/guides/cli-style", "topics": ["cli", "ux"] }],
  "publish": { "provider": "sanity", "projectId": "abc123", "dataset": "production" },
  "models": { "writer": "claude-opus-5-5", "analyst": "claude-sonnet-5-5", "fast": "claude-haiku-4-5" },
  "budgetUsd": 3
}
```

| Key | Used for | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude | Claude Code sign-in, Bedrock, or Vertex |
| `DATAFORSEO_LOGIN` / `_PASSWORD` | Live Google SERP | Firecrawl search, then Claude web search |
| `FIRECRAWL_API_KEY` | Competitor scraping | Built-in HTML fetch |
| `PERPLEXITY_API_KEY` | Cited research (Agent API) | Claude web search |
| `OPENROUTER_API_KEY` | Images (Image API) | Images skipped |
| `SANITY_API_TOKEN` | Publishing | Local markdown |

## Development

```bash
npm install
npm run dev -- write "test keyword"   # run from source with tsx
npm test                               # vitest: 24 tests, incl. resume + budget
npm run typecheck && npm run lint
npm run build                          # tsdown → dist/cli.mjs
```

```
src/
  cli.ts            commander entry; lazy-loads each command
  commands/         init (clack), write, publish/queue/runs/doctor
  pipeline/         run.ts (stages), claude.ts (SDK wrapper), prompts, schemas, analyze, publish
  providers/        dataforseo, firecrawl, fetch-page, perplexity, openrouter, sanity
  agent/            chat session + Leo's in-process MCP tools
  core/             config (zod), events, runs (checkpoints), queue, http (retry/backoff)
  ui/               Ink components, run-state reducer, reporters (tui | plain | json)
```

Stack: Node ≥ 22.12, TypeScript 7, `@anthropic-ai/claude-agent-sdk` 0.3, Zod 4, Ink 7 + React 19,
Commander 15, @clack/prompts, `@sanity/client` 8, marked, tsdown, Vitest 5, Biome 2.

Leo v2 is a ground-up rewrite. [`docs/AUDIT.md`](docs/AUDIT.md) covers what was wrong with v1 and
why each decision changed.

## License

MIT © Hasaam

[sdk]: https://docs.claude.com/en/docs/agent-sdk/overview
