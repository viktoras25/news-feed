import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  capPerTopic,
  filterFeedItems,
  isInWindow,
  matchesExclude,
  matchesInclude,
  windowHours,
} from '../src/filter.ts';
import type { Item, Keywords } from '../src/types.ts';

const keywords: Keywords = {
  include: ['Steuer', 'Rente', 'KI', 'EZB', 'Leipzig'],
  wordBoundary: ['KI', 'EZB'],
  exclude: ['Bundesliga', 'Promi', 'Gala'],
};

function makeItem(title: string, minutesAgo: number, priority: 1 | 2): Item {
  const now = new Date('2026-10-27T10:00:00Z').getTime();
  return {
    topic: 'national',
    source: 'Test',
    priority,
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    published: new Date(now - minutesAgo * 60_000),
    snippet: '',
    searchText: '',
  };
}

test('windowHours: 72 часа в воскресенье и понедельник, иначе 24', () => {
  assert.equal(windowHours(new Date('2026-10-25T04:00:00Z')), 72); // воскресенье
  assert.equal(windowHours(new Date('2026-10-26T04:00:00Z')), 72); // понедельник
  assert.equal(windowHours(new Date('2026-10-27T04:00:00Z')), 24); // вторник
  assert.equal(windowHours(new Date('2026-10-31T04:00:00Z')), 24); // суббота
});

test('isInWindow учитывает границу и записи из будущего', () => {
  const now = new Date('2026-10-27T10:00:00Z');
  assert.equal(isInWindow(new Date('2026-10-26T11:00:00Z'), now, 24), true);
  assert.equal(isInWindow(new Date('2026-10-26T09:00:00Z'), now, 24), false);
  assert.equal(isInWindow(new Date('2026-10-27T10:30:00Z'), now, 24), true);
  assert.equal(isInWindow(new Date('2026-10-27T14:00:00Z'), now, 24), false);
});

test('KI ищется только как целое слово', () => {
  assert.equal(matchesInclude('Neue KI-Regeln in der EU', keywords), true);
  assert.equal(matchesInclude('Kinder spielen im Park', keywords), false);
});

test('include находит слово внутри составного (Einkommensteuer)', () => {
  assert.equal(matchesInclude('Reform der Einkommensteuer', keywords), true);
});

test('exclude ищет с начала слова', () => {
  assert.equal(matchesExclude('Promis feiern', keywords), true);
  // Совпадение в середине слова не считается.
  assert.equal(matchesExclude('Impromptu im Park', keywords), false);
});

test('priority 2 пропускается только по ключевым словам', () => {
  const items = [makeItem('Rente steigt', 30, 2), makeItem('Wetter morgen', 20, 2)];
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Rente steigt');
});

test('priority 1 пропускается без ключевых слов, но шум отсекается', () => {
  const items = [makeItem('Wetter morgen', 30, 1), makeItem('Bundesliga Ergebnisse', 20, 1)];
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Wetter morgen');
});

test('priority 1: максимум 8 записей на фид', () => {
  const items: Item[] = [];
  for (let i = 0; i < 12; i++) {
    items.push(makeItem(`Meldung ${i}`, i * 10, 1));
  }
  assert.equal(filterFeedItems(items, keywords).length, 8);
});

test('capPerTopic ограничивает тему и предпочитает priority 1', () => {
  const items: Item[] = [];
  for (let i = 0; i < 20; i++) {
    items.push(makeItem(`Zwei ${i}`, i, 2));
  }
  items.push(makeItem('Eins wichtig', 500, 1));
  const result = capPerTopic(items, 15);
  assert.equal(result.length, 15);
  assert.equal(result[0].title, 'Eins wichtig');
});

test('capPerTopic берёт записи по кругу между фидами', () => {
  const items: Item[] = [];
  // Шумный фид с очень свежими записями и тихий фид со старыми.
  for (let i = 0; i < 10; i++) {
    items.push({ ...makeItem(`Laut ${i}`, i, 1), source: 'Laut' });
  }
  items.push({ ...makeItem('Leise', 600, 1), source: 'Leise' });
  const result = capPerTopic(items, 3);
  assert.equal(result.length, 3);
  assert.ok(result.some((item) => item.source === 'Leise'));
});

test('priority 2: максимум 5 самых свежих записей', () => {
  const items: Item[] = [];
  for (let i = 0; i < 8; i++) {
    items.push(makeItem(`Steuer Meldung ${i}`, i * 10, 2));
  }
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 5);
  assert.equal(result[0].title, 'Steuer Meldung 0');
  assert.equal(result[4].title, 'Steuer Meldung 4');
});
