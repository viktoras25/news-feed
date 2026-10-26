import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeDuplicates } from '../src/dedupe.ts';
import { formatBerlin, renderNews, renderNewsJson, safeLinkTarget } from '../src/render.ts';
import type { FeedReport, Item } from '../src/types.ts';

const now = new Date('2026-10-26T07:00:00Z');

function makeItem(overrides: Partial<Item>): Item {
  return {
    topic: 'national',
    source: 'Test',
    priority: 1,
    title: 'Ein ausreichend langer Titel zum Vergleichen',
    url: 'https://example.com/a',
    published: new Date('2026-10-26T06:00:00Z'),
    snippet: '',
    ...overrides,
  };
}

function makeReport(name: string, status: FeedReport['status']): FeedReport {
  return {
    feed: { name, priority: 1, url: `https://${name}.example/rss`, topic: 'national', urlMustContain: [] },
    status,
    detail: status === 'http_error' ? 'HTTP 404' : '',
    fetched: 0,
    inWindow: 0,
    afterFilter: 0,
    kept: 0,
    droppedInjection: 0,
    strippedSnippets: 0,
  };
}

function entriesOf(items: Item[], previous: string[] = []) {
  return mergeDuplicates(items, new Set(previous)).entries;
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
  const output = renderNews(entriesOf([item]), ['national'], [], now, 72);
  const entryLine = output.split('\n').find((line) => line.includes('Evil'));
  assert.ok(entryLine);
  assert.ok(!entryLine.includes('[click]('));
  assert.ok(entryLine.includes('\\[click\\]'));
  // No heading markup appeared on any line except our own.
  const headings = output.split('\n').filter((line) => line.startsWith('#'));
  assert.deepEqual(headings, ['# News for 2026-10-26', '## Germany: politics and general news']);
});

test('an entry is one line: time, sources, linked title, status, snippet', () => {
  const a = makeItem({ source: 'Spiegel', url: 'https://s.de/1', title: 'Gleiche lange Schlagzeile zum Test', snippet: 'Kurztext.' });
  const b = makeItem({ source: 'SZ', url: 'https://sz.de/1', title: 'Gleiche lange Schlagzeile zum Test' });
  const output = renderNews(entriesOf([a, b]), ['national'], [], now, 24);
  const lines = output.split('\n').filter((line) => line.startsWith('- '));
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    '- 2026-10-26 07:00 · Spiegel, SZ · [Gleiche lange Schlagzeile zum Test](https://s.de/1) · new — Kurztext.',
  );
});

test('the header carries window, counts and health; seen entries are marked', () => {
  const items = [
    makeItem({ url: 'https://example.com/old', title: 'Gestern schon gemeldete Nachricht' }),
    makeItem({ url: 'https://example.com/new', title: 'Heute neu gemeldete Nachricht' }),
  ];
  const reports = [makeReport('Alpha', 'ok'), makeReport('Beta', 'http_error'), makeReport('Gamma', 'empty'), makeReport('Delta', 'quiet')];
  const output = renderNews(entriesOf(items, ['example.com/old']), ['national'], reports, now, 24);
  assert.ok(output.includes('window: 24 h'));
  assert.ok(output.includes('entries: 2 (new 1, seen_before 1)'));
  const health = output.split('\n').find((line) => line.startsWith('Health:'));
  assert.ok(health);
  assert.ok(health.includes('4 feeds'));
  assert.ok(health.includes('failed: Beta \\(http\\_error\\)'));
  assert.ok(health.includes('empty: Gamma'));
  assert.ok(health.includes('quiet in window: 1'));
  assert.ok(output.includes('· seen_before'));
  assert.ok(output.includes('· new'));
});

test('renderNews skips empty groups', () => {
  const output = renderNews([], ['national', 'economy'], [], now, 24);
  assert.ok(!output.includes('## '));
});

test('entries inside a group are newest first', () => {
  const older = makeItem({ url: 'https://example.com/1', title: 'Aeltere lange Meldung vom Morgen', published: new Date('2026-10-26T01:00:00Z') });
  const newer = makeItem({ url: 'https://example.com/2', title: 'Neuere lange Meldung vom Mittag', published: new Date('2026-10-26T05:00:00Z') });
  const output = renderNews(entriesOf([older, newer]), ['national'], [], now, 24);
  assert.ok(output.indexOf('Neuere lange') < output.indexOf('Aeltere lange'));
});

test('renderNewsJson lists entries with sources and status', () => {
  const a = makeItem({ source: 'Spiegel', url: 'https://s.de/1', title: 'Gleiche lange Schlagzeile zum Test' });
  const b = makeItem({ source: 'SZ', url: 'https://sz.de/1', title: 'Gleiche lange Schlagzeile zum Test' });
  const reports = [makeReport('Spiegel', 'ok'), makeReport('Dead', 'http_error')];
  const data = JSON.parse(renderNewsJson(entriesOf([a, b], ['sz.de/1']), ['national'], reports, now, 24));

  assert.equal(data.generated_at, '2026-10-26T07:00:00.000Z');
  assert.equal(data.window_hours, 24);
  assert.deepEqual(data.counts, { entries: 1, new: 0, seen_before: 1 });
  assert.equal(data.entries.length, 1);
  const entry = data.entries[0];
  assert.equal(entry.group, 'national');
  assert.equal(entry.status, 'seen_before');
  assert.deepEqual(entry.sources.map((s: { name: string }) => s.name), ['Spiegel', 'SZ']);
  assert.equal(typeof entry.id, 'string');
  assert.deepEqual(data.health.failed, [{ name: 'Dead', status: 'http_error', detail: 'HTTP 404' }]);
});
