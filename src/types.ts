export type FeedConfig = {
  name: string;
  priority: 1 | 2;
  url: string;
  topic: string;
};

export type Keywords = {
  include: string[];
  wordBoundary: string[];
  exclude: string[];
};

// One RSS entry after cleaning. title and snippet are already safe as text,
// but Markdown escaping happens only at output time (see render.ts).
export type Item = {
  topic: string;
  source: string;
  priority: 1 | 2;
  title: string;
  url: string;
  published: Date;
  snippet: string;
  // Full cleaned text (not truncated), used only for keyword search.
  searchText: string;
};

// Result of downloading one feed, before its entries are processed.
export type RawEntry = {
  title: string;
  link: string;
  date: Date | null;
  description: string;
};

export type FeedStatusKind =
  | 'ok'
  | 'quiet' // feed works, but has no entries within the window
  | 'empty' // feed works, but contains no entries at all
  | 'no_dates' // entries exist, but none has a date
  | 'http_error'
  | 'timeout'
  | 'parse_error';

export type FeedReport = {
  feed: FeedConfig;
  status: FeedStatusKind;
  detail: string;
  fetched: number; // entries in the feed
  inWindow: number; // after the time filter
  afterNoise: number; // after the noise filter and the priority 2 limit
  kept: number; // left after deduplication
  droppedInjection: number; // entries dropped for a suspicious title
  strippedSnippets: number; // snippets removed because of suspicious text
};
