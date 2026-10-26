import type { Item, Keywords } from './types.ts';

export const MAX_PRIORITY1_PER_FEED = 8;
export const MAX_PRIORITY2_PER_FEED = 5;
// Верхняя граница на тему, чтобы news.md оставался компактным (около 40-50 КБ).
export const MAX_PER_TOPIC = 15;

// В воскресенье и понедельник (по Берлину) берём 72 часа, иначе пятница-суббота потеряются.
export function windowHours(now: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Europe/Berlin',
  }).format(now);
  if (weekday === 'Sun' || weekday === 'Mon') {
    return 72;
  }
  return 24;
}

export function isInWindow(published: Date, now: Date, hours: number): boolean {
  const ageMs = now.getTime() - published.getTime();
  // Небольшой допуск вперёд: часы источников могут уходить вперёд.
  const oneHourMs = 60 * 60 * 1000;
  if (ageMs < -oneHourMs) {
    return false;
  }
  return ageMs <= hours * oneHourMs;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Короткие слова (KI, EZB) ищем как отдельное слово и с учётом регистра.
function matchesWholeWord(text: string, word: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, 'u');
  return pattern.test(text);
}

export function matchesInclude(text: string, keywords: Keywords): boolean {
  const lower = text.toLowerCase();
  for (const word of keywords.include) {
    if (keywords.wordBoundary.includes(word)) {
      if (matchesWholeWord(text, word)) {
        return true;
      }
    } else if (lower.includes(word.toLowerCase())) {
      return true;
    }
  }
  return false;
}

// Шумовые слова ищем с начала слова: "Promi" найдёт "Promis", но "Gala" не найдёт "Galapagos".
export function matchesExclude(text: string, keywords: Keywords): boolean {
  for (const word of keywords.exclude) {
    const pattern = new RegExp(`(^|[^\\p{L}])${escapeRegExp(word)}`, 'iu');
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

// Фильтр шума для записей одного фида. Записи на входе уже внутри окна времени.
export function filterFeedItems(items: Item[], keywords: Keywords): Item[] {
  const result: Item[] = [];

  // Новые записи первыми, чтобы лимит для priority 2 оставлял самые свежие.
  const sorted = [...items].sort((a, b) => b.published.getTime() - a.published.getTime());

  for (const item of sorted) {
    const text = item.title + ' ' + item.searchText;
    if (matchesExclude(text, keywords)) {
      continue;
    }
    if (item.priority === 2 && !matchesInclude(text, keywords)) {
      continue;
    }
    result.push(item);
    const limit = item.priority === 1 ? MAX_PRIORITY1_PER_FEED : MAX_PRIORITY2_PER_FEED;
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

// Оставляет не больше max записей на тему. Порядок отбора: сначала priority 1, внутри priority
// "по кругу" между фидами (по одной самой свежей записи от каждого, потом по второй и т.д.),
// чтобы один шумный фид не вытеснил остальные. Вызывается после дедупликации.
export function capPerTopic(items: Item[], max: number): Item[] {
  // Место записи внутри своего фида: 0 = самая свежая.
  const newestFirst = [...items].sort((a, b) => b.published.getTime() - a.published.getTime());
  const seenPerFeed = new Map<string, number>();
  const rankByItem = new Map<Item, number>();
  for (const item of newestFirst) {
    const feedKey = item.topic + '|' + item.source;
    const rank = seenPerFeed.get(feedKey) ?? 0;
    rankByItem.set(item, rank);
    seenPerFeed.set(feedKey, rank + 1);
  }

  const sorted = [...newestFirst].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    const rankA = rankByItem.get(a) ?? 0;
    const rankB = rankByItem.get(b) ?? 0;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return b.published.getTime() - a.published.getTime();
  });

  const countByTopic = new Map<string, number>();
  const result: Item[] = [];
  for (const item of sorted) {
    const count = countByTopic.get(item.topic) ?? 0;
    if (count >= max) {
      continue;
    }
    countByTopic.set(item.topic, count + 1);
    result.push(item);
  }
  return result;
}
