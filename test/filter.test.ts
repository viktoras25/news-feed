import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterFeedItems, findPrefixMatches, isInWindow, isNotAnArticle, windowHours } from '../src/filter.ts';
import type { Item, Keywords } from '../src/types.ts';

const keywords: Keywords = {
  excludeWords: ['Gewinnspiel'],
  excludeTitlePrefixes: ['Anzeige', 'heise-Angebot', 'heise+', 'Pressemitteilung', 'Montag:'],
  excludeUrlParts: ['/video/', 'presseportal.zdf.de'],
};

function makeItem(title: string, url?: string, snippet = ''): Item {
  return {
    topic: 'national',
    source: 'Test',
    priority: 1,
    title,
    url: url ?? `https://example.com/${encodeURIComponent(title)}`,
    published: new Date('2026-10-27T09:00:00Z'),
    snippet,
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

test('findPrefixMatches matches from the start of a word only', () => {
  assert.deepEqual(findPrefixMatches('Neue Gewinnspiele im Radio', ['Gewinnspiel']), ['Gewinnspiel']);
  assert.deepEqual(findPrefixMatches('Das Allgewinnspiel', ['Gewinnspiel']), []);
});

test('isNotAnArticle catches ad prefixes, video URLs, press portals and ad words', () => {
  assert.equal(isNotAnArticle('Anzeige: PS5-Controller im Angebot', '', 'https://heise.de/a', keywords), true);
  assert.equal(isNotAnArticle('heise-Angebot: iX-Workshop', '', 'https://heise.de/b', keywords), true);
  assert.equal(isNotAnArticle('heise+ | Test des Monats', '', 'https://heise.de/c', keywords), true);
  assert.equal(isNotAnArticle('Pressemitteilung: Neues Gesetz', '', 'https://x.de/d', keywords), true);
  assert.equal(isNotAnArticle('Montag: Audi mit neuem Werk, Google mit Werbung', '', 'https://heise.de/e', keywords), true);
  assert.equal(isNotAnArticle('Lula gewinnt', '', 'https://tagesschau.de/video/video-1.html', keywords), true);
  assert.equal(isNotAnArticle('Aktuelles', '', 'https://presseportal.zdf.de/pressemitteilungen/', keywords), true);
  assert.equal(isNotAnArticle('Radio-Aktion', 'Jetzt am Gewinnspiel teilnehmen', 'https://r.de/f', keywords), true);
  assert.equal(isNotAnArticle('Lula gewinnt die Wahl', 'Brasilien', 'https://tagesschau.de/ausland/lula.html', keywords), false);
});

test('filterFeedItems drops ads but applies no limit and no keyword rule', () => {
  const items: Item[] = [makeItem('Anzeige: Gewinnspiel')];
  for (let i = 0; i < 100; i++) {
    items.push(makeItem(`Meldung ${i} ohne jedes Stichwort`));
  }
  const result = filterFeedItems(items, keywords);
  assert.equal(result.length, 100);
});

test('sport, crime and celebrity items are kept: judging them is left to the reader', () => {
  const items = [makeItem('Bundesliga: Bayern gewinnt'), makeItem('Promi-Hochzeit in Köln'), makeItem('Festnahme nach Messerangriff')];
  assert.equal(filterFeedItems(items, keywords).length, 3);
});

test('urlMustContain keeps only matching URLs', () => {
  const items = [
    makeItem('Stau in Dresden', 'https://mdr.de/nachrichten/sachsen/dresden/stau.html'),
    makeItem('Brand in Halle', 'https://mdr.de/nachrichten/sachsen-anhalt/halle/brand.html'),
  ];
  const result = filterFeedItems(items, keywords, { urlMustContain: ['/nachrichten/sachsen/'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Stau in Dresden');
});
