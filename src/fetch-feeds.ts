import { readFileSync } from 'node:fs';
import Parser from 'rss-parser';
import { parse as parseYaml } from 'yaml';
import type { FeedConfig, FeedStatusKind, Keywords, RawEntry } from './types.ts';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
export const MAX_PARALLEL = 8;

const USER_AGENT = 'Mozilla/5.0 (compatible; news-feed-bot/1.0; personal RSS digest)';

export function loadFeeds(path: string): FeedConfig[] {
  const data = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown[]>;
  const feeds: FeedConfig[] = [];
  for (const topic of Object.keys(data)) {
    const entries = data[topic];
    for (const entry of entries) {
      const row = entry as {
        name: string;
        priority: number;
        url: string;
        requireKeywords?: boolean;
        urlMustContain?: string[];
      };
      if (row.priority !== 1 && row.priority !== 2) {
        throw new Error(`feeds.yml: priority of "${row.name}" must be 1 or 2`);
      }
      feeds.push({
        name: row.name,
        priority: row.priority,
        url: row.url,
        topic,
        requireKeywords: row.requireKeywords ?? false,
        urlMustContain: row.urlMustContain ?? [],
      });
    }
  }
  return feeds;
}

export function loadKeywords(path: string): Keywords {
  const data = parseYaml(readFileSync(path, 'utf8')) as Partial<Keywords>;
  return {
    include: data.include ?? [],
    wordBoundary: data.wordBoundary ?? [],
    exclude: data.exclude ?? [],
    excludeTitlePrefixes: data.excludeTitlePrefixes ?? [],
    excludeUrlParts: data.excludeUrlParts ?? [],
    tags: data.tags ?? {},
  };
}

export type FetchResult = {
  status: FeedStatusKind; // 'ok' if downloaded and parsed successfully
  detail: string;
  entries: RawEntry[];
};

class HttpError extends Error {
  code: number;
  constructor(code: number) {
    super(`HTTP ${code}`);
    this.code = code;
  }
}

async function downloadText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new HttpError(response.status);
  }

  const buffer = await response.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buffer);
  // Rare feeds are served as ISO-8859-1; the encoding is declared in the XML prolog.
  const prolog = text.slice(0, 200).match(/encoding=["']([^"']+)["']/i);
  if (prolog && prolog[1].toLowerCase() !== 'utf-8') {
    try {
      text = new TextDecoder(prolog[1]).decode(buffer);
    } catch {
      // Unknown encoding: keep utf-8.
    }
  }
  return text;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export async function fetchFeed(feed: FeedConfig): Promise<FetchResult> {
  let text = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      text = await downloadText(feed.url);
      break;
    } catch (error) {
      // Do not retry 4xx: a second attempt will not make the page appear.
      const isClientError = error instanceof HttpError && error.code >= 400 && error.code < 500;
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      if (isClientError || isLastAttempt) {
        if (error instanceof HttpError) {
          return { status: 'http_error', detail: error.message, entries: [] };
        }
        if (isTimeout(error)) {
          return { status: 'timeout', detail: `no response within ${FETCH_TIMEOUT_MS / 1000} s`, entries: [] };
        }
        const message = error instanceof Error ? error.message : String(error);
        // Network errors (DNS, TLS, dropped connection) count as unavailable.
        return { status: 'http_error', detail: message, entries: [] };
      }
    }
  }

  const parser = new Parser();
  let parsed;
  try {
    parsed = await parser.parseString(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'parse_error', detail: message.slice(0, 120), entries: [] };
  }

  const entries: RawEntry[] = [];
  for (const item of parsed.items) {
    const link = (item.link ?? '').trim();
    // http/https only: no javascript: or data: links from an untrusted feed.
    if (!/^https?:\/\//i.test(link)) {
      continue;
    }
    const dateText = item.isoDate ?? item.pubDate ?? '';
    const date = dateText ? new Date(dateText) : null;
    entries.push({
      title: item.title ?? '',
      link,
      date: date !== null && !Number.isNaN(date.getTime()) ? date : null,
      description: item.contentSnippet ?? item.summary ?? item.content ?? '',
    });
  }

  return { status: 'ok', detail: '', entries };
}

// Simple pool: at most MAX_PARALLEL downloads at once; results keep the input order.
export async function fetchAll(feeds: FeedConfig[]): Promise<FetchResult[]> {
  const results: FetchResult[] = new Array(feeds.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= feeds.length) {
        return;
      }
      results[index] = await fetchFeed(feeds[index]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < MAX_PARALLEL; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
