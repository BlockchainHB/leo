import type { LeoConfig } from '../core/config';
import type { ResearchNote, SearchResult } from '../providers/types';
import type { PageSummary } from './analyze';
import type { Brief } from './schemas';

const today = () => new Date().toISOString().slice(0, 10);

function blogContext(config: LeoConfig): string {
  const { blog, writing } = config;
  return [
    `Blog: ${blog.name}${blog.url ? ` (${blog.url})` : ''}`,
    `Niche: ${blog.niche}`,
    `Audience: ${blog.audience}`,
    `Voice: ${blog.voice}`,
    `Point of view: ${writing.pointOfView}`,
  ].join('\n');
}

export const RESEARCH_SYSTEM = `You are a meticulous research assistant. Today is ${today()}.
Use web search to find current, specific, verifiable information. Prefer primary sources,
official documentation, and recent data. Every answer must be grounded in sources you actually
opened, and include their URLs. Never invent statistics.`;

export function researchPrompt(keyword: string, config: LeoConfig): string {
  return `Research "${keyword}" for an article aimed at: ${config.blog.audience}.

Answer these three questions, one note each:
1. What are the most important current facts, numbers, and recent changes about ${keyword}?
2. What do people most often get wrong or struggle with regarding ${keyword}?
3. What practical, expert-level advice or examples exist for ${keyword}?`;
}

export const BRIEF_SYSTEM = `You are a senior SEO content strategist. Today is ${today()}.
You turn search data, competitor structure, and research into a brief a great writer can execute.
You care about search intent, genuine information gain over competitors, and factual accuracy.
Only cite facts that appear in the provided research, with their exact URLs.`;

export function briefPrompt(input: {
  keyword: string;
  config: LeoConfig;
  serp: SearchResult[];
  competitors: PageSummary[];
  research: ResearchNote[];
}): string {
  const { keyword, config, serp, competitors, research } = input;
  const avgWords = competitors.length
    ? Math.round(competitors.reduce((s, c) => s + c.wordCount, 0) / competitors.length)
    : 0;

  return `Create a content brief for the keyword: "${keyword}"

<blog>
${blogContext(config)}
${config.categories.length ? `Categories (pick one): ${config.categories.join(', ')}` : ''}
</blog>

<serp>
${serp.map((r) => `${r.position}. ${r.title} (${r.domain})\n   ${r.description}`).join('\n') || 'No SERP data available.'}
</serp>

<competitors avg_words="${avgWords}">
${
  competitors
    .map(
      (c) =>
        `## ${c.title || c.url} (${c.url})\nwords: ${c.wordCount}, faq: ${c.hasFaq}\n${c.headings
          .map((h) => `${'  '.repeat(h.level - 2)}- ${h.text}`)
          .join('\n')}`,
    )
    .join('\n\n') || 'No competitor pages could be read.'
}
</competitors>

<research>
${research
  .map(
    (n) =>
      `### ${n.query}\n${n.answer}\nSources:\n${n.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}`,
  )
  .join('\n\n')}
</research>

<internal_links>
${config.internalLinks.map((l) => `- ${l.title}: ${l.url} (${l.topics.join(', ')})`).join('\n') || 'None.'}
</internal_links>

Guidance:
- Match the dominant search intent you see in the SERP.
- Cover what every competitor covers, then add at least two genuine gaps.
- ${config.writing.targetWords ? `Target exactly ${config.writing.targetWords} words.` : `Set targetWords around 10-20% above the competitor average${avgWords ? ` (${avgWords})` : ''}, rounded, and never pad.`}
- ${config.writing.includeFaq ? 'Include 4-6 FAQs people actually ask.' : 'Return an empty faqs array.'}`;
}

export function writerSystem(config: LeoConfig): string {
  const { writing } = config;
  return `You are an expert writer for ${config.blog.name}. Today is ${today()}.

${blogContext(config)}

House rules:
- Open with a two-to-three sentence hook that names the reader's problem. No throat-clearing.
- Short paragraphs (two to four sentences). Use lists only where they aid scanning.
- Be specific: numbers, names, examples, steps. Cut anything generic.
- Cite facts inline as markdown links to their source URL, e.g. [according to Stripe](https://...).
- Avoid: ${writing.avoid.join('; ')}.
${writing.rules.map((r) => `- ${r}`).join('\n')}
- Output only the article body in markdown. Start with the first paragraph. No title, no H1,
  no frontmatter, no image placeholders, no closing commentary.`;
}

export function writerPrompt(keyword: string, brief: Brief, config: LeoConfig): string {
  return `Write the article for "${keyword}" from this brief.

Title (for context only, do not repeat it): ${brief.title}
Angle: ${brief.angle}
Target length: about ${brief.targetWords} words

Outline (use these as the H2s, in order):
${brief.outline
  .map(
    (s) =>
      `## ${s.heading}\n${s.points.map((p) => `- ${p}`).join('\n')}${
        s.facts.length
          ? `\nFacts to use:\n${s.facts.map((f) => `- ${f.fact} (${f.url})`).join('\n')}`
          : ''
      }`,
  )
  .join('\n\n')}

Gaps to cover that competitors miss: ${brief.gaps.join('; ') || 'none noted'}
${brief.faqs.length && config.writing.includeFaq ? `\nEnd with an "## FAQ" section answering, as ### subheadings:\n${brief.faqs.map((q) => `- ${q}`).join('\n')}` : ''}
${brief.internalLinks.length ? `\nWork these internal links in naturally where they help the reader:\n${brief.internalLinks.map((l) => `- [${l.anchor}](${l.url})`).join('\n')}` : ''}`;
}

export const IMAGE_SYSTEM = `You are an art director for a publication. You write image-generation
prompts that illustrate ideas clearly, never contain rendered text, and share one consistent style.`;

export function imagePrompt(title: string, headings: string[], config: LeoConfig): string {
  return `Plan illustrations for the article "${title}".

House style for every prompt: ${config.images.style}
Hero: 16:9, captures the article's core idea.
Sections: pick the ${config.images.sections} H2s below that benefit most from a visual (skip FAQ).
Use each heading's exact text.

H2s:
${headings.map((h) => `- ${h}`).join('\n')}`;
}
