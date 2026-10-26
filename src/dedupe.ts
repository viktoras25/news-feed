import { createHash } from 'node:crypto';
import type { Entry, Item } from './types.ts';

// Only exact duplicates are merged here: the same URL or the same normalized title.
// Deciding that two differently worded entries are about one event is left to the reader.

const TRACKING_PARAMS = ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'at_medium', 'at_campaign', 'wt_mc'];

// Titles shorter than this are too generic to treat as the same entry ("Eilmeldung", "Liveblog").
const MIN_TITLE_LENGTH = 20;

// https://www.Example.com/a/b/?utm_source=x&id=5#top  ->  example.com/a/b?id=5
export function normalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.trim().toLowerCase();
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '');

  const keptParams: string[] = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith('utm_') || TRACKING_PARAMS.includes(lowerKey)) {
      continue;
    }
    keptParams.push(`${key}=${value}`);
  }
  keptParams.sort();

  const query = keptParams.length > 0 ? '?' + keptParams.join('&') : '';
  return host + path + query;
}

// "Serbien: Vučić gesteht Niederlage ein!" and "serbien vucic gesteht niederlage ein" are the same title.
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type MergeResult = {
  entries: Entry[];
  removedByUrl: number;
  removedByTitle: number;
};

// Merges items with the same normalized URL or the same normalized title into one entry that lists
// all its sources. `previousUrls` holds the normalized URLs of earlier exports (for seenBefore).
export function mergeDuplicates(items: Item[], previousUrls: Set<string>): MergeResult {
  // Best priority first, then earliest: the head of an entry is the best-ranked source.
  const sorted = [...items].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.published.getTime() - b.published.getTime();
  });

  const groups: Item[][] = [];
  const groupByUrl = new Map<string, number>();
  const groupByTitle = new Map<string, number>();
  let removedByUrl = 0;
  let removedByTitle = 0;

  for (const item of sorted) {
    const urlKey = normalizeUrl(item.url);
    const titleKey = normalizeTitle(item.title);
    const titleUsable = titleKey.length >= MIN_TITLE_LENGTH;

    let target = groupByUrl.get(urlKey);
    if (target !== undefined) {
      removedByUrl += 1;
    } else if (titleUsable && groupByTitle.has(titleKey)) {
      target = groupByTitle.get(titleKey);
      removedByTitle += 1;
    }

    if (target === undefined) {
      target = groups.length;
      groups.push([item]);
    } else {
      groups[target].push(item);
    }
    groupByUrl.set(urlKey, target);
    if (titleUsable) {
      groupByTitle.set(titleKey, target);
    }
  }

  const entries = groups.map((group) => makeEntry(group, previousUrls));
  return { entries, removedByUrl, removedByTitle };
}

function makeEntry(group: Item[], previousUrls: Set<string>): Entry {
  const head = group[0];

  // Snippet of the head, or the first non-empty one if the head has none.
  let snippet = head.snippet;
  for (const item of group) {
    if (snippet === '') {
      snippet = item.snippet;
    }
  }

  let published = head.published;
  let seenBefore = false;
  for (const item of group) {
    if (item.published.getTime() < published.getTime()) {
      published = item.published;
    }
    if (previousUrls.has(normalizeUrl(item.url))) {
      seenBefore = true;
    }
  }

  const id = createHash('sha1').update(normalizeUrl(head.url)).digest('hex').slice(0, 10);
  return { id, topic: head.topic, head, items: group, snippet, published, seenBefore };
}

// The distinct source names of an entry, in order.
export function sourceNames(entry: Entry): string[] {
  const names: string[] = [];
  for (const item of entry.items) {
    if (!names.includes(item.source)) {
      names.push(item.source);
    }
  }
  return names;
}
