import type { Item, Keywords } from './types.ts';

export const MAX_PRIORITY1_PER_FEED = 8;
export const MAX_PRIORITY2_PER_FEED = 5;
// Upper bound per topic so that news.md stays compact (about 40-50 KB).
export const MAX_PER_TOPIC = 15;

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Short words (KI, EZB) are matched as whole words, case-sensitive.
function matchesWholeWord(text: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'u');
  return pattern.test(text);
}

export function matchesInclude(text: string, keywords: Keywords): boolean {
  const lower = text.toLowerCase();
  for (const word of keywords.include) {
    if (keywords.wordBoundary.includes(word)) {
      if (matchesWholeWord(text, word)) {
        return true;
      }
    } else if (lower.includes(word.toLowerCase())) {
      return true;
    }
  }
  return false;
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

// Noise filter for the entries of one feed. Entries are already inside the time window.
export function filterFeedItems(items: Item[], keywords: Keywords): Item[] {
  const result: Item[] = [];

  // Newest first, so the priority 2 limit keeps the most recent entries.
  const sorted = [...items].sort((a, b) => b.published.getTime() - a.published.getTime());

  for (const item of sorted) {
    const text = item.title + ' ' + item.searchText;
    if (matchesExclude(text, keywords)) {
      continue;
    }
    if (item.priority === 2 && !matchesInclude(text, keywords)) {
      continue;
    }
    result.push(item);
    const limit = item.priority === 1 ? MAX_PRIORITY1_PER_FEED : MAX_PRIORITY2_PER_FEED;
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

// Keeps at most max entries per topic. Selection order: priority 1 first, then within a priority
// round-robin across feeds (the newest entry of each feed, then the second, and so on),
// so that one noisy feed does not crowd out the others. Runs after deduplication.
export function capPerTopic(items: Item[], max: number): Item[] {
  // Position of the entry within its own feed: 0 = newest.
  const newestFirst = [...items].sort((a, b) => b.published.getTime() - a.published.getTime());
  const seenPerFeed = new Map<string, number>();
  const rankByItem = new Map<Item, number>();
  for (const item of newestFirst) {
    const feedKey = item.topic + '|' + item.source;
    const rank = seenPerFeed.get(feedKey) ?? 0;
    rankByItem.set(item, rank);
    seenPerFeed.set(feedKey, rank + 1);
  }

  const sorted = [...newestFirst].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    const rankA = rankByItem.get(a) ?? 0;
    const rankB = rankByItem.get(b) ?? 0;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return b.published.getTime() - a.published.getTime();
  });

  const countByTopic = new Map<string, number>();
  const result: Item[] = [];
  for (const item of sorted) {
    const count = countByTopic.get(item.topic) ?? 0;
    if (count >= max) {
      continue;
    }
    countByTopic.set(item.topic, count + 1);
    result.push(item);
  }
  return result;
}
