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

test('windowHours: 72 hours on Sunday and Monday, otherwise 24', () => {
  assert.equal(windowHours(new Date('2026-10-25T04:00:00Z')), 72); // Sunday
  assert.equal(windowHours(new Date('2026-10-26T04:00:00Z')), 72); // Monday
  assert.equal(windowHours(new Date('2026-10-27T04:00:00Z')), 24); // Tuesday
  assert.equal(windowHours(new Date('2026-10-31T04:00:00Z')), 24); // Saturday
});

test('isInWindow handles the boundary and entries from the future', () => {
  const now = new Date('2026-10-27T10:00:00Z');
  assert.equal(isInWindow(new Date('2026-10-26T11:00:00Z'), now, 24), true);
  assert.equal(isInWindow(new Date('2026-10-26T09:00:00Z'), now, 24), false);
  assert.equal(isInWindow(new Date('2026-10-27T10:30:00Z'), now, 24), true);
  assert.equal(isInWindow(new Date('2026-10-27T14:00:00Z'), now, 24), false);
});

test('KI is matched only as a whole word', () => {
  assert.equal(matchesInclude('Neue KI-Regeln in der EU', keywords), true);
  assert.equal(matchesInclude('Kinder spielen im Park', keywords), false);
});

test('include finds a word inside a compound (Einkommensteuer)', () => {
  assert.equal(matchesInclude('Reform der Einkommensteuer', keywords), true);
});

test('exclude matches from the start of a word', () => {
  assert.equal(matchesExclude('Promis feiern', keywords), true);
  // A match in the middle of a word does not count.
  assert.equal(matchesExclude('Impromptu im Park', keywords), false);
});

test('priority 2 passes only with keywords', () => {
  const items = [makeItem('Rente steigt', 30, 2), makeItem('Wetter morgen', 20, 2)];
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Rente steigt');
});

test('priority 1 passes without keywords, but noise is dropped', () => {
  const items = [makeItem('Wetter morgen', 30, 1), makeItem('Bundesliga Ergebnisse', 20, 1)];
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Wetter morgen');
});

test('priority 1: at most 8 entries per feed', () => {
  const items: Item[] = [];
  for (let i = 0; i < 12; i++) {
    items.push(makeItem(`Meldung ${i}`, i * 10, 1));
  }
  assert.equal(filterFeedItems(items, keywords).length, 8);
});

test('capPerTopic limits a topic and prefers priority 1', () => {
  const items: Item[] = [];
  for (let i = 0; i < 20; i++) {
    items.push(makeItem(`Zwei ${i}`, i, 2));
  }
  items.push(makeItem('Eins wichtig', 500, 1));
  const result = capPerTopic(items, 15);
  assert.equal(result.length, 15);
  assert.equal(result[0].title, 'Eins wichtig');
});

test('capPerTopic takes entries round-robin across feeds', () => {
  const items: Item[] = [];
  // A noisy feed with very fresh entries and a quiet feed with old ones.
  for (let i = 0; i < 10; i++) {
    items.push({ ...makeItem(`Laut ${i}`, i, 1), source: 'Laut' });
  }
  items.push({ ...makeItem('Leise', 600, 1), source: 'Leise' });
  const result = capPerTopic(items, 3);
  assert.equal(result.length, 3);
  assert.ok(result.some((item) => item.source === 'Leise'));
});

test('priority 2: at most 5 newest entries', () => {
  const items: Item[] = [];
  for (let i = 0; i < 8; i++) {
    items.push(makeItem(`Steuer Meldung ${i}`, i * 10, 2));
  }
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 5);
  assert.equal(result[0].title, 'Steuer Meldung 0');
  assert.equal(result[4].title, 'Steuer Meldung 4');
});
