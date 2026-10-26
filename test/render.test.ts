import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clusterItems } from '../src/cluster.ts';
import { formatBerlin, renderNews, renderNewsJson, safeLinkTarget } from '../src/render.ts';
import type { FeedReport, Item, Keywords } from '../src/types.ts';

const keywords: Keywords = {
  include: [],
  wordBoundary: [],
  exclude: [],
  excludeTitlePrefixes: [],
  excludeUrlParts: [],
  tags: { tax: ['Steuer'] },
};

const now = new Date('2026-10-26T07:00:00Z');

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

function makeReport(name: string, status: FeedReport['status'], kept: number): FeedReport {
  return {
    feed: { name, priority: 1, url: `https://${name}.example/rss`, topic: 'national', requireKeywords: false, urlMustContain: [] },
    status,
    detail: status === 'http_error' ? 'HTTP 404' : '',
    fetched: 0,
    inWindow: 0,
    afterNoise: 0,
    kept,
    droppedInjection: 0,
    strippedSnippets: 0,
  };
}

test('formatBerlin converts UTC to Berlin (summer time)', () => {
  assert.equal(formatBerlin(new Date('2026-07-01T06:15:00Z')), '2026-07-01 08:15');
});

test('safeLinkTarget escapes parentheses and spaces', () => {
  assert.equal(safeLinkTarget('https://a.de/x (1)'), 'https://a.de/x%20%281%29');
});

test('renderNews does not let feed text create markup', () => {
  const item = makeItem({
    source: 'Evil',
    title: '# Fake heading [click](http://evil.example)',
    snippet: '- list item\n## more',
  });
  const clusters = clusterItems([item], keywords).clusters;
  const output = renderNews(clusters, ['national'], [], now, 72);
  const entryLine = output.split('\n').find((line) => line.startsWith('- **Evil**'));
  assert.ok(entryLine);
  assert.ok(!entryLine.includes('[click]('));
  assert.ok(entryLine.includes('\\[click\\]'));
  // No heading markup appeared on any line except our own.
  const headings = output.split('\n').filter((line) => line.startsWith('#'));
  assert.deepEqual(headings, ['# News for 2026-10-26', '## Germany: politics and general news']);
});

test('renderNews lists all sources of an event on one line', () => {
  const a = makeItem({ source: 'Tagesschau', url: 'https://t.de/1', title: 'Lula gewinnt Stichwahl in Brasilien' });
  const b = makeItem({ source: 'Spiegel', url: 'https://s.de/1', title: 'Brasilien: Lula gewinnt Stichwahl knapp' });
  const clusters = clusterItems([a, b], keywords).clusters;
  const output = renderNews(clusters, ['national'], [], now, 24);
  const lines = output.split('\n').filter((line) => line.startsWith('- **'));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('- **Tagesschau, Spiegel**'));
  assert.ok(output.includes('events: 1'));
});

test('renderNews skips empty topics, prints the window and the health line', () => {
  const reports = [makeReport('Alpha', 'ok', 3), makeReport('Beta', 'http_error', 0), makeReport('Gamma', 'no_dates', 0)];
  const output = renderNews([], ['national', 'economy'], reports, now, 24);
  assert.ok(output.includes('window: 24 h'));
  assert.ok(!output.includes('## '));
  const healthLine = output.split('\n').find((line) => line.startsWith('Health:'));
  assert.ok(healthLine);
  assert.ok(healthLine.includes('3 feeds'));
  assert.ok(healthLine.includes('failed: Beta \\(http\\_error\\)'));
  assert.ok(healthLine.includes('empty: Gamma'));
  assert.ok(healthLine.includes('Alpha 3'));
  assert.ok(healthLine.includes('feeds with no entries: 2'));
});

test('renderNewsJson has clusters with sources, topics and an empty why_relevant', () => {
  const a = makeItem({ source: 'Tagesschau', url: 'https://t.de/1', title: 'Neue Steuer auf Zucker beschlossen' });
  const b = makeItem({ source: 'Spiegel', url: 'https://s.de/1', title: 'Steuer auf Zucker beschlossen: Das ändert sich' });
  const clusters = clusterItems([a, b], keywords).clusters;
  const reports = [makeReport('Tagesschau', 'ok', 1), makeReport('Spiegel', 'ok', 1), makeReport('Dead', 'http_error', 0)];
  const data = JSON.parse(renderNewsJson(clusters, ['national'], reports, now, 24));

  assert.equal(data.generated_at, '2026-10-26T07:00:00.000Z');
  assert.equal(data.window_hours, 24);
  assert.equal(data.clusters.length, 1);
  const cluster = data.clusters[0];
  assert.equal(cluster.sources.length, 2);
  assert.deepEqual(cluster.topics, ['tax']);
  assert.equal(cluster.why_relevant, null);
  assert.equal(typeof cluster.id, 'string');
  assert.deepEqual(data.health.failed, [{ name: 'Dead', status: 'http_error', detail: 'HTTP 404' }]);
  assert.equal(data.health.entries_per_feed.Tagesschau, 1);
});
