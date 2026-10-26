import type { FeedConfig, Item, Markers, RawEntry } from './types.ts';

export const MIN_WINDOW_HOURS = 24;
export const MAX_WINDOW_HOURS = 72;

// A feed whose entries mostly share one timestamp has no real publication dates
// (the feed stamps every entry with its build time), so the time window cannot be applied.
const SHARED_TIMESTAMP_MIN_ENTRIES = 5;
const SHARED_TIMESTAMP_SHARE = 0.8;

const HOUR_MS = 60 * 60 * 1000;

// The window reaches back to the last successful run, but at least 24 and at most 72 hours.
// An explicit override (WINDOW_HOURS) wins over the rule.
export function computeWindowHours(now: Date, lastSuccess: Date | null, override?: number): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return override;
  }
  if (lastSuccess === null) {
    return MIN_WINDOW_HOURS;
  }
  const sinceLastRun = Math.ceil((now.getTime() - lastSuccess.getTime()) / HOUR_MS);
  return Math.min(MAX_WINDOW_HOURS, Math.max(MIN_WINDOW_HOURS, sinceLastRun));
}

export function isInWindow(published: Date, now: Date, hours: number): boolean {
  const ageMs = now.getTime() - published.getTime();
  // Small tolerance into the future: source clocks can run ahead.
  if (ageMs < -HOUR_MS) {
    return false;
  }
  return ageMs <= hours * HOUR_MS;
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

// Ads, announcements, video pages and press portals: things that are not news articles.
export function isNotAnArticle(title: string, url: string, markers: Markers): boolean {
  const lowerTitle = title.trim().toLowerCase();
  for (const prefix of markers.titlePrefixes) {
    if (lowerTitle.startsWith(prefix.toLowerCase())) {
      return true;
    }
  }
  const lowerUrl = url.toLowerCase();
  for (const part of markers.urlParts) {
    if (lowerUrl.includes(part.toLowerCase())) {
      return true;
    }
  }
  return false;
}

// Removes what is not an article and applies the feed's own URL scope. No limits, no judgment of importance.
export function filterFeedItems(
  items: Item[],
  markers: Markers,
  feed: Pick<FeedConfig, 'urlMustContain'> = { urlMustContain: [] },
): Item[] {
  const result: Item[] = [];
  for (const item of items) {
    if (isNotAnArticle(item.title, item.url, markers)) {
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
