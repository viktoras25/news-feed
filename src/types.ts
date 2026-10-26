export type FeedConfig = {
  name: string;
  priority: 1 | 2;
  url: string;
  topic: string;
  // Entries pass only if a keyword from keywords.yml matches (like priority 2, but with the priority 1 limit).
  requireKeywords: boolean;
  // If set, an entry URL must contain at least one of these substrings.
  urlMustContain: string[];
};

export type Keywords = {
  include: string[];
  wordBoundary: string[];
  exclude: string[];
  // Entries whose title starts with one of these are ads or announcements.
  excludeTitlePrefixes: string[];
  // Entries whose URL contains one of these are dropped (video pages, sport sections, press portals).
  excludeUrlParts: string[];
  // Tag name -> words. Tags end up in news.json as `topics`.
  tags: Record<string, string[]>;
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
  // Position among the kept entries of its own feed, newest first (0 = top of the feed).
  // Used to pick events fairly across feeds when limits apply.
  feedRank: number;
};

// One event: the same story as reported by one or several sources.
export type Cluster = {
  id: string; // stable id derived from the head URL
  topic: string;
  head: Item; // the representative entry (best priority, earliest)
  members: Item[]; // all entries of the event, head included
  snippet: string;
  published: Date; // earliest publication time among members
  tags: string[];
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
  | 'no_dates' // no usable dates: missing, or one shared timestamp for all entries
  | 'http_error'
  | 'timeout'
  | 'parse_error';

export type FeedReport = {
  feed: FeedConfig;
  status: FeedStatusKind;
  detail: string;
  fetched: number; // entries in the feed
  inWindow: number; // after the time filter
  afterNoise: number; // after the noise filter and the per-feed limit
  kept: number; // entries of this feed inside the final clusters
  droppedInjection: number; // entries dropped for a suspicious title
  strippedSnippets: number; // snippets removed because of suspicious text
};
