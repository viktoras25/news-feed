import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capClusters, clusterItems, distinctSources } from '../src/cluster.ts';
import type { Item, Keywords } from '../src/types.ts';

const keywords: Keywords = {
  include: [],
  wordBoundary: ['KI'],
  exclude: [],
  excludeTitlePrefixes: [],
  excludeUrlParts: [],
  tags: { ai: ['KI'], tax: ['Steuer'], leipzig: ['Leipzig'] },
};

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
    feedRank: 0,
    ...overrides,
  };
}

test('same URL with tracking parameters is dropped as a duplicate', () => {
  const first = makeItem({ source: 'ARD', priority: 2, url: 'https://example.com/a?utm_source=x' });
  const second = makeItem({ source: 'Tagesschau', priority: 1, url: 'https://www.example.com/a' });
  const result = clusterItems([first, second], keywords);
  assert.equal(result.clusters.length, 1);
  assert.equal(result.removedByUrl, 1);
  // The priority 1 entry wins.
  assert.equal(result.clusters[0].head.source, 'Tagesschau');
});

test('one story from different sources becomes one cluster with all sources', () => {
  const zdf = makeItem({
    source: 'ZDFheute',
    url: 'https://zdf.de/1',
    title: 'Serbien: Opposition gewinnt Parlamentswahl, Vucic gesteht Niederlage ein',
  });
  const tagesschau = makeItem({
    source: 'Tagesschau',
    url: 'https://tagesschau.de/2',
    title: 'Serbien: Opposition gewinnt Parlamentswahl klar, Vucic räumt Niederlage ein',
    published: new Date('2026-10-26T07:00:00Z'),
  });
  const other = makeItem({
    source: 'Spiegel',
    url: 'https://spiegel.de/3',
    title: 'Leipzig sperrt Brücke wegen Bauarbeiten',
  });
  const result = clusterItems([zdf, tagesschau, other], keywords);
  assert.equal(result.clusters.length, 2);
  const serbia = result.clusters.find((c) => c.members.length === 2);
  assert.ok(serbia);
  assert.deepEqual(distinctSources(serbia).sort(), ['Tagesschau', 'ZDFheute']);
  // With equal priority the earlier entry is the head.
  assert.equal(serbia.head.source, 'ZDFheute');
  // Publication time of a cluster is the earliest member time.
  assert.equal(serbia.published.toISOString(), '2026-10-26T06:00:00.000Z');
});

test('two titles sharing a single word are not merged', () => {
  const a = makeItem({ url: 'https://a.de/1', title: 'Eilmeldung Berlin Bahnstreik' });
  const b = makeItem({ url: 'https://a.de/2', title: 'Eilmeldung Hamburg Hafenstreik' });
  assert.equal(clusterItems([a, b], keywords).clusters.length, 2);
});

test('cluster gets tags from the text of all members', () => {
  const a = makeItem({ url: 'https://a.de/1', title: 'Neue KI-Regeln für Unternehmen in Leipzig' });
  const b = makeItem({ url: 'https://b.de/1', title: 'Kinder und Schule' });
  const result = clusterItems([a, b], keywords);
  const tagged = result.clusters.find((c) => c.head.url === 'https://a.de/1');
  const plain = result.clusters.find((c) => c.head.url === 'https://b.de/1');
  assert.deepEqual(tagged?.tags.sort(), ['ai', 'leipzig']);
  assert.deepEqual(plain?.tags, []);
});

test('cluster id is stable for the same head URL', () => {
  const item = makeItem({ url: 'https://www.example.com/a/?utm_source=x' });
  const again = makeItem({ url: 'https://example.com/a' });
  const first = clusterItems([item], keywords).clusters[0];
  const second = clusterItems([again], keywords).clusters[0];
  assert.equal(first.id, second.id);
  assert.equal(first.id.length, 10);
});

test('capClusters limits a topic and prefers multi-source events', () => {
  const items: Item[] = [];
  for (let i = 0; i < 20; i++) {
    items.push(makeItem({ url: `https://a.de/${i}`, title: `Einzelmeldung Nummer${i} alpha${i}`, feedRank: i }));
  }
  // An event reported by two sources, listed last in the input.
  items.push(makeItem({ source: 'A', url: 'https://x.de/1', title: 'Gemeinsames Großereignis Hauptstadt Sperrung' }));
  items.push(makeItem({ source: 'B', url: 'https://y.de/1', title: 'Großereignis Hauptstadt Sperrung gemeinsam' }));
  const clusters = clusterItems(items, keywords).clusters;
  const capped = capClusters(clusters, 5, 50);
  assert.equal(capped.length, 5);
  assert.equal(distinctSources(capped[0]).length, 2);
});

test('capClusters serves topics round-robin when the total limit applies', () => {
  const items: Item[] = [];
  for (let i = 0; i < 10; i++) {
    items.push(makeItem({ topic: 'national', url: `https://a.de/${i}`, title: `Politik Meldung${i} eins${i}` }));
  }
  items.push(makeItem({ topic: 'leipzig_saxony', url: 'https://l.de/1', title: 'Lokale Meldung Leipzig' }));
  const capped = capClusters(clusterItems(items, keywords).clusters, 12, 4);
  assert.equal(capped.length, 4);
  assert.ok(capped.some((c) => c.topic === 'leipzig_saxony'));
});

test('capClusters takes the top of each feed before the lower entries', () => {
  const noisy = [0, 1, 2, 3].map((i) =>
    makeItem({
      source: 'Laut',
      url: `https://laut.de/${i}`,
      title: `Laut Thema${i} wort${i}`,
      feedRank: i,
      published: new Date(`2026-10-26T0${9 - i}:00:00Z`),
    }),
  );
  const quiet = makeItem({
    source: 'Leise',
    url: 'https://leise.de/0',
    title: 'Leise Thema wichtig',
    feedRank: 0,
    published: new Date('2026-10-25T01:00:00Z'),
  });
  const capped = capClusters(clusterItems([...noisy, quiet], keywords).clusters, 12, 2);
  assert.ok(capped.some((c) => c.head.source === 'Leise'));
});
