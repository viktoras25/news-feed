import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterFeedItems,
  hasSharedTimestamp,
  isAnnouncement,
  isInWindow,
  matchesExclude,
  matchesInclude,
  windowHours,
} from '../src/filter.ts';
import type { Item, Keywords, RawEntry } from '../src/types.ts';

const keywords: Keywords = {
  include: ['Steuer', 'Rente', 'KI', 'EZB', 'Leipzig'],
  wordBoundary: ['KI', 'EZB'],
  exclude: ['Bundesliga', 'Promi', 'Gala', 'Regionalliga'],
  excludeTitlePrefixes: ['Anzeige', 'heise-Angebot', 'heise+', 'Pressemitteilung'],
  excludeUrlParts: ['/video/', 'presseportal.zdf.de', '/sport/'],
  tags: {},
};

function makeItem(title: string, minutesAgo: number, priority: 1 | 2, url?: string): Item {
  const now = new Date('2026-10-27T10:00:00Z').getTime();
  return {
    topic: 'national',
    source: 'Test',
    priority,
    title,
    url: url ?? `https://example.com/${encodeURIComponent(title)}`,
    published: new Date(now - minutesAgo * 60_000),
    snippet: '',
    searchText: '',
    feedRank: 0,
  };
}

function makeEntry(isoDate: string | null): RawEntry {
  return { title: 'T', link: 'https://example.com/x', date: isoDate === null ? null : new Date(isoDate), description: '' };
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

test('hasSharedTimestamp detects feeds that stamp every entry with the build time', () => {
  const fake = [0, 1, 2, 3, 4, 5].map(() => makeEntry('2026-10-26T09:39:07Z'));
  assert.equal(hasSharedTimestamp(fake), true);
});

test('hasSharedTimestamp accepts normal feeds and tiny feeds', () => {
  const normal = [0, 1, 2, 3, 4, 5].map((i) => makeEntry(`2026-10-26T0${i}:00:00Z`));
  assert.equal(hasSharedTimestamp(normal), false);
  const tiny = [makeEntry('2026-10-26T09:00:00Z'), makeEntry('2026-10-26T09:00:00Z')];
  assert.equal(hasSharedTimestamp(tiny), false);
  assert.equal(hasSharedTimestamp([makeEntry(null), makeEntry(null)]), false);
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

test('isAnnouncement catches ad prefixes, video URLs and press portals', () => {
  assert.equal(isAnnouncement('Anzeige: PS5-Controller im Angebot', 'https://heise.de/a', keywords), true);
  assert.equal(isAnnouncement('heise-Angebot: iX-Workshop', 'https://heise.de/b', keywords), true);
  assert.equal(isAnnouncement('heise+ | Test des Monats', 'https://heise.de/c', keywords), true);
  assert.equal(isAnnouncement('Pressemitteilung: Neues Gesetz', 'https://x.de/d', keywords), true);
  assert.equal(isAnnouncement('Lula gewinnt', 'https://tagesschau.de/video/video-1.html', keywords), true);
  assert.equal(isAnnouncement('Aktuelles', 'https://presseportal.zdf.de/pressemitteilungen/', keywords), true);
  assert.equal(isAnnouncement('Lula gewinnt die Wahl', 'https://tagesschau.de/ausland/lula.html', keywords), false);
});

test('filterFeedItems drops announcements', () => {
  const items = [
    makeItem('Anzeige: Gewinnspiel', 10, 1),
    makeItem('Regierung beschließt Haushalt', 20, 1),
  ];
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Regierung beschließt Haushalt');
});

test('priority 2 passes only with keywords', () => {
  const items = [makeItem('Rente steigt', 30, 2), makeItem('Wetter morgen', 20, 2)];
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Rente steigt');
});

test('priority 1 passes without keywords, but noise is dropped', () => {
  const items = [makeItem('Wetter morgen', 30, 1), makeItem('Regionalliga Ergebnisse', 20, 1)];
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Wetter morgen');
});

test('requireKeywords makes a priority 1 feed keyword-only', () => {
  const items = [makeItem('Neues iPhone vorgestellt', 30, 1), makeItem('KI ersetzt Jobs', 20, 1)];
  const result = filterFeedItems(items, keywords, { requireKeywords: true, urlMustContain: [] });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'KI ersetzt Jobs');
});

test('urlMustContain keeps only matching URLs', () => {
  const items = [
    makeItem('Stau in Dresden', 10, 1, 'https://mdr.de/nachrichten/sachsen/dresden/stau.html'),
    makeItem('Brand in Halle', 20, 1, 'https://mdr.de/nachrichten/sachsen-anhalt/halle/brand.html'),
  ];
  const result = filterFeedItems(items, keywords, { requireKeywords: false, urlMustContain: ['/nachrichten/sachsen/'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Stau in Dresden');
});

test('priority 1: at most 8 entries per feed', () => {
  const items: Item[] = [];
  for (let i = 0; i < 12; i++) {
    items.push(makeItem(`Meldung ${i}`, i * 10, 1));
  }
  assert.equal(filterFeedItems(items, keywords).length, 8);
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

test('feedRank is the position in the feed, newest first', () => {
  const items = [makeItem('Alt', 300, 1), makeItem('Neu', 10, 1), makeItem('Mitte', 100, 1)];
  const result = filterFeedItems(items, keywords);
  assert.deepEqual(
    result.map((item) => [item.title, item.feedRank]),
    [['Neu', 0], ['Mitte', 1], ['Alt', 2]],
  );
});
