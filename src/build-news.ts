import { mergeDuplicates } from './dedupe.ts';
import { fetchAll, loadFeeds, loadMarkers } from './fetch-feeds.ts';
import { computeWindowHours } from './filter.ts';
import {
  groupTitle,
  renderDetails,
  renderHealth,
  renderIndex,
  renderManifest,
  renderNewsJson,
  writeOutputs,
} from './output.ts';
import { processFeed } from './process-feed.ts';
import { loadLastRun, loadSeen, rememberKeys, saveLastRun, saveSeen } from './seen.ts';
import type { FeedReport, Item } from './types.ts';

const SEEN_PATH = 'state/seen.json';
const LAST_RUN_PATH = 'state/last_run.json';
const OUT_DIR = 'out';

async function main(): Promise<void> {
  const now = new Date();
  const lastSuccess = loadLastRun(LAST_RUN_PATH);
  // WINDOW_HOURS overrides the rule "since the last successful run, between 24 and 72 hours".
  const override = process.env.WINDOW_HOURS ? Number(process.env.WINDOW_HOURS) : undefined;
  const hours = computeWindowHours(now, lastSuccess, override);

  const feeds = loadFeeds('feeds.yml');
  const markers = loadMarkers('markers.yml');
  const seen = loadSeen(SEEN_PATH);
  // URLs of earlier exports, taken before this run adds anything: they make an entry "seen_before".
  const previousKeys = new Set(Object.keys(seen));

  const groupOrder: string[] = [];
  for (const feed of feeds) {
    if (!groupOrder.includes(feed.group)) {
      groupOrder.push(feed.group);
    }
  }

  console.log(`Feeds: ${feeds.length}, window: ${hours} h, cache: ${previousKeys.size} URLs`);
  const fetched = await fetchAll(feeds);

  const reports: FeedReport[] = [];
  const allItems: Item[] = [];
  for (let i = 0; i < feeds.length; i++) {
    const result = fetched[i];
    const processed = processFeed(feeds[i], result.status, result.detail, result.entries, now, hours, markers, seen);
    reports.push(processed.report);
    allItems.push(...processed.items);
  }

  const deadCount = reports.filter((report) => report.status === 'dead').length;
  if (deadCount > feeds.length / 2) {
    // Almost certainly a network problem: publish nothing, keep yesterday's files and the old state.
    console.error(`${deadCount} of ${feeds.length} feeds are dead: nothing was written`);
    process.exit(1);
  }

  const merged = mergeDuplicates(allItems, previousKeys);
  const newEntries = merged.entries.filter((entry) => entry.status === 'new');
  const seenBeforeCount = merged.entries.length - newEntries.length;

  // How many entries of each feed are in the output (feed names are unique).
  for (const entry of merged.entries) {
    for (const name of new Set(entry.sources.map((source) => source.name))) {
      const report = reports.find((r) => r.feed.name === name);
      if (report) {
        report.kept += 1;
      }
    }
  }

  const files: Record<string, string> = {};
  files['index.md'] = renderIndex(newEntries, groupOrder, reports, now, hours, seenBeforeCount);
  for (const group of groupOrder) {
    files[`details/${group}.md`] = renderDetails(newEntries, group, groupTitle(group), now);
  }
  files['news.json'] = renderNewsJson(merged.entries, groupOrder, now, hours);
  files['health.md'] = renderHealth(reports, now, hours, {
    items: allItems.length,
    removedByUrl: merged.removedByUrl,
    removedByTitle: merged.removedByTitle,
    entries: merged.entries.length,
    newEntries: newEntries.length,
  });
  files['manifest.json'] = renderManifest(
    merged.entries,
    groupOrder,
    reports,
    [...Object.keys(files), 'manifest.json'].sort(),
    now,
    hours,
  );

  writeOutputs(OUT_DIR, files, now);

  // State is updated only after the files are written: a failed run leaves it untouched.
  rememberKeys(seen, allItems.map((item) => item.key), now);
  saveSeen(SEEN_PATH, seen, now);
  saveLastRun(LAST_RUN_PATH, now);

  console.log(
    `Entries: ${merged.entries.length} (new ${newEntries.length}, seen_before ${seenBeforeCount}) ` +
      `from ${allItems.length} items; merged: URL ${merged.removedByUrl}, title ${merged.removedByTitle}; dead feeds: ${deadCount}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
