import { cleanUrl, normalizeUrl } from './dedupe.ts';
import { filterFeedItems, isInWindow, lacksUsableDates } from './filter.ts';
import { cleanSnippet, cleanTitle } from './sanitize.ts';
import { datesFromFirstSeen } from './seen.ts';
import type { SeenStore } from './seen.ts';
import type { FeedConfig, FeedReport, Item, Markers, RawEntry } from './types.ts';

export type FeedProcessed = {
  report: FeedReport;
  items: Item[]; // after removing ads and non-articles, before merging duplicates
};

// Turns the raw entries of one feed into cleaned Items and collects statistics.
export function processFeed(
  feed: FeedConfig,
  fetchStatus: 'ok' | 'dead',
  detail: string,
  rawEntries: RawEntry[],
  now: Date,
  hours: number,
  markers: Markers,
  seen: SeenStore,
): FeedProcessed {
  const report: FeedReport = {
    feed,
    status: 'ok',
    detail,
    fetched: rawEntries.length,
    inWindow: 0,
    afterCleaning: 0,
    kept: 0,
    flagged: [],
  };

  if (fetchStatus === 'dead') {
    report.status = 'dead';
    return { report, items: [] };
  }

  if (rawEntries.length === 0) {
    report.status = 'empty';
    return { report, items: [] };
  }

  // Feeds without real dates (none, or one shared timestamp) get dates from the first-seen cache.
  let entries = rawEntries;
  if (lacksUsableDates(rawEntries)) {
    entries = datesFromFirstSeen(rawEntries, seen, now);
    report.status = 'no_dates';
    report.detail = 'no usable dates in the feed: using first-seen times';
  }

  const candidates: Item[] = [];

  for (const entry of entries) {
    if (entry.date === null || !isInWindow(entry.date, now, hours)) {
      continue;
    }
    report.inWindow += 1;

    const url = cleanUrl(entry.link);
    const title = cleanTitle(entry.title);
    if (title.flagged) {
      report.flagged.push({ url, field: 'title' });
      continue;
    }
    if (title.text === '') {
      continue;
    }

    const snippet = cleanSnippet(entry.description);
    if (snippet.flagged) {
      report.flagged.push({ url, field: 'snippet' });
    }

    candidates.push({
      group: feed.group,
      source: feed.name,
      title: title.text,
      url,
      key: normalizeUrl(url),
      published: entry.date,
      snippet: feed.snippet ? snippet.text : '',
    });
  }

  const filtered = filterFeedItems(candidates, markers, feed);
  report.afterCleaning = filtered.length;

  if (report.status === 'ok' && report.inWindow === 0) {
    report.status = 'quiet';
  }

  return { report, items: filtered };
}

