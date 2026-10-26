import type { FeedConfig, Item, Keywords, RawEntry } from './types.ts';

// A feed whose entries mostly share one timestamp has no real publication dates
// (the feed stamps every entry with its build time), so the time window cannot be applied.
const SHARED_TIMESTAMP_MIN_ENTRIES = 5;
const SHARED_TIMESTAMP_SHARE = 0.8;

// On Sunday and Monday (Berlin time) use 72 hours, otherwise Friday and Saturday would be lost.
export function windowHours(now: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Europe/Berlin',
  }).format(now);
  if (weekday === 'Sun' || weekday === 'Mon') {
    return 72;
  }
  return 24;
}

export function isInWindow(published: Date, now: Date, hours: number): boolean {
  const ageMs = now.getTime() - published.getTime();
  // Small tolerance into the future: source clocks can run ahead.
  const oneHourMs = 60 * 60 * 1000;
  if (ageMs < -oneHourMs) {
    return false;
  }
  return ageMs <= hours * oneHourMs;
}

// True if the feed has no usable publication dates: none at all, or one shared timestamp.
export function lacksUsableDates(entries: RawEntry[]): boolean {
  const anyDate = entries.some((entry) => entry.date !== null);
  return !anyDate || hasSharedTimestamp(entries);
}

// True if most dated entries carry exactly the same timestamp.
export function hasSharedTimestamp(entries: RawEntry[]): boolean {
  const countByTime = new Map<number, number>();
  let dated = 0;
  for (const entry of entries) {
    if (entry.date === null) {
      continue;
    }
    dated += 1;
    const time = entry.date.getTime();
    countByTime.set(time, (countByTime.get(time) ?? 0) + 1);
  }
  if (dated < SHARED_TIMESTAMP_MIN_ENTRIES) {
    return false;
  }
  let biggest = 0;
  for (const count of countByTime.values()) {
    if (count > biggest) {
      biggest = count;
    }
  }
  return biggest / dated >= SHARED_TIMESTAMP_SHARE;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Words that occur at the start of a word: "Gewinnspiel" finds "Gewinnspiele".
export function findPrefixMatches(text: string, words: string[]): string[] {
  const found: string[] = [];
  for (const word of words) {
    const pattern = new RegExp(`(^|[^\\p{L}])${escapeRegExp(word)}`, 'iu');
    if (pattern.test(text) && !found.includes(word)) {
      found.push(word);
    }
  }
  return found;
}

// Ads, announcements, video pages and press portals: things that are not news articles.
export function isNotAnArticle(title: string, snippet: string, url: string, keywords: Keywords): boolean {
  const lowerTitle = title.trim().toLowerCase();
  for (const prefix of keywords.excludeTitlePrefixes) {
    if (lowerTitle.startsWith(prefix.toLowerCase())) {
      return true;
    }
  }
  const lowerUrl = url.toLowerCase();
  for (const part of keywords.excludeUrlParts) {
    if (lowerUrl.includes(part.toLowerCase())) {
      return true;
    }
  }
  return findPrefixMatches(title + ' ' + snippet, keywords.excludeWords).length > 0;
}

// Removes what is not an article and applies the feed's own URL scope. No limits, no judgment of importance.
export function filterFeedItems(
  items: Item[],
  keywords: Keywords,
  feed: Pick<FeedConfig, 'urlMustContain'> = { urlMustContain: [] },
): Item[] {
  const result: Item[] = [];
  for (const item of items) {
    if (isNotAnArticle(item.title, item.snippet, item.url, keywords)) {
      continue;
    }
    if (feed.urlMustContain.length > 0) {
      const lowerUrl = item.url.toLowerCase();
      const inScope = feed.urlMustContain.some((part) => lowerUrl.includes(part.toLowerCase()));
      if (!inScope) {
        continue;
      }
    }
    result.push(item);
  }
  return result;
}
