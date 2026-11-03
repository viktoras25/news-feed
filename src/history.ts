import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUrl } from './dedupe.ts';
import type { Entry } from './types.ts';

// Per-feed statistics over the archive (out/archive/*/news.json) plus the current run, for health.md.
// They show which feeds only repeat others and are candidates for removal.

// The sources of one exported entry: feed name and normalized URL of each.
export type ArchivedEntry = { name: string; key: string }[];

export type FeedWeekStats = {
  name: string;
  entries: number; // distinct URLs the feed contributed
  unique: number; // of those, entries no other feed carried
  shared: number; // entries at least one other feed carried too (merged by URL or title)
  mostSharedWith: string; // the other feed it overlaps with most, '' if none
};

// Reads the news.json of every archive day except `skipDay` (the day the current run is about to overwrite).
export function loadArchive(archiveRoot: string, skipDay: string): ArchivedEntry[] {
  if (!existsSync(archiveRoot)) {
    return [];
  }
  const result: ArchivedEntry[] = [];
  for (const day of readdirSync(archiveRoot).sort()) {
    const path = join(archiveRoot, day, 'news.json');
    if (day === skipDay || !existsSync(path)) {
      continue;
    }
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { entries: { sources: { name: string; url: string }[] }[] };
      for (const entry of data.entries) {
        result.push(entry.sources.map((source) => ({ name: source.name, key: normalizeUrl(source.url) })));
      }
    } catch {
      // A broken archive day is skipped: the statistics are a diagnostic, not part of the data.
    }
  }
  return result;
}

export function toArchived(entries: Entry[]): ArchivedEntry[] {
  return entries.map((entry) => entry.sources.map((source) => ({ name: source.name, key: normalizeUrl(source.url) })));
}

// The same entry shows up on several days (seen_before): a feed's entries are counted by distinct URL, and
// a URL counts as shared if any day merged it with another feed.
export function feedWeekStats(entries: ArchivedEntry[], feedNames: string[]): FeedWeekStats[] {
  const keysByFeed = new Map<string, Set<string>>();
  const sharedKeysByFeed = new Map<string, Set<string>>();
  const overlap = new Map<string, Map<string, Set<string>>>(); // feed -> other feed -> keys

  for (const sources of entries) {
    const names = [...new Set(sources.map((source) => source.name))];
    for (const source of sources) {
      if (!keysByFeed.has(source.name)) {
        keysByFeed.set(source.name, new Set());
        sharedKeysByFeed.set(source.name, new Set());
        overlap.set(source.name, new Map());
      }
      keysByFeed.get(source.name)!.add(source.key);
      const others = names.filter((name) => name !== source.name);
      if (others.length === 0) {
        continue;
      }
      sharedKeysByFeed.get(source.name)!.add(source.key);
      const byOther = overlap.get(source.name)!;
      for (const other of others) {
        if (!byOther.has(other)) {
          byOther.set(other, new Set());
        }
        byOther.get(other)!.add(source.key);
      }
    }
  }

  return feedNames.map((name) => {
    const total = keysByFeed.get(name)?.size ?? 0;
    const shared = sharedKeysByFeed.get(name)?.size ?? 0;
    let mostSharedWith = '';
    let most = 0;
    for (const [other, keys] of overlap.get(name) ?? new Map<string, Set<string>>()) {
      if (keys.size > most) {
        most = keys.size;
        mostSharedWith = `${other} (${keys.size})`;
      }
    }
    return { name, entries: total, unique: total - shared, shared, mostSharedWith };
  });
}
