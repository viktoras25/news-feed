import type { Item } from './types.ts';

export const TITLE_SIMILARITY_THRESHOLD = 0.75;

const TRACKING_PARAMS = ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'at_medium', 'at_campaign', 'wt_mc'];

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

export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  const parts = title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const part of parts) {
    // Words shorter than 3 characters (der, im, zu) say almost nothing about the story.
    if (part.length >= 3) {
      tokens.add(part);
    }
  }
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let common = 0;
  for (const token of a) {
    if (b.has(token)) {
      common += 1;
    }
  }
  const union = a.size + b.size - common;
  return common / union;
}

export type DedupeResult = {
  kept: Item[];
  removedByUrl: number;
  removedByTitle: number;
};

// Of duplicates, the entry with the lower priority number is kept; on a tie, the earliest.
export function dedupe(items: Item[]): DedupeResult {
  const sorted = [...items].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.published.getTime() - b.published.getTime();
  });

  const kept: Item[] = [];
  const keptTokens: Set<string>[] = [];
  const seenUrls = new Set<string>();
  let removedByUrl = 0;
  let removedByTitle = 0;

  for (const item of sorted) {
    const urlKey = normalizeUrl(item.url);
    if (seenUrls.has(urlKey)) {
      removedByUrl += 1;
      continue;
    }

    const tokens = titleTokens(item.title);
    let isSimilar = false;
    // Very short titles are not compared: too many false matches.
    if (tokens.size >= 3) {
      for (const other of keptTokens) {
        if (jaccard(tokens, other) >= TITLE_SIMILARITY_THRESHOLD) {
          isSimilar = true;
          break;
        }
      }
    }
    if (isSimilar) {
      removedByTitle += 1;
      continue;
    }

    seenUrls.add(urlKey);
    kept.push(item);
    keptTokens.push(tokens);
  }

  return { kept, removedByUrl, removedByTitle };
}
