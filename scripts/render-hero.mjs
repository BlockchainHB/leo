#!/usr/bin/env node
// Renders the README hero (docs/assets/hero-{dark,light}.svg) from the output
// of a real run: `leo write designing cli error messages`. Run: node scripts/render-hero.mjs

import { writeFileSync } from 'node:fs';

const W = 660;
const LINE = 22;
const X = 28;

/** Each line is a list of [text, role] segments. Columns are padded to line up. */
const lines = [
  [['$ ', 'dim'], ['leo write designing cli error messages', 'fg']],
  [],
  [['◆ ', 'accent'], ['leo', 'bold'], [' writing ', 'muted'], ['“designing cli error messages”', 'fg'], ['           $0.29 · 1m 49s', 'muted']],
  [],
  ...[
    ['Search results', '9 results via Claude web search', '29s'],
    ['Research', '3 notes, 6 sources via Claude web search', '25s'],
    ['Competitor pages', '3 read, avg 970 words, 1 unreadable', '1s'],
    ['Content brief', '8 sections, ~1,100 words, 4 gaps', '19s'],
    ['Draft', '1,323 words', '36s'],
  ].map(([label, detail, time]) => [
    ['✓ ', 'success'],
    [label.padEnd(19), 'fg'],
    [detail.padEnd(44), 'muted'],
    [time.padStart(4), 'muted'],
  ]),
  [['– ', 'dim'], ['Images'.padEnd(19), 'dim'], ['disabled', 'dim']],
  [],
  [['Designing CLI Error Messages: A Practical Guide', 'bold']],
  [['1,323 words · $0.29 · .leo/runs/designing-cli-error-messages/article.md', 'muted']],
  [],
  [['next ', 'muted'], ['leo publish designing-cli-error-messages', 'accent']],
];

const themes = {
  dark: {
    bg: '#0b0b0b', chrome: '#161616', border: '#262626',
    fg: '#ededed', bold: '#ffffff', muted: '#8a8a8a', dim: '#525252',
    accent: '#f97316', success: '#22c55e',
  },
  light: {
    bg: '#ffffff', chrome: '#f4f4f5', border: '#e4e4e7',
    fg: '#27272a', bold: '#09090b', muted: '#71717a', dim: '#a1a1aa',
    accent: '#ea580c', success: '#16a34a',
  },
};

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function render(t) {
  const top = 44 + 26;
  const H = top + lines.length * LINE + 22;
  const rows = lines
    .map((segments, i) => {
      if (!segments.length) return '';
      const spans = segments
        .map(([text, role]) => {
          const color = t[role === 'bold' ? 'bold' : role];
          const weight = role === 'bold' ? ' font-weight="600"' : '';
          return `<tspan fill="${color}"${weight}>${escape(text)}</tspan>`;
        })
        .join('');
      return `<text x="${X}" y="${top + i * LINE}" xml:space="preserve">${spans}</text>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Leo writing an article in the terminal: every stage checked off in 1 minute 49 seconds for 29 cents">
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
  <path d="M12.5 0.5h${W - 25}a12 12 0 0 1 12 12v31.5h-${W - 1}v-31.5a12 12 0 0 1 12-12z" fill="${t.chrome}"/>
  <line x1="0.5" y1="44" x2="${W - 0.5}" y2="44" stroke="${t.border}"/>
  <circle cx="24" cy="22" r="6" fill="#ff5f57"/><circle cx="44" cy="22" r="6" fill="#febc2e"/><circle cx="64" cy="22" r="6" fill="#28c840"/>
  <text x="${W / 2}" y="27" text-anchor="middle" fill="${t.muted}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12">~/shipyard</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="13.5">
    ${rows}
  </g>
</svg>
`;
}

for (const [name, theme] of Object.entries(themes)) {
  writeFileSync(new URL(`../docs/assets/hero-${name}.svg`, import.meta.url), render(theme));
}
console.log('wrote docs/assets/hero-dark.svg and hero-light.svg');
