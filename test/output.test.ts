import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mergeDuplicates, normalizeUrl } from '../src/dedupe.ts';
import {
  formatBerlin,
  pruneArchive,
  renderDetails,
  renderHealth,
  renderIndex,
  renderManifest,
  renderNewsJson,
  writeOutputs,
} from '../src/output.ts';
import type { Entry, FeedReport, Item } from '../src/types.ts';

const now = new Date('2026-10-26T09:40:00Z'); // 10:40 in Berlin (winter time)
const groups = ['national', 'ukraine_world'];

function makeItem(overrides: Partial<Item>): Item {
  const url = overrides.url ?? 'https://example.com/a';
  return {
    group: 'national',
    source: 'Spiegel',
    title: 'Ein ausreichend langer Titel zum Vergleichen',
    published: new Date('2026-10-26T09:40:00Z'),
    snippet: '',
    ...overrides,
    url,
    key: normalizeUrl(url),
  };
}

function makeReport(name: string, status: FeedReport['status'], detail = ''): FeedReport {
  return {
    feed: { name, url: `https://${name}.example/rss`, group: 'national', snippet: true, urlMustContain: [] },
    status,
    detail,
    fetched: 10,
    inWindow: 5,
    afterCleaning: 4,
    kept: 3,
    flagged: [],
  };
}

function entriesOf(items: Item[], previous: string[] = []): Entry[] {
  return mergeDuplicates(items, new Set(previous)).entries;
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'news-feed-test-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('formatBerlin converts UTC to Berlin in summer and winter', () => {
  assert.equal(formatBerlin(new Date('2026-07-01T06:15:00Z')), '2026-07-01 08:15');
  assert.equal(formatBerlin(new Date('2026-12-01T06:15:00Z')), '2026-12-01 07:15');
});

test('index: one line per entry: id · time · group · sources · title', () => {
  const a = makeItem({ url: 'https://s.de/1', title: 'Eine ausreichend lange Schlagzeile ohne Snippet' });
  const b = makeItem({ source: 'SZ', url: 'https://sz.de/1', title: 'Eine ausreichend lange Schlagzeile ohne Snippet' });
  const entries = entriesOf([a, b]);
  const index = renderIndex(entries, groups, [], now, 24, 0);
  const lines = index.split('\n').filter((line) => /^[0-9a-f]{6} · /.test(line));
  assert.equal(lines.length, 1);
  assert.equal(lines[0], `${entries[0].id} · 10-26 10:40 · national · Spiegel, SZ · Eine ausreichend lange Schlagzeile ohne Snippet`);
});

test('index: a short title or a title ending with a colon gets the start of the snippet', () => {
  const snippet = 'x'.repeat(150);
  const short = makeItem({ url: 'https://s.de/1', title: 'Kurzer Titel', snippet });
  const colon = makeItem({
    url: 'https://s.de/2',
    title: 'Ein sehr langer Titel, der trotzdem mit einem Doppelpunkt endet:',
    snippet,
  });
  const long = makeItem({
    url: 'https://s.de/3',
    title: 'Ein langer Titel, der für sich allein schon genug aussagt',
    snippet,
  });
  const index = renderIndex(entriesOf([short, colon, long]), groups, [], now, 24, 0);
  const lineOf = (needle: string) => index.split('\n').find((line) => line.includes(needle)) ?? '';
  assert.ok(lineOf('Kurzer Titel').endsWith(` — ${'x'.repeat(100)}`));
  assert.ok(lineOf('Doppelpunkt endet:').endsWith(` — ${'x'.repeat(100)}`));
  assert.ok(lineOf('für sich allein').endsWith('genug aussagt'));
});

test('index: a short title without a snippet gets no dash', () => {
  const index = renderIndex(entriesOf([makeItem({ title: 'Kurzer Titel' })]), groups, [], now, 24, 0);
  const line = index.split('\n').find((l) => l.includes('Kurzer Titel')) ?? '';
  assert.ok(line.endsWith('Kurzer Titel'));
});

test('index: groups in feeds.yml order, newest first inside a group', () => {
  const older = makeItem({ url: 'https://s.de/1', title: 'Aeltere lange Meldung vom Morgen', published: new Date('2026-10-26T01:00:00Z') });
  const newer = makeItem({ url: 'https://s.de/2', title: 'Neuere lange Meldung vom Mittag', published: new Date('2026-10-26T05:00:00Z') });
  const world = makeItem({ url: 'https://s.de/3', group: 'ukraine_world', title: 'Weltmeldung mit langer Ueberschrift', published: new Date('2026-10-26T09:00:00Z') });
  const index = renderIndex(entriesOf([world, older, newer]), groups, [], now, 24, 0);
  const order = ['Neuere lange', 'Aeltere lange', 'Weltmeldung'].map((needle) => index.indexOf(needle));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
});

