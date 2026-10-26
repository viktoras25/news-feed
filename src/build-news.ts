import { mkdirSync, writeFileSync } from 'node:fs';
import { MAX_CLUSTERS_PER_TOPIC, MAX_CLUSTERS_TOTAL, capClusters, clusterItems } from './cluster.ts';
import { fetchAll, loadFeeds, loadKeywords } from './fetch-feeds.ts';
import { filterFeedItems, hasSharedTimestamp, isInWindow, windowHours } from './filter.ts';
import { renderHealth, renderNews, renderNewsJson } from './render.ts';
import { cleanSnippet, cleanTitle } from './sanitize.ts';
import type { FeedConfig, FeedReport, FeedStatusKind, Item, RawEntry } from './types.ts';

type FeedProcessed = {
  report: FeedReport;
  items: Item[]; // after noise filters, before clustering
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

  // Some feeds stamp every entry with the time the feed was built: the dates are fake.
  if (hasSharedTimestamp(entries)) {
    report.status = 'no_dates';
    report.detail = 'all entries share one timestamp (feed build time)';
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
      feedRank: 0, // set by filterFeedItems
    });
  }

  if (withDate === 0) {
    report.status = 'no_dates';
    report.detail = 'none of the entries has a date';
    return { report, items: [] };
  }

  const filtered = filterFeedItems(candidates, keywords, feed);
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

  console.log(`Feeds: ${feeds.length}, window: ${hours} h`);
  const fetched = await fetchAll(feeds);

  const reports: FeedReport[] = [];
  const allItems: Item[] = [];
  for (let i = 0; i < feeds.length; i++) {
    const result = fetched[i];
    const processed = processFeed(feeds[i], result.status, result.detail, result.entries, now, hours, keywords);
    reports.push(processed.report);
    allItems.push(...processed.items);
  }

  const clustered = clusterItems(allItems, keywords);
  const finalClusters = capClusters(clustered.clusters, MAX_CLUSTERS_PER_TOPIC, MAX_CLUSTERS_TOTAL);

  // How many entries of each feed ended up in the final events (key: source + topic of the entry's feed).
  for (const cluster of finalClusters) {
    for (const member of cluster.members) {
      const report = reports.find((r) => r.feed.name === member.source && r.feed.topic === member.topic);
      if (report) {
        report.kept += 1;
      }
    }
  }

  mkdirSync('out', { recursive: true });
  const health = renderHealth(reports, now, hours, {
    removedByUrl: clustered.removedByUrl,
    items: allItems.length,
    clustersBeforeCap: clustered.clusters.length,
    clustersFinal: finalClusters.length,
  });
  writeFileSync('out/health.md', health);

  console.log(
    `Events in total: ${finalClusters.length} (from ${clustered.clusters.length} events, ${allItems.length} entries; URL duplicates: ${clustered.removedByUrl})`,
  );

  // An empty result is almost certainly a failure: keep yesterday's file and fail the workflow.
  if (finalClusters.length === 0) {
    console.error('No entries: news.md was not created');
    process.exit(1);
  }

  writeFileSync('out/news.md', renderNews(finalClusters, topicOrder, reports, now, hours));
  writeFileSync('out/news.json', renderNewsJson(finalClusters, topicOrder, reports, now, hours));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
