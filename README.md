<p align="center">
  <img src="https://img.shields.io/npm/v/@anthropic/leo.svg" alt="npm version">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
</p>

```
██╗     ███████╗ ██████╗
██║     ██╔════╝██╔═══██╗
██║     █████╗  ██║   ██║
██║     ██╔══╝  ██║   ██║
███████╗███████╗╚██████╔╝
╚══════╝╚══════╝ ╚═════╝
```

**Leo** is a terminal based content agent. One command researches your topic, analyzes competitors, writes SEO-optimized content, generates images, and publishes to your CMS.

```bash
npm install -g @anthropic/leo
leo write "how kubernetes autoscaling actually works"
```

## How It Works

Leo is built on the [Claude Agents SDK](https://github.com/anthropics/claude-agent-sdk). A main orchestrator agent coordinates specialized subagents—each focused on one task—running up to 4 in parallel. The orchestrator has access to MCP tools (Ahrefs, Perplexity, Firecrawl, Sanity) while subagents work through CLI scripts, creating clean separation between coordination and execution.

**The pipeline:**
1. **SERP Analysis** — Pull top 10 ranking pages via DataForSEO
2. **Parallel Research** — Web researcher + competitor scrapers run simultaneously
3. **Competitive Analysis** — Identify content gaps, structural patterns, target word counts
4. **Content Generation** — Write with full context: competitor data, fresh research, your brand voice
5. **Image Creation** — Generate visuals with proper alt text and semantic relevance
6. **Publishing** — Push to Sanity CMS or export as local markdown

## Why Leo?

Most AI writing tools generate words. Leo generates *informed* content.

The difference: before writing a single paragraph, Leo knows what's ranking, what competitors cover, what they miss, and what your audience actually needs. It's working with real SERP data and fresh web research—not hallucinating plausible-sounding information.

Your brand voice isn't a suggestion. It's a requirement loaded from `leo.config.json` that the content writer agent must satisfy. Every article reflects your niche, audience, and tone.

---

## Architecture Deep Dive

### The Orchestrator

At the center sits Leo itself—the main agent. Think of it as the editor-in-chief. It doesn't write the articles or scrape the websites. Instead, it:

- Manages the workflow pipeline
- Spawns specialized subagents for each phase
- Coordinates parallel operations (up to 4 agents at once)
- Maintains state across the entire session
- Has exclusive access to MCP tools (more on this below)

The orchestrator pattern matters because it means Leo can **think strategically** while delegating tactical work. It decides *what* needs to happen; subagents figure out *how*.

### The Subagent Army

When Leo needs work done, it spawns purpose-built subagents:

**Web Researcher** — Queries Perplexity for current information, statistics, and trends. This is how Leo knows what happened last week, not just what's in its training data.

**Competitor Scraper** — Uses Firecrawl to extract content from top-ranking pages. Not to copy—to understand. What are they covering? What's their structure? What are they missing?

**Competitor Analyzer** — Takes scraped content and identifies patterns: common headers, content gaps, unique angles, word counts that correlate with rankings.

**Content Writer** — The actual wordsmith. But unlike a standalone writing AI, this agent receives a comprehensive brief: competitor analysis, current data, user's brand voice, target keywords, and structural requirements.

**Image Creator** — Generates image specifications with proper alt text, captions, and semantic relevance. Not random stock photos—intentional visuals that reinforce the content.

Here's the key: **subagents don't have MCP access.** They can't call external services directly. They work through CLI scripts that Leo provides, creating a clean separation between orchestration and execution.

### The MCP Tools Layer

Leo's power comes from its Model Context Protocol integrations. These are the external services that make research-grade content possible:

**DataForSEO** — SERP analysis. When you give Leo a keyword, it doesn't guess what's ranking. It pulls the actual top 10, analyzes their content, and understands the competitive landscape.

**Perplexity** — Real-time web research. Training data has a cutoff. The web doesn't. This is how Leo writes about things that happened yesterday.

**Firecrawl** — Structured web scraping. Competitor pages become structured data: headings, word counts, internal links, content organization.

**OpenRouter** — Image generation. When Leo needs visuals, it generates proper specifications and creates images that match the content.

**Sanity CMS** — Publishing pipeline. Draft to scheduled to published, with proper metadata and asset management.

The MCP layer is why Leo produces content that feels researched rather than generated. It's working with real data, not hallucinating plausible-sounding information.

---

## The Workflow Pipeline

When you run `leo write "your keyword"`, here's what actually happens:

### Phase 1: SERP Intelligence

Leo queries DataForSEO for the current search landscape. Not just URLs—full competitive intelligence:

- Top 10 ranking pages
- Their word counts and structures
- Featured snippets and People Also Ask
- Content freshness signals

This takes about 3 seconds and gives Leo a complete picture of what it's competing against.

### Phase 2: Parallel Research Sprint

Now Leo spawns multiple subagents simultaneously:

```
┌─────────────────────────────────────────────────────────┐
│                    LEO ORCHESTRATOR                      │
│                         │                                │
│    ┌───────────────────┴────────────────────┐           │
│    │          PARALLEL EXECUTION            │           │
│    │                                        │           │
│    │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│    │  │   Web    │  │Competitor│  │Competitor│        │
│    │  │Researcher│  │ Scraper  │  │ Scraper  │        │
│    │  │  (news)  │  │ (url #1) │  │ (url #2) │        │
│    │  └──────────┘  └──────────┘  └──────────┘        │
│    │                                        │           │
│    └────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

The web researcher queries Perplexity for current information. Simultaneously, competitor scrapers pull content from the top-ranking pages. This parallelization means research that would take 10 minutes sequentially happens in under 2.

### Phase 3: Competitive Analysis

The analyzer subagent receives all scraped content and produces a structured brief:

- Common topics covered by all competitors
- Unique angles only one or two pages mention
- Content gaps—things searchers want but no one's addressing
- Structural patterns—H2 usage, list frequency, code block presence
- Average and target word counts

This brief becomes the strategic foundation for writing.

### Phase 4: Content Generation

Now the content writer goes to work. But it's not starting from nothing. It has:

- The competitive analysis brief
- Fresh research from Perplexity
- Your brand voice from `leo.config.json`
- Target keywords and semantic variations
- Structural requirements based on what's ranking

The result is content that's informed by data, not just generated by probability.

### Phase 5: Visual Assets

The image creator generates specifications for each required visual:

- Hero image with semantic relevance to the content
- Section illustrations that reinforce key points
- Proper alt text for accessibility and SEO
- Captions that add context rather than repeat the obvious

Images are generated through OpenRouter with specifications that match your brand.

### Phase 6: Publishing

Final content flows to your CMS. If you're using Sanity, it goes directly into your content studio with proper metadata, categories, and scheduling. If you're using local mode, you get clean markdown in your `drafts/` folder.

---

## State Management and Caching

Content creation isn't always a single session. Leo maintains state across interruptions:

**`blog-progress.json`** — Tracks every keyword's status through the pipeline:
```
pending → in_progress → drafted → scheduled → published
```

**`drafts/{slug}.md`** — Article content persisted immediately after generation

**`drafts/{slug}-images.json`** — Image specifications and metadata

**`leo.config.json`** — Your blog's DNA: brand voice, target audience, CMS configuration

This means you can:
- Start an article, close your laptop, and resume later
- Queue up 50 keywords and process them over days
- Review drafts before publishing
- Regenerate images without regenerating content

The one-in-progress rule is important: Leo only works on one keyword at a time. This isn't a limitation—it's intentional. Content quality requires focus, even for AI systems.

---

## Configuration: Teaching Leo Your Voice

Leo adapts to your brand through `leo.config.json`:

```json
{
  "blog": {
    "name": "Your Blog",
    "niche": "developer tools",
    "targetAudience": "senior engineers building distributed systems",
    "brandVoice": "technically precise, occasionally irreverent, never dumbed-down",
    "baseUrl": "https://yourblog.dev"
  },
  "cms": {
    "provider": "sanity",
    "sanity": {
      "projectId": "your-project-id",
      "dataset": "production"
    }
  },
  "author": {
    "name": "Your Name"
  }
}
```

Every piece of generated content references this configuration. The brand voice isn't a suggestion—it's a requirement that the content writer agent must satisfy.

---

## Getting Started

### Installation

```bash
npm install -g @anthropic/leo
```

### First Run

```bash
leo
```

Leo launches an interactive onboarding that configures your API keys and blog settings. Orange accents, because we have taste.

### Writing Your First Article

```bash
leo write "your target keyword"
```

Watch the pipeline execute: SERP analysis, parallel research, competitive analysis, content generation, image creation.

### Queue Management

```bash
leo queue add "keyword one"
leo queue add "keyword two"
leo queue status
leo write next
```

Build up a backlog and process it systematically.

### Publishing

```bash
leo publish article-slug
```

Push a draft to your CMS or export clean markdown.

---

## Command Reference

**CLI Commands**

| Command | What it does |
|---------|--------------|
| `leo` | Interactive mode with full UI |
| `leo write [keyword]` | Research and write an article |
| `leo write next` | Process next queued keyword |
| `leo queue add "kw"` | Add keyword to queue |
| `leo queue status` | Show queue statistics |
| `leo settings` | Reconfigure API keys |
| `leo reset` | Start fresh |

**Interactive Commands**

| Command | What it does |
|---------|--------------|
| `/write-blog [keyword]` | Full research and write workflow |
| `/queue-status` | View pending keywords |
| `/publish [slug]` | Publish to CMS |
| `/cost` | Session cost breakdown |
| `/clear` | Clear conversation |

---

## Required API Keys

| Key | What it enables | Required |
|-----|-----------------|----------|
| `ANTHROPIC_API_KEY` | LLM orchestration | Yes |
| `DATAFORSEO_LOGIN` | SERP intelligence | No |
| `DATAFORSEO_PASSWORD` | SERP intelligence | No |
| `PERPLEXITY_API_KEY` | Real-time research | No |
| `FIRECRAWL_API_KEY` | Competitor scraping | No |
| `OPENROUTER_API_KEY` | Image generation | No |
| `SANITY_API_KEY` | CMS publishing | No |

Leo works with just an Anthropic key, but each additional integration unlocks more capability. The full stack produces research-grade content; the minimal stack produces good-enough drafts.

---

## Why This Matters

We're past the point of arguing whether AI can write. It can. The question now is whether AI can write *well*—content that's researched, accurate, strategically positioned, and genuinely useful.

Most AI writing tools fail this test because they're solving the wrong problem. They optimize for word generation when they should optimize for value creation.

Leo approaches content the way a well-run publication does:

1. **Research before writing.** Never generate without data.
2. **Understand the competition.** Know what you're up against.
3. **Specialize roles.** Researchers research; writers write.
4. **Maintain editorial standards.** Brand voice isn't optional.
5. **Publish systematically.** Queue, draft, review, ship.

This is what agentic AI looks like when it's designed for outcomes rather than demos.

---

## Development

```bash
git clone https://github.com/BlockchainHB/leo.git
cd leo
npm install
npm run dev
```

The codebase is TypeScript throughout, using Ink for the terminal UI and the Claude Agent SDK for orchestration.

---

## License

MIT

---

<p align="center">
  Built by <a href="https://x.com/hasaamb">@hasaamb</a>
</p>