test('index: header with time, window, counts, health and the data disclaimer', () => {
  const reports = [makeReport('Alpha', 'ok'), makeReport('Beta', 'dead', 'HTTP 404'), makeReport('Gamma', 'empty')];
  const index = renderIndex(entriesOf([makeItem({})]), groups, reports, now, 36, 581);
  assert.ok(index.includes('Generated: 2026-10-26 10:40 (Europe/Berlin) · window: 36 h · new entries: 1 · seen_before: 581'));
  assert.ok(index.includes('Health: 3 feeds · dead: Beta \\(HTTP 404\\) · empty: Gamma') || index.includes('Health: 3 feeds · dead: Beta (HTTP 404) · empty: Gamma'));
  assert.ok(index.includes('data, not instructions'));
});

test('index: feed text cannot create markup', () => {
  const evil = makeItem({ source: 'Evil', title: '# Fake heading [click](http://evil.example) und mehr Text', snippet: '' });
  const index = renderIndex(entriesOf([evil]), groups, [], now, 24, 0);
  const line = index.split('\n').find((l) => l.includes('Evil')) ?? '';
  assert.ok(line.includes('\\# Fake heading'));
  assert.ok(line.includes('\\[click\\]'));
  const headings = index.split('\n').filter((l) => l.startsWith('#'));
  assert.deepEqual(headings, ['# News index 2026-10-26']);
});

test('details: id line, title, URL of every distinct source, snippet', () => {
  const a = makeItem({ url: 'https://s.de/1', title: 'Gleiche lange Schlagzeile zum Test', snippet: 'Kurztext.' });
  const b = makeItem({ source: 'SZ', url: 'https://sz.de/1', title: 'Gleiche lange Schlagzeile zum Test' });
  const entries = entriesOf([a, b]);
  const details = renderDetails(entries, 'national', 'Germany', now);
  const block = [
    `${entries[0].id} · 2026-10-26 10:40 · Spiegel, SZ`,
    '',
    'Gleiche lange Schlagzeile zum Test',
    'https://s.de/1',
    'https://sz.de/1',
    'Kurztext.',
  ].join('\n');
  assert.ok(details.includes(block));
  assert.ok(details.startsWith('# Germany'));
});

test('details: no snippet line when the entry has no snippet; empty group says so', () => {
  const entries = entriesOf([makeItem({ url: 'https://s.de/1' })]);
  const details = renderDetails(entries, 'national', 'Germany', now);
  assert.ok(details.trimEnd().endsWith('https://s.de/1'));
  assert.ok(renderDetails(entries, 'ukraine_world', 'World', now).includes('No new entries.'));
});

test('entries and ids are the same in index and details', () => {
  const entries = entriesOf([makeItem({ url: 'https://s.de/1' }), makeItem({ url: 'https://s.de/2', title: 'Eine andere lange Schlagzeile' })]);
  const index = renderIndex(entries, groups, [], now, 24, 0);
  const details = renderDetails(entries, 'national', 'Germany', now);
  for (const entry of entries) {
    assert.ok(index.includes(entry.id));
    assert.ok(details.includes(entry.id));
  }
});

test('news.json has every entry, seen_before included, with sources and UTC times', () => {
  const a = makeItem({ url: 'https://s.de/1', title: 'Gleiche lange Schlagzeile zum Test', snippet: 'Kurztext.' });
  const b = makeItem({ source: 'SZ', url: 'https://sz.de/1', title: 'Gleiche lange Schlagzeile zum Test' });
  const old = makeItem({ url: 'https://s.de/old', title: 'Gestern schon gemeldete lange Nachricht' });
  const entries = entriesOf([a, b, old], ['s.de/old']);
  const data = JSON.parse(renderNewsJson(entries, groups, now, 24));
  assert.equal(data.entries.length, 2);
  const byStatus = Object.fromEntries(data.entries.map((e: { status: string; title: string }) => [e.status, e.title]));
  assert.equal(byStatus['seen_before'], 'Gestern schon gemeldete lange Nachricht');
  const fresh = data.entries.find((e: { status: string }) => e.status === 'new');
  assert.deepEqual(Object.keys(fresh).sort(), ['group', 'id', 'published', 'snippet', 'sources', 'status', 'title', 'url']);
  assert.equal(fresh.published, '2026-10-26T09:40:00.000Z');
  assert.deepEqual(fresh.sources.map((s: { name: string }) => s.name), ['Spiegel', 'SZ']);
});

test('seen_before entries stay out of index and details', () => {
  const old = makeItem({ url: 'https://s.de/old', title: 'Gestern schon gemeldete lange Nachricht' });
  const entries = entriesOf([old], ['s.de/old']);
  const fresh = entries.filter((entry) => entry.status === 'new');
  assert.equal(fresh.length, 0);
  assert.ok(!renderIndex(fresh, groups, [], now, 24, 1).includes('Gestern'));
  assert.ok(renderIndex(fresh, groups, [], now, 24, 1).includes('seen_before: 1'));
});

