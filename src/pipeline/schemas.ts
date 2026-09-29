import { z } from 'zod';

export const ResearchSchema = z.object({
  notes: z
    .array(
      z.object({
        query: z.string().describe('The question this note answers'),
        answer: z.string().describe('A dense, factual answer with specific numbers and dates'),
        sources: z.array(z.object({ url: z.string(), title: z.string() })),
      }),
    )
    .min(1),
});

export const BriefSchema = z.object({
  title: z.string().describe('Compelling title under 65 characters that contains the keyword'),
  searchIntent: z.enum(['informational', 'commercial', 'transactional', 'navigational']),
  angle: z
    .string()
    .describe('The one-sentence argument that makes this piece better than what ranks'),
  targetWords: z.number().int().min(600).max(6000),
  description: z.string().describe('Meta description, 140 to 160 characters'),
  excerpt: z.string().describe('Two-sentence summary for cards and social'),
  category: z.string().optional(),
  outline: z
    .array(
      z.object({
        heading: z.string().describe('H2 text, phrased the way a reader would ask or scan for it'),
        points: z.array(z.string()).min(1).describe('What this section must cover'),
        facts: z
          .array(z.object({ fact: z.string(), url: z.string() }))
          .describe('Sourced facts to use in this section, taken only from the research'),
      }),
    )
    .min(3)
    .max(10),
  gaps: z.array(z.string()).describe('What competitors miss that this article will cover'),
  faqs: z.array(z.string()).describe('Real questions to answer in an FAQ section'),
  internalLinks: z
    .array(z.object({ url: z.string(), anchor: z.string() }))
    .describe('Internal links from the provided list that genuinely fit'),
});
export type Brief = z.infer<typeof BriefSchema>;

export const ImagePlanSchema = z.object({
  hero: z.object({
    prompt: z.string().describe('Image prompt: subject, composition, style. No text in the image.'),
    alt: z.string().describe('Descriptive alt text under 125 characters'),
  }),
  sections: z.array(
    z.object({
      heading: z.string().describe('Exact H2 text from the article'),
      prompt: z.string(),
      alt: z.string(),
    }),
  ),
});
export type ImagePlan = z.infer<typeof ImagePlanSchema>;
