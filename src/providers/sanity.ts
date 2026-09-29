import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { createClient } from '@sanity/client';
import { lexer, type Token, type Tokens } from 'marked';
import type { Article } from '../core/article';
import { requireEnv } from '../core/env';

type Mark = string;
interface Span {
  _type: 'span';
  _key: string;
  text: string;
  marks: Mark[];
}
interface MarkDef {
  _type: 'link';
  _key: string;
  href: string;
}
export interface PortableBlock {
  _type: string;
  _key: string;
  [field: string]: unknown;
}

const key = () => randomUUID().replace(/-/g, '').slice(0, 12);

/**
 * Markdown → Portable Text using marked's lexer, so nested emphasis, links,
 * lists and code blocks survive instead of being regex-guessed.
 */
export function markdownToPortableText(
  markdown: string,
  resolveImage: (src: string, alt: string) => PortableBlock | null = () => null,
): PortableBlock[] {
  const blocks: PortableBlock[] = [];

  const inline = (tokens: Token[] | undefined, marks: Mark[], defs: MarkDef[]): Span[] => {
    const spans: Span[] = [];
    for (const token of tokens ?? []) {
      switch (token.type) {
        case 'strong':
          spans.push(...inline((token as Tokens.Strong).tokens, [...marks, 'strong'], defs));
          break;
        case 'em':
          spans.push(...inline((token as Tokens.Em).tokens, [...marks, 'em'], defs));
          break;
        case 'codespan':
          spans.push(span((token as Tokens.Codespan).text, [...marks, 'code']));
          break;
        case 'del':
          spans.push(...inline((token as Tokens.Del).tokens, [...marks, 'strike-through'], defs));
          break;
        case 'link': {
          const link = token as Tokens.Link;
          const def: MarkDef = { _type: 'link', _key: key(), href: link.href };
          defs.push(def);
          spans.push(...inline(link.tokens, [...marks, def._key], defs));
          break;
        }
        case 'br':
          spans.push(span('\n', marks));
          break;
        case 'text': {
          const text = token as Tokens.Text;
          if (text.tokens?.length) spans.push(...inline(text.tokens, marks, defs));
          else spans.push(span(decodeEntities(text.text), marks));
          break;
        }
        case 'escape':
          spans.push(span((token as Tokens.Escape).text, marks));
          break;
        default:
          if ('text' in token && typeof token.text === 'string')
            spans.push(span(token.text, marks));
      }
    }
    return spans;
  };

  const textBlock = (
    tokens: Token[] | undefined,
    style: string,
    extra: Record<string, unknown> = {},
  ): PortableBlock => {
    const markDefs: MarkDef[] = [];
    const children = inline(tokens, [], markDefs);
    return {
      _type: 'block',
      _key: key(),
      style,
      markDefs,
      children: children.length ? children : [span('', [])],
      ...extra,
    };
  };

  const walk = (tokens: Token[], level = 1) => {
    for (const token of tokens) {
      switch (token.type) {
        case 'heading': {
          const heading = token as Tokens.Heading;
          blocks.push(textBlock(heading.tokens, `h${Math.min(heading.depth, 6)}`));
          break;
        }
        case 'paragraph': {
          const paragraph = token as Tokens.Paragraph;
          const only = paragraph.tokens?.length === 1 ? paragraph.tokens[0] : undefined;
          if (only?.type === 'image') {
            const image = only as Tokens.Image;
            const block = resolveImage(image.href, image.text);
            if (block) blocks.push(block);
            break;
          }
          blocks.push(textBlock(paragraph.tokens, 'normal'));
          break;
        }
        case 'blockquote':
          for (const child of (token as Tokens.Blockquote).tokens) {
            if (child.type === 'paragraph') {
              blocks.push(textBlock((child as Tokens.Paragraph).tokens, 'blockquote'));
            }
          }
          break;
        case 'list': {
          const list = token as Tokens.List;
          for (const item of list.items) {
            const [first, ...rest] = item.tokens;
            const firstTokens =
              first && 'tokens' in first ? (first.tokens as Token[]) : first ? [first] : [];
            blocks.push(
              textBlock(firstTokens, 'normal', {
                listItem: list.ordered ? 'number' : 'bullet',
                level,
              }),
            );
            const nested = rest.filter((t) => t.type === 'list');
            if (nested.length) walk(nested, level + 1);
          }
          break;
        }
        case 'code': {
          const code = token as Tokens.Code;
          blocks.push({
            _type: 'code',
            _key: key(),
            code: code.text,
            language: code.lang || 'text',
          });
          break;
        }
        case 'table': {
          // Portable Text has no core table type; keep the data readable as a list.
          const table = token as Tokens.Table;
          for (const row of table.rows) {
            const text = row
              .map((cell, i) => `${table.header[i]?.text ?? ''}: ${cell.text}`)
              .join(' · ');
            blocks.push({
              ...textBlock([{ type: 'text', raw: text, text } as Tokens.Text], 'normal'),
              listItem: 'bullet',
              level,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  };

  walk(lexer(markdown));
  return blocks;
}

function span(text: string, marks: Mark[]): Span {
  return { _type: 'span', _key: key(), text, marks };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export interface SanityTarget {
  projectId: string;
  dataset: string;
  postType: string;
  apiVersion: string;
}

/**
 * Uploads images and writes the post as a Sanity *draft* (`drafts.` prefix),
 * so a human always presses Publish in the Studio.
 */
export async function publishToSanity(
  article: Article,
  target: SanityTarget,
  assetsDir: string,
): Promise<{ documentId: string; url: string }> {
  const client = createClient({
    projectId: target.projectId,
    dataset: target.dataset,
    apiVersion: target.apiVersion,
    token: requireEnv('SANITY_API_TOKEN'),
    useCdn: false,
  });

  const uploaded = new Map<string, string>();
  const upload = async (src: string) => {
    if (/^https?:\/\//.test(src)) return null;
    const cached = uploaded.get(src);
    if (cached) return cached;
    const path = isAbsolute(src) ? src : join(assetsDir, src);
    const asset = await client.assets.upload('image', readFileSync(path), {
      filename: basename(path),
    });
    uploaded.set(src, asset._id);
    return asset._id;
  };

  const imageSources = [...article.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(
    (m) => m[1] ?? '',
  );
  for (const src of imageSources) await upload(src);
  const heroId = article.meta.heroImage ? await upload(article.meta.heroImage.src) : null;

  const body = markdownToPortableText(article.body, (src, alt) => {
    const id = uploaded.get(src);
    return id
      ? { _type: 'image', _key: key(), alt, asset: { _type: 'reference', _ref: id } }
      : null;
  });

  const documentId = `drafts.leo-${article.meta.slug}`;
  await client.createOrReplace({
    _id: documentId,
    _type: target.postType,
    title: article.meta.title,
    slug: { _type: 'slug', current: article.meta.slug },
    excerpt: article.meta.excerpt,
    seoTitle: article.meta.title,
    seoDescription: article.meta.description,
    publishedAt: new Date(article.meta.date).toISOString(),
    ...(heroId && {
      mainImage: {
        _type: 'image',
        alt: article.meta.heroImage?.alt,
        asset: { _type: 'reference', _ref: heroId },
      },
    }),
    body,
  });

  return {
    documentId,
    url: `https://www.sanity.io/manage/project/${target.projectId}`,
  };
}