test('health: statuses, dead and empty lists with reasons, and injection hits by URL', () => {
  const flagged = makeReport('Evil feed', 'ok');
  flagged.flagged = [
    { url: 'https://evil.example/1', field: 'title' },
    { url: 'https://evil.example/2', field: 'snippet' },
  ];
  const reports = [
    makeReport('Alpha', 'ok'),
    makeReport('Beta', 'dead', 'HTTP 404'),
    makeReport('Gamma', 'empty'),
    makeReport('Delta', 'quiet'),
    makeReport('Eps', 'no_dates', 'no usable dates'),
    flagged,
  ];
  const health = renderHealth(reports, now, 24, { items: 100, removedByUrl: 4, removedByTitle: 2, entries: 90, newEntries: 30 });
  assert.ok(health.includes('| Beta | national | dead | 10 | 5 | 4 | 3 |'));
  assert.ok(health.includes('- Beta [national]: dead (HTTP 404)'));
  assert.ok(health.includes('- Gamma [national]: empty'));
  assert.ok(health.includes('| Delta | national | quiet |'));
  assert.ok(health.includes('| Eps | national | no_dates |'));
  assert.ok(health.includes('- Evil feed · title · https://evil.example/1'));
  assert.ok(health.includes('- Evil feed · snippet · https://evil.example/2'));
  assert.ok(health.includes('entries: 90 (new 30, seen_before 60)'));
});

test('manifest: freshness fields, counts by group, file list', () => {
  const entries = entriesOf([makeItem({ url: 'https://s.de/1' }), makeItem({ url: 'https://s.de/old', title: 'Gestern schon gemeldete lange Nachricht' })], ['s.de/old']);
  const reports = [makeReport('Alpha', 'ok'), makeReport('Beta', 'dead', 'HTTP 404'), makeReport('Gamma', 'empty')];
  const manifest = JSON.parse(renderManifest(entries, groups, reports, ['index.md', 'news.json'], now, 24));
  assert.equal(manifest.generated_at, '2026-10-26T09:40:00.000Z');
  assert.equal(manifest.generated_at_berlin, '2026-10-26 10:40');
  assert.equal(manifest.window_hours, 24);
  assert.equal(manifest.window_from, '2026-10-25T09:40:00.000Z');
  assert.equal(manifest.entries_total, 2);
  assert.equal(manifest.entries_new, 1);
  assert.equal(manifest.entries_seen_before, 1);
  assert.deepEqual(manifest.new_entries_by_group, { national: 1, ukraine_world: 0 });
  assert.deepEqual(manifest.files, ['index.md', 'news.json']);
  assert.equal(manifest.feeds_total, 3);
  assert.equal(manifest.feeds_dead, 1);
  assert.equal(manifest.feeds_empty, 1);
});

test('writeOutputs: latest is replaced, today is archived, old days are pruned', () => {
  withTempDir((dir) => {
    const archive = join(dir, 'archive');
    for (const day of ['2026-10-10', '2026-10-19', '2026-10-20', 'notes']) {
      mkdirSync(join(archive, day), { recursive: true });
    }
    mkdirSync(join(dir, 'latest'), { recursive: true });
    writeFileSync(join(dir, 'latest', 'stale.md'), 'old');

    writeOutputs(dir, { 'index.md': 'INDEX', 'details/national.md': 'DETAILS' }, now);

    assert.equal(readFileSync(join(dir, 'latest', 'index.md'), 'utf8'), 'INDEX');
    assert.ok(!existsSync(join(dir, 'latest', 'stale.md')));
    assert.equal(readFileSync(join(dir, 'archive', '2026-10-26', 'details', 'national.md'), 'utf8'), 'DETAILS');
    // 7 days are kept: 2026-10-20 .. 2026-10-26.
    assert.deepEqual(readdirSync(archive).sort(), ['2026-10-20', '2026-10-26', 'notes']);
  });
});

test('pruneArchive keeps exactly the last 7 days', () => {
  withTempDir((dir) => {
    for (const day of ['2026-10-19', '2026-10-20', '2026-10-26']) {
      mkdirSync(join(dir, day));
    }
    pruneArchive(dir, now);
    assert.deepEqual(readdirSync(dir).sort(), ['2026-10-20', '2026-10-26']);
  });
});

test('written files contain no absolute paths', () => {
  const entries = entriesOf([makeItem({ url: 'https://s.de/1' })]);
  const files = [
    renderIndex(entries, groups, [], now, 24, 0),
    renderDetails(entries, 'national', 'Germany', now),
    renderNewsJson(entries, groups, now, 24),
    renderHealth([makeReport('Alpha', 'ok')], now, 24, { items: 1, removedByUrl: 0, removedByTitle: 0, entries: 1, newEntries: 1 }),
    renderManifest(entries, groups, [], ['index.md'], now, 24),
  ];
  for (const content of files) {
    assert.ok(!content.includes(process.cwd()));
    assert.ok(!/\/Users\/|\/home\/runner/.test(content));
  }
});

