import { mkdirSync, writeFileSync } from 'node:fs';
import { dedupe } from './dedupe.ts';
import { fetchAll, loadFeeds, loadKeywords } from './fetch-feeds.ts';
import { MAX_PER_TOPIC, capPerTopic, filterFeedItems, isInWindow, windowHours } from './filter.ts';
import { renderHealth, renderNews } from './render.ts';
import { cleanSnippet, cleanTitle } from './sanitize.ts';
import type { FeedConfig, FeedReport, FeedStatusKind, Item, RawEntry } from './types.ts';

type FeedProcessed = {
  report: FeedReport;
  items: Item[]; // after noise filters, before deduplication
};

// Turns the raw entries of one feed into cleaned Items and collects statistics.
function processFeed(
  feed: FeedConfig,
  fetchStatus: FeedStatusKind,
  detail: string,
  entries: RawEntry[],
  now: Date,
  hours: number,
  keywords: ReturnType<typeof loadKeywords>,
): FeedProcessed {
  const report: FeedReport = {
    feed,
    status: fetchStatus,
    detail,
    fetched: entries.length,
    inWindow: 0,
    afterNoise: 0,
    kept: 0,
    droppedInjection: 0,
    strippedSnippets: 0,
  };

  if (fetchStatus !== 'ok') {
    return { report, items: [] };
  }

  if (entries.length === 0) {
    report.status = 'empty';
    return { report, items: [] };
  }

  const candidates: Item[] = [];
  let withDate = 0;

  for (const entry of entries) {
    if (entry.date === null) {
      continue;
    }
    withDate += 1;
    if (!isInWindow(entry.date, now, hours)) {
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
      searchText: snippet.full,
    });
  }

  if (withDate === 0) {
    report.status = 'no_dates';
    report.detail = 'ни у одной записи нет даты';
    return { report, items: [] };
  }

  const filtered = filterFeedItems(candidates, keywords);
  report.afterNoise = filtered.length;

  if (report.inWindow === 0) {
    report.status = 'quiet';
  }

  return { report, items: filtered };
}

async function main(): Promise<void> {
  const now = new Date();
  const hours = windowHours(now);

  const feeds = loadFeeds('feeds.yml');
  const keywords = loadKeywords('keywords.yml');
  const topicOrder: string[] = [];
  for (const feed of feeds) {
    if (!topicOrder.includes(feed.topic)) {
      topicOrder.push(feed.topic);
    }
  }

  console.log(`Фидов: ${feeds.length}, окно: ${hours} ч`);
  const fetched = await fetchAll(feeds);

  const reports: FeedReport[] = [];
  const allItems: Item[] = [];
  for (let i = 0; i < feeds.length; i++) {
    const result = fetched[i];
    const processed = processFeed(feeds[i], result.status, result.detail, result.entries, now, hours, keywords);
    reports.push(processed.report);
    allItems.push(...processed.items);
  }

  const deduped = dedupe(allItems);
  const finalItems = capPerTopic(deduped.kept, MAX_PER_TOPIC);

  // How many entries of each feed survived to the end (key: source + topic).
  for (const item of finalItems) {
    const report = reports.find((r) => r.feed.name === item.source && r.feed.topic === item.topic);
    if (report) {
      report.kept += 1;
    }
  }

  mkdirSync('out', { recursive: true });
  const health = renderHealth(reports, now, hours, deduped, deduped.kept.length, finalItems.length);
  writeFileSync('out/health.md', health);

  console.log(
    `Записей в итоге: ${finalItems.length} (после дедупликации ${deduped.kept.length}; дубли: URL ${deduped.removedByUrl}, заголовок ${deduped.removedByTitle})`,
  );

  // An empty result is almost certainly a failure: keep yesterday's file and fail the workflow.
  if (finalItems.length === 0) {
    console.error('Ни одной записи: news.md не создан');
    process.exit(1);
  }

  writeFileSync('out/news.md', renderNews(finalItems, topicOrder, now, hours));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
