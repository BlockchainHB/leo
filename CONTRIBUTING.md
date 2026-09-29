# Contributing

Thanks for your interest in Leo. Issues and pull requests are welcome.

## Getting started

1. Clone the repo and run `npm install` (Node 22.12 or later).
2. Run from source with `npm run dev -- <command>`, for example `npm run dev -- doctor`.
3. Run the tests with `npm test`, and check everything with `npm run typecheck && npm run lint`.

To try a real run, make a scratch folder with a `leo.config.json` (or run `leo init` there) and call `npm run dev -- write "some keyword"` from the repo with `--budget 1`. Only Claude is required.

> **Tip:** if installs or builds stall, check whether the checkout is inside an iCloud-synced `~/Documents`. Also note that a shell with `NODE_ENV=production` makes `npm install` skip dev dependencies. Use `npm install --include=dev`.

## Where things live

| Folder | Contents |
| --- | --- |
| `src/core` | Config schema, events, run checkpoints, queue, HTTP retry. No Claude, providers or UI. |
| `src/providers` | Typed clients for DataForSEO, Firecrawl, Perplexity, OpenRouter, Sanity, plus the built-in page fetcher. |
| `src/pipeline` | The stages (`run.ts`), the Agent SDK wrapper (`claude.ts`), prompts, schemas, analysis and publishing. |
| `src/agent` | Chat mode: the streaming session and Leo's in-process MCP tools. |
| `src/ui` | Ink components, the run-state reducer, and the tui, plain and json reporters. |
| `src/commands` | One file per CLI command group. |
| `test` | Vitest suites. |

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before larger changes.

## Guidelines

- **Code where the path is known.** Reach for Claude only when a step needs judgment, and give it a zod schema whenever the output feeds more code.
- **Keep calls isolated.** Every `query()` goes through `src/pipeline/claude.ts` or spreads `isolatedOptions()`. Don't enable tools a step doesn't need.
- **Every stage checkpoints.** New stages write their artifact with `run.writeJson` or `run.writeText` and load it back when cached.
- **Providers are optional.** A new provider needs a fallback, a row in `PROVIDERS` (`src/core/env.ts`), and a line in `leo doctor`.
- **The pipeline never prints.** Emit a `PipelineEvent` and let the reporters render it.
- **No new dependencies** without a strong reason.
- Refresh the README hero with `node scripts/render-hero.mjs` if the TUI output changes.

## Submitting changes

1. Branch from `main`.
2. Make sure `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass.
3. Open a pull request describing the change and how you verified it. For output changes, include the terminal output before and after.

For significant changes, please open an issue first to discuss the approach.
