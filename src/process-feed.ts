import { cleanUrl, normalizeUrl } from './dedupe.ts';
import { filterFeedItems, isInWindow, lacksUsableDates, topicVerdict } from './filter.ts';
import { cleanSnippet, cleanTitle } from './sanitize.ts';
import { datesFromFirstSeen } from './seen.ts';
import type { SeenStore } from './seen.ts';
import type { FeedConfig, FeedReport, Item, Markers, RawEntry } from './types.ts';

export type FeedProcessed = {
  report: FeedReport;
  items: Item[]; // after removing ads, non-articles and topic-rule drops, before merging duplicates
  // Normalized URLs the feed lists without usable dates: their first-seen times must outlive the cache pruning.
  undatedKeys: string[];
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
    topicDropped: [],
    keptByKeepWords: [],
  };

  if (fetchStatus === 'dead') {
    report.status = 'dead';
    return { report, items: [], undatedKeys: [] };
  }

  if (rawEntries.length === 0) {
    report.status = 'empty';
    return { report, items: [], undatedKeys: [] };
  }

  // Feeds without real dates (none, or one shared timestamp) get dates from the first-seen cache.
  let entries = rawEntries;
  let undatedKeys: string[] = [];
  if (lacksUsableDates(rawEntries)) {
    entries = datesFromFirstSeen(rawEntries, seen, now);
    undatedKeys = entries.map((entry) => normalizeUrl(entry.link));
    report.status = 'no_dates';
    report.detail = 'no usable dates in the feed: using first-seen times';
  }

  const candidates: Item[] = [];
  // Cleaned snippet of each candidate, kept even for snippet: false feeds: topic rules look at it.
  const textByItem = new Map<Item, string>();

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

    const item: Item = {
      group: feed.group,
      source: feed.name,
      title: title.text,
      url,
      key: normalizeUrl(url),
      published: entry.date,
      snippet: feed.snippet ? snippet.text : '',
    };
    candidates.push(item);
    textByItem.set(item, snippet.flagged ? '' : snippet.text);
  }

  const filtered: Item[] = [];
  for (const item of filterFeedItems(candidates, markers, feed)) {
    const verdict = topicVerdict(feed.name, item.title, item.url, textByItem.get(item) ?? '', markers);
    if (verdict.dropRule !== null) {
      report.topicDropped.push({ rule: verdict.dropRule, title: item.title, url: item.url });
      continue;
    }
    if (verdict.keptByKeepWords !== null) {
      report.keptByKeepWords.push({ rule: verdict.keptByKeepWords, title: item.title, url: item.url });
    }
    filtered.push(item);
  }
  report.afterCleaning = filtered.length;

  if (report.status === 'ok' && report.inWindow === 0) {
    report.status = 'quiet';
  }

  return { report, items: filtered, undatedKeys };
}

