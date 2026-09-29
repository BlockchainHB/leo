export interface SearchResult {
  position: number;
  url: string;
  title: string;
  description: string;
  domain: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  description: string;
  markdown: string;
  source: 'firecrawl' | 'fetch';
}

export interface ResearchNote {
  query: string;
  answer: string;
  sources: { url: string; title: string }[];
}
