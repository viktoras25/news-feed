import { createHash } from 'node:crypto';
import type { Entry, Item } from './types.ts';

// Only exact duplicates are merged here: the same URL or the same normalized title.
// Deciding that two differently worded entries are about one event is left to the reader.
// A duplicate is not thrown away: its source is added to the entry's source list.

const TRACKING_PARAMS = ['wt_mc', 'maca', 'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'at_medium', 'at_campaign'];

// Titles shorter than this are too generic to treat as the same entry ("Eilmeldung", "Liveblog").
const MIN_TITLE_LENGTH = 20;

const ID_LENGTH = 6;

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.includes(lower);
}

// The URL as shown to the reader: no tracking parameters, no fragment, lower-case host.
export function cleanUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }
  const kept = new URLSearchParams();
  for (const [name, value] of parsed.searchParams.entries()) {
    if (!isTrackingParam(name)) {
      kept.append(name, value);
    }
  }
  parsed.search = kept.toString();
  parsed.hash = '';
  return parsed.toString();
}

// The comparison key: https://www.Example.com/a/b/?utm_source=x&id=5#top  ->  example.com/a/b?id=5
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
    if (!isTrackingParam(key)) {
      keptParams.push(`${key}=${value}`);
    }
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

export function idFromKey(key: string, length: number = ID_LENGTH): string {
  return createHash('sha1').update(key).digest('hex').slice(0, length);
}

export type MergeResult = {
  entries: Entry[];
  removedByUrl: number;
  removedByTitle: number;
};

// Merges items with the same normalized URL or the same normalized title into one entry with a source list.
// `previousKeys` holds the normalized URLs of earlier exports: an entry with any of them is `seen_before`.
export function mergeDuplicates(items: Item[], previousKeys: Set<string>): MergeResult {
  // Earliest first: the earliest item gives the entry its title, URL and date.
  const sorted = [...items].sort((a, b) => a.published.getTime() - b.published.getTime());

  const groups: Item[][] = [];
  const groupByKey = new Map<string, number>();
  const groupByTitle = new Map<string, number>();
  let removedByUrl = 0;
  let removedByTitle = 0;

  for (const item of sorted) {
    const titleKey = normalizeTitle(item.title);
    const titleUsable = titleKey.length >= MIN_TITLE_LENGTH;

    let target = groupByKey.get(item.key);
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
    groupByKey.set(item.key, target);
    if (titleUsable) {
      groupByTitle.set(titleKey, target);
    }
  }

  const entries = groups.map((group) => makeEntry(group, previousKeys));
  assignIds(entries, groups);
  return { entries, removedByUrl, removedByTitle };
}

function makeEntry(group: Item[], previousKeys: Set<string>): Entry {
  const head = group[0];

  // Snippet of the earliest item that has one.
  let snippet = '';
  for (const item of group) {
    if (snippet === '') {
      snippet = item.snippet;
    }
  }

  const sources = group.map((item) => ({ name: item.source, url: item.url, published: item.published }));
  const seenBefore = group.some((item) => previousKeys.has(item.key));

  return {
    id: '',
    group: head.group,
    title: head.title,
    url: head.url,
    published: head.published,
    snippet,
    sources,
    status: seenBefore ? 'seen_before' : 'new',
  };
}

// The id is the start of the sha1 of the head's normalized URL. If two different entries collide,
// the later one gets a longer id, so ids are always unique.
function assignIds(entries: Entry[], groups: Item[][]): void {
  const used = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const key = groups[i][0].key;
    let length = ID_LENGTH;
    let id = idFromKey(key, length);
    while (used.has(id) && length < 40) {
      length += 2;
      id = idFromKey(key, length);
    }
    used.add(id);
    entries[i].id = id;
  }
}

// The distinct source names of an entry, in order.
export function sourceNames(entry: Entry): string[] {
  const names: string[] = [];
  for (const source of entry.sources) {
    if (!names.includes(source.name)) {
      names.push(source.name);
    }
  }
  return names;
}
