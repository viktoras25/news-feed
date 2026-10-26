import type { FeedConfig, Item, Keywords, RawEntry } from './types.ts';

export const MAX_PRIORITY1_PER_FEED = 20;
export const MAX_PRIORITY2_PER_FEED = 10;

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

// Short words (KI, EZB) are matched as whole words, case-sensitive.
function matchesWholeWord(text: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'u');
  return pattern.test(text);
}

// True if any of the words occurs in the text. Words listed in wholeWords need a whole-word match.
export function matchesWords(text: string, words: string[], wholeWords: string[]): boolean {
  const lower = text.toLowerCase();
  for (const word of words) {
    if (wholeWords.includes(word)) {
      if (matchesWholeWord(text, word)) {
        return true;
      }
    } else if (lower.includes(word.toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function matchesInclude(text: string, keywords: Keywords): boolean {
  return matchesWords(text, keywords.include, keywords.wordBoundary);
}

// Noise words are matched from the start of a word: "Promi" finds "Promis", but "Gala" does not find "Galapagos".
export function matchesExclude(text: string, keywords: Keywords): boolean {
  for (const word of keywords.exclude) {
    const pattern = new RegExp(`(^|[^\\p{L}])${escapeRegExp(word)}`, 'iu');
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

// Ads, announcements, video pages and section URLs that are never news for this digest.
export function isAnnouncement(title: string, url: string, keywords: Keywords): boolean {
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
  return false;
}

// Filter for the entries of one feed. Entries are already inside the time window.
// Applies: ads, per-feed URL rule, noise words, keyword requirement, per-feed limit.
export function filterFeedItems(
  items: Item[],
  keywords: Keywords,
  feed: Pick<FeedConfig, 'requireKeywords' | 'urlMustContain'> = { requireKeywords: false, urlMustContain: [] },
): Item[] {
  const result: Item[] = [];

  // Newest first, so the per-feed limit keeps the most recent entries.
  const sorted = [...items].sort((a, b) => b.published.getTime() - a.published.getTime());

  for (const item of sorted) {
    if (isAnnouncement(item.title, item.url, keywords)) {
      continue;
    }
    if (feed.urlMustContain.length > 0) {
      const lowerUrl = item.url.toLowerCase();
      const allowed = feed.urlMustContain.some((part) => lowerUrl.includes(part.toLowerCase()));
      if (!allowed) {
        continue;
      }
    }
    const text = item.title + ' ' + item.searchText;
    if (matchesExclude(text, keywords)) {
      continue;
    }
    const needsKeywords = item.priority === 2 || feed.requireKeywords;
    if (needsKeywords && !matchesInclude(text, keywords)) {
      continue;
    }
    result.push({ ...item, feedRank: result.length });
    const limit = item.priority === 1 ? MAX_PRIORITY1_PER_FEED : MAX_PRIORITY2_PER_FEED;
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}
