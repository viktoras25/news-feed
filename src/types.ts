export type FeedConfig = {
  name: string;
  url: string;
  group: string; // coarse label from feeds.yml, not a classification
  // false for wide feeds: their snippets are not worth the space.
  snippet: boolean;
  // If set, an entry URL must contain at least one of these substrings (scopes a feed to a region).
  urlMustContain: string[];
};

// Mechanical markers only (markers.yml). Nothing here judges how important an entry is.
export type Markers = {
  // A title starting with one of these is an ad, an announcement or a recurring roundup.
  titlePrefixes: string[];
  // A URL containing one of these is not an article (video pages, press portals).
  urlParts: string[];
};

// One RSS entry after cleaning. title and snippet are already safe as text,
// but Markdown escaping happens only at output time (see output.ts).
export type Item = {
  group: string;
  source: string;
  title: string;
  url: string; // cleaned URL for display (tracking parameters and fragment removed)
  key: string; // normalized URL used for comparison and ids
  published: Date;
  snippet: string; // empty if the feed has snippet: false
};

export type SourceRef = {
  name: string;
  url: string;
  published: Date;
};

// One record of the digest: an entry, possibly seen in several feeds.
export type Entry = {
  id: string; // first 6 hex of sha1 of the normalized URL (longer only on a collision)
  group: string;
  title: string;
  url: string;
  published: Date; // earliest publication time among the sources
  snippet: string;
  sources: SourceRef[];
  status: 'new' | 'seen_before';
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
  | 'dead' // download or parsing failed, see detail
  | 'empty' // feed works, but contains no entries at all
  | 'quiet' // feed works, but has no entries within the window
  | 'no_dates'; // feed has no usable dates: dates come from the first-seen cache

export type FlaggedText = {
  url: string;
  field: 'title' | 'snippet';
};

export type FeedReport = {
  feed: FeedConfig;
  status: FeedStatusKind;
  detail: string;
  fetched: number; // entries in the feed
  inWindow: number; // after the time filter
  afterCleaning: number; // after removing ads and non-articles
  kept: number; // entries of this feed in the final output (new and seen_before)
  flagged: FlaggedText[]; // texts that tripped the injection guard
};
