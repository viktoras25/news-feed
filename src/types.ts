export type FeedConfig = {
  name: string;
  // Only decides which source is listed first when the same entry comes from several feeds.
  priority: 1 | 2;
  url: string;
  topic: string; // coarse group label from feeds.yml, not a classification
  // If set, an entry URL must contain at least one of these substrings (scopes a feed to a region).
  urlMustContain: string[];
};

// Mechanical markers only. Nothing here judges how important an entry is.
export type Keywords = {
  // Entries whose title or snippet contains one of these words (from the start of a word) are ads.
  excludeWords: string[];
  // Entries whose title starts with one of these are ads, announcements or recurring roundups.
  excludeTitlePrefixes: string[];
  // Entries whose URL contains one of these are not articles (video pages, press portals).
  excludeUrlParts: string[];
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
};

// One line of the digest: an entry, possibly seen in several feeds.
export type Entry = {
  id: string; // stable id derived from the URL of the first item
  topic: string;
  head: Item; // the item shown (best priority, then earliest)
  items: Item[]; // all items that were merged into this entry, head first
  snippet: string;
  published: Date; // earliest publication time among the items
  seenBefore: boolean; // the URL was already in a previous export
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
  | 'http_error'
  | 'timeout'
  | 'parse_error';

export type FeedReport = {
  feed: FeedConfig;
  status: FeedStatusKind;
  detail: string;
  fetched: number; // entries in the feed
  inWindow: number; // after the time filter
  afterFilter: number; // after removing ads and non-articles
  kept: number; // items of this feed inside the final entries
  droppedInjection: number; // entries dropped for a suspicious title
  strippedSnippets: number; // snippets removed because of suspicious text
};
