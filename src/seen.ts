import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeUrl } from './dedupe.ts';
import type { RawEntry } from './types.ts';

// state/seen.json has two jobs.
// 1. Feeds without usable dates cannot be filtered by time. For them we remember when each URL was
//    first seen: an unseen URL counts as published "now", a seen one keeps its first-seen time and
//    therefore ages out of the window like any other entry.
// 2. Every exported URL is remembered, so the next export can mark it "seen_before".
// state/last_run.json holds the time of the last successful run (it sets the window of the next one).

// normalized URL -> ISO time of the first sighting
export type SeenStore = Record<string, string>;

const KEEP_DAYS = 14;
// Undated feeds usually list the newest entries first; only look at the top of the list.
export const MAX_UNDATED_ENTRIES = 15;

export function loadSeen(path: string): SeenStore {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SeenStore;
  } catch {
    // No cache yet (first run) or unreadable file: start empty.
    return {};
  }
}

export function saveSeen(path: string, seen: SeenStore, now: Date): void {
  const cutoff = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const pruned: SeenStore = {};
  for (const key of Object.keys(seen).sort()) {
    if (new Date(seen[key]).getTime() >= cutoff) {
      pruned[key] = seen[key];
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pruned, null, 1) + '\n');
}

// Returns the top entries of the feed with their dates replaced by first-seen times. Updates the store.
export function datesFromFirstSeen(entries: RawEntry[], seen: SeenStore, now: Date): RawEntry[] {
  const result: RawEntry[] = [];
  for (const entry of entries.slice(0, MAX_UNDATED_ENTRIES)) {
    const key = normalizeUrl(entry.link);
    if (seen[key] === undefined) {
      seen[key] = now.toISOString();
    }
    result.push({ ...entry, date: new Date(seen[key]) });
  }
  return result;
}

// Remembers the normalized URLs of everything that was exported.
export function rememberKeys(seen: SeenStore, keys: string[], now: Date): void {
  for (const key of keys) {
    if (seen[key] === undefined) {
      seen[key] = now.toISOString();
    }
  }
}

export function loadLastRun(path: string): Date | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as { last_success?: string };
    const time = data.last_success ? new Date(data.last_success) : null;
    return time !== null && !Number.isNaN(time.getTime()) ? time : null;
  } catch {
    return null;
  }
}

export function saveLastRun(path: string, now: Date): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ last_success: now.toISOString() }, null, 1) + '\n');
}
