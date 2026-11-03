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
  // Topic rules for named feeds: soft sections of wide feeds, regional scope of state-wide feeds.
  topicRules: TopicRule[];
  // An entry whose title or snippet contains one of these is never dropped by a drop rule (case-insensitive).
  keepWords: string[];
};

// One rule of markers.yml `topicRules`. It applies only to the feeds it names.
export type TopicRule = {
  name: string; // label in health.md
  feeds: string[];
  // Drop: the URL contains one of these, the title starts with one of these, or the title has one of these
  // words (at a word start, so "Sport" does not hit "Transport"). keepWords protect an entry from these.
  dropUrlParts: string[];
  dropTitlePrefixes: string[];
  dropTitleWords: string[];
  // Scope: if set, only entries whose title or snippet mentions one of these are kept. keepWords do not apply.
  keepOnlyMentioning: string[];
};

export type TopicDrop = {
  rule: string;
  title: string;
  url: string;
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
  afterCleaning: number; // after removing ads, non-articles and topic-rule drops
  kept: number; // entries of this feed in the final output (new and seen_before)
  flagged: FlaggedText[]; // texts that tripped the injection guard
  topicDropped: TopicDrop[]; // entries removed by a topic rule
  keptByKeepWords: TopicDrop[]; // entries a drop rule matched, kept because of a keepWord
};
