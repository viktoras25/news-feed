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
      const row = entry as { name: string; priority: number; url: string };
      if (row.priority !== 1 && row.priority !== 2) {
        throw new Error(`feeds.yml: у "${row.name}" priority должен быть 1 или 2`);
      }
      feeds.push({ name: row.name, priority: row.priority, url: row.url, topic });
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
  };
}

export type FetchResult = {
  status: FeedStatusKind; // 'ok' если всё скачано и разобрано
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
  // Редкие фиды отдаются в ISO-8859-1: кодировка указана в прологе XML.
  const prolog = text.slice(0, 200).match(/encoding=["']([^"']+)["']/i);
  if (prolog && prolog[1].toLowerCase() !== 'utf-8') {
    try {
      text = new TextDecoder(prolog[1]).decode(buffer);
    } catch {
      // Неизвестная кодировка: оставляем utf-8.
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
      // 4xx не повторяем: страница не появится от второй попытки.
      const isClientError = error instanceof HttpError && error.code >= 400 && error.code < 500;
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      if (isClientError || isLastAttempt) {
        if (error instanceof HttpError) {
          return { status: 'http_error', detail: error.message, entries: [] };
        }
        if (isTimeout(error)) {
          return { status: 'timeout', detail: `нет ответа за ${FETCH_TIMEOUT_MS / 1000} с`, entries: [] };
        }
        const message = error instanceof Error ? error.message : String(error);
        // Сетевые ошибки (DNS, TLS, обрыв) считаем как недоступность.
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
    // Только http/https: никаких javascript: и data: ссылок из недоверенного фида.
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

// Простой пул: не больше MAX_PARALLEL загрузок одновременно, порядок результатов = порядок входа.
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
