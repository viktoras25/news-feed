import { mkdirSync, writeFileSync } from 'node:fs';
import { mergeDuplicates } from './dedupe.ts';
import { fetchAll, loadFeeds, loadKeywords } from './fetch-feeds.ts';
import { filterFeedItems, isInWindow, lacksUsableDates, windowHours } from './filter.ts';
import { renderHealth, renderNews, renderNewsJson } from './render.ts';
import { cleanSnippet, cleanTitle } from './sanitize.ts';
import { datesFromFirstSeen, loadSeen, rememberUrls, saveSeen } from './seen.ts';
import type { SeenStore } from './seen.ts';
import type { FeedConfig, FeedReport, FeedStatusKind, Item, Keywords, RawEntry } from './types.ts';

const SEEN_PATH = 'state/seen.json';

type FeedProcessed = {
  report: FeedReport;
  items: Item[]; // after removing ads and non-articles, before merging duplicates
};

// Turns the raw entries of one feed into cleaned Items and collects statistics.
function processFeed(
  feed: FeedConfig,
  fetchStatus: FeedStatusKind,
  detail: string,
  rawEntries: RawEntry[],
  now: Date,
  hours: number,
  keywords: Keywords,
  seen: SeenStore,
): FeedProcessed {
  const report: FeedReport = {
    feed,
    status: fetchStatus,
    detail,
    fetched: rawEntries.length,
    inWindow: 0,
    afterFilter: 0,
    kept: 0,
    droppedInjection: 0,
    strippedSnippets: 0,
  };

  if (fetchStatus !== 'ok') {
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
    report.detail = 'no usable dates in the feed: using first-seen times';
  }

  const candidates: Item[] = [];

  for (const entry of entries) {
    if (entry.date === null || !isInWindow(entry.date, now, hours)) {
      continue;
    }
    report.inWindow += 1;

    const title = cleanTitle(entry.title);
    if (title.flagged) {
      report.droppedInjection += 1;
      continue;
    }
    if (title.text === '') {
      continue;
    }

    const snippet = cleanSnippet(entry.description);
    if (snippet.flagged) {
      report.strippedSnippets += 1;
    }

    candidates.push({
      topic: feed.topic,
      source: feed.name,
      priority: feed.priority,
      title: title.text,
      url: entry.link,
      published: entry.date,
      snippet: snippet.text,
    });
  }

  const filtered = filterFeedItems(candidates, keywords, feed);
  report.afterFilter = filtered.length;

  if (report.inWindow === 0) {
    report.status = 'quiet';
  }

  return { report, items: filtered };
}

async function main(): Promise<void> {
  const now = new Date();
  // WINDOW_HOURS overrides the default window (for example for a manual run of the workflow).
  const hours = Number(process.env.WINDOW_HOURS) || windowHours(now);

  const feeds = loadFeeds('feeds.yml');
  const keywords = loadKeywords('keywords.yml');
  const seen = loadSeen(SEEN_PATH);
  // URLs of earlier exports, taken before this run adds anything: they make an entry "seen_before".
  const previousUrls = new Set(Object.keys(seen));

  const topicOrder: string[] = [];
  for (const feed of feeds) {
    if (!topicOrder.includes(feed.topic)) {
      topicOrder.push(feed.topic);
    }
  }

  console.log(`Feeds: ${feeds.length}, window: ${hours} h, cache: ${previousUrls.size} URLs`);
  const fetched = await fetchAll(feeds);

  const reports: FeedReport[] = [];
  const allItems: Item[] = [];
  for (let i = 0; i < feeds.length; i++) {
    const result = fetched[i];
    const processed = processFeed(feeds[i], result.status, result.detail, result.entries, now, hours, keywords, seen);
    reports.push(processed.report);
    allItems.push(...processed.items);
  }

  const merged = mergeDuplicates(allItems, previousUrls);

  // How many items of each feed ended up in the final entries (key: feed name + topic).
  for (const entry of merged.entries) {
    for (const item of entry.items) {
      const report = reports.find((r) => r.feed.name === item.source && r.feed.topic === item.topic);
      if (report) {
        report.kept += 1;
      }
    }
  }

  // Everything exported now counts as seen in the next run. Saved before anything can fail below.
  rememberUrls(
    seen,
    merged.entries.flatMap((entry) => entry.items.map((item) => item.url)),
    now,
  );
  saveSeen(SEEN_PATH, seen, now);

  mkdirSync('out', { recursive: true });
  const health = renderHealth(reports, now, hours, {
    items: allItems.length,
    removedByUrl: merged.removedByUrl,
    removedByTitle: merged.removedByTitle,
    entries: merged.entries.length,
  });
  writeFileSync('out/health.md', health);

  const newCount = merged.entries.filter((entry) => !entry.seenBefore).length;
  console.log(
    `Entries: ${merged.entries.length} (new ${newCount}, seen_before ${merged.entries.length - newCount}) ` +
      `from ${allItems.length} items; merged: URL ${merged.removedByUrl}, title ${merged.removedByTitle}`,
  );

  // An empty result is almost certainly a failure: keep yesterday's file and fail the workflow.
  if (merged.entries.length === 0) {
    console.error('No entries: news.md was not created');
    process.exit(1);
  }

  writeFileSync('out/news.md', renderNews(merged.entries, topicOrder, reports, now, hours));
  writeFileSync('out/news.json', renderNewsJson(merged.entries, topicOrder, reports, now, hours));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
