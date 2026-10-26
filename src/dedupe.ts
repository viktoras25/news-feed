// Helpers for recognizing the same URL or the same story. Clustering itself lives in cluster.ts.

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

export function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let common = 0;
  for (const token of a) {
    if (b.has(token)) {
      common += 1;
    }
  }
  return common;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  const common = sharedTokenCount(a, b);
  const union = a.size + b.size - common;
  return common / union;
}
