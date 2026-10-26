import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeWindowHours,
  filterFeedItems,
  hasSharedTimestamp,
  isInWindow,
  isNotAnArticle,
  lacksUsableDates,
} from '../src/filter.ts';
import type { Item, Markers, RawEntry } from '../src/types.ts';

const markers: Markers = {
  titlePrefixes: ['Anzeige', 'heise-Angebot', 'Gewinnspiel', 'Sponsored', 'Montag:'],
  urlParts: ['/video/', 'presseportal.zdf.de'],
};

function makeItem(title: string, url?: string): Item {
  const finalUrl = url ?? `https://example.com/${encodeURIComponent(title)}`;
  return {
    group: 'national',
    source: 'Test',
    title,
    url: finalUrl,
    key: finalUrl,
    published: new Date('2026-10-27T09:00:00Z'),
    snippet: '',
  };
}

function makeEntry(date: string | null): RawEntry {
  return { title: 'T', link: 'https://example.com/x', date: date === null ? null : new Date(date), description: '' };
}

const now = new Date('2026-10-27T10:00:00Z');

test('window: first run without a last run is 24 hours', () => {
  assert.equal(computeWindowHours(now, null), 24);
});

test('window: since the last run, but at least 24 hours', () => {
  assert.equal(computeWindowHours(now, new Date('2026-10-27T00:00:00Z')), 24);
});

test('window: since the last run, rounded up to whole hours', () => {
  assert.equal(computeWindowHours(now, new Date('2026-10-26T03:30:00Z')), 31);
});

test('window: at most 72 hours', () => {
  assert.equal(computeWindowHours(now, new Date('2026-10-01T00:00:00Z')), 72);
});

test('window: WINDOW_HOURS overrides the rule, an invalid value does not', () => {
  assert.equal(computeWindowHours(now, new Date('2026-10-01T00:00:00Z'), 12), 12);
  assert.equal(computeWindowHours(now, new Date('2026-10-01T00:00:00Z'), 100), 100);
  assert.equal(computeWindowHours(now, new Date('2026-10-01T00:00:00Z'), Number.NaN), 72);
  assert.equal(computeWindowHours(now, null, 0), 24);
});

test('isInWindow handles the boundary and entries from the future', () => {
  assert.equal(isInWindow(new Date('2026-10-26T11:00:00Z'), now, 24), true);
  assert.equal(isInWindow(new Date('2026-10-26T09:00:00Z'), now, 24), false);
  assert.equal(isInWindow(new Date('2026-10-27T10:30:00Z'), now, 24), true);
  assert.equal(isInWindow(new Date('2026-10-27T14:00:00Z'), now, 24), false);
});

test('a feed with one shared timestamp has no usable dates', () => {
  const fake = [0, 1, 2, 3, 4, 5].map(() => makeEntry('2026-10-26T09:39:07Z'));
  assert.equal(hasSharedTimestamp(fake), true);
  assert.equal(lacksUsableDates(fake), true);
});

test('a feed with no dates at all has no usable dates', () => {
  assert.equal(lacksUsableDates([makeEntry(null), makeEntry(null)]), true);
});

test('normal feeds and tiny feeds with equal dates are fine', () => {
  const normal = [0, 1, 2, 3, 4, 5].map((i) => makeEntry(`2026-10-26T0${i}:00:00Z`));
  assert.equal(lacksUsableDates(normal), false);
  const tiny = [makeEntry('2026-10-26T09:00:00Z'), makeEntry('2026-10-26T09:00:00Z')];
  assert.equal(lacksUsableDates(tiny), false);
});

test('markers: ad and announcement prefixes, case-insensitive', () => {
  assert.equal(isNotAnArticle('Anzeige: PS5-Controller im Angebot', 'https://heise.de/a', markers), true);
  assert.equal(isNotAnArticle('heise-Angebot: iX-Workshop', 'https://heise.de/b', markers), true);
  assert.equal(isNotAnArticle('GEWINNSPIEL: Tickets gewinnen', 'https://x.de/c', markers), true);
  assert.equal(isNotAnArticle('Sponsored: Das beste Konto', 'https://x.de/d', markers), true);
  assert.equal(isNotAnArticle('Montag: Audi mit neuem Werk, Google mit Werbung', 'https://heise.de/e', markers), true);
});

test('markers: video pages and the ZDF press portal', () => {
  assert.equal(isNotAnArticle('Lula gewinnt', 'https://tagesschau.de/video/video-1.html', markers), true);
  assert.equal(isNotAnArticle('Aktuelles', 'https://presseportal.zdf.de/pressemitteilungen/', markers), true);
});

test('markers: a normal article passes, a marker in the middle of a title does not count', () => {
  assert.equal(isNotAnArticle('Lula gewinnt die Wahl', 'https://tagesschau.de/ausland/lula.html', markers), false);
  assert.equal(isNotAnArticle('Neue Anzeige gegen Minister', 'https://x.de/f', markers), false);
});

test('filterFeedItems drops ads but applies no limit and no keyword rule', () => {
  const items: Item[] = [makeItem('Anzeige: Gewinnspiel')];
  for (let i = 0; i < 100; i++) {
    items.push(makeItem(`Meldung ${i} ohne jedes Stichwort`));
  }
  assert.equal(filterFeedItems(items, markers).length, 100);
});

test('sport, crime and celebrity items are kept: judging them is left to the reader', () => {
  const items = [makeItem('Bundesliga: Bayern gewinnt'), makeItem('Promi-Hochzeit in Köln'), makeItem('Festnahme nach Messerangriff')];
  assert.equal(filterFeedItems(items, markers).length, 3);
});

test('urlMustContain keeps only matching URLs', () => {
  const items = [
    makeItem('Stau in Dresden', 'https://mdr.de/nachrichten/sachsen/dresden/stau.html'),
    makeItem('Brand in Halle', 'https://mdr.de/nachrichten/sachsen-anhalt/halle/brand.html'),
  ];
  const result = filterFeedItems(items, markers, { urlMustContain: ['/nachrichten/sachsen/'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Stau in Dresden');
});
