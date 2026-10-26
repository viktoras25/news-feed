import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe, jaccard, normalizeUrl, titleTokens } from '../src/dedupe.ts';
import type { Item } from '../src/types.ts';

function makeItem(overrides: Partial<Item>): Item {
  return {
    topic: 'national',
    source: 'Test',
    priority: 1,
    title: 'Titel',
    url: 'https://example.com/a',
    published: new Date('2026-10-26T06:00:00Z'),
    snippet: '',
    searchText: '',
    ...overrides,
  };
}

test('normalizeUrl убирает www, utm, fragment и хвостовой слеш', () => {
  assert.equal(
    normalizeUrl('https://www.Example.com/a/b/?utm_source=x&id=5#top'),
    'example.com/a/b?id=5',
  );
});

test('normalizeUrl считает http и https одним адресом', () => {
  assert.equal(normalizeUrl('http://example.com/a'), normalizeUrl('https://example.com/a/'));
});

test('jaccard похожих заголовков выше порога', () => {
  const a = titleTokens('Bundestag beschließt neues Rentenpaket mit großer Mehrheit');
  const b = titleTokens('Bundestag beschließt neues Rentenpaket mit großer Mehrheit - Bericht');
  assert.ok(jaccard(a, b) >= 0.75);
});

test('dedupe убирает дубль по URL и оставляет priority 1', () => {
  const first = makeItem({ source: 'ARD', priority: 2, url: 'https://example.com/a?utm_source=x' });
  const second = makeItem({ source: 'Tagesschau', priority: 1, url: 'https://www.example.com/a' });
  const result = dedupe([first, second]);
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].source, 'Tagesschau');
  assert.equal(result.removedByUrl, 1);
});

test('dedupe убирает один сюжет из разных источников по заголовку', () => {
  const zdf = makeItem({
    source: 'ZDFheute',
    url: 'https://zdf.de/1',
    title: 'Bundestag beschließt neues Rentenpaket mit großer Mehrheit',
  });
  const tagesschau = makeItem({
    source: 'Tagesschau',
    url: 'https://tagesschau.de/2',
    title: 'Bundestag beschließt neues Rentenpaket mit großer Mehrheit',
    published: new Date('2026-10-26T07:00:00Z'),
  });
  const other = makeItem({
    source: 'Spiegel',
    url: 'https://spiegel.de/3',
    title: 'Leipzig sperrt Brücke wegen Bauarbeiten',
  });
  const result = dedupe([zdf, tagesschau, other]);
  assert.equal(result.kept.length, 2);
  assert.equal(result.removedByTitle, 1);
  // With equal priority the earlier entry is kept.
  assert.ok(result.kept.some((item) => item.source === 'ZDFheute'));
});

test('dedupe не склеивает короткие разные заголовки', () => {
  const a = makeItem({ url: 'https://a.de/1', title: 'Eilmeldung Berlin' });
  const b = makeItem({ url: 'https://a.de/2', title: 'Eilmeldung Berlin' });
  const result = dedupe([a, b]);
  assert.equal(result.kept.length, 2);
});
