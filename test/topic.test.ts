import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadMarkers } from '../src/fetch-feeds.ts';
import { topicVerdict } from '../src/filter.ts';
import type { Markers } from '../src/types.ts';

const markers: Markers = {
  titlePrefixes: [],
  urlParts: [],
  keepWords: ['Rente', 'Steuer'],
  topicRules: [
    {
      name: 'soft',
      feeds: ['FAZ', 'taz'],
      dropUrlParts: ['faz.net/aktuell/sport/'],
      dropTitlePrefixes: ['Die Wahrheit:'],
      dropTitleWords: ['Sport', 'Bundesliga'],
      keepOnlyMentioning: [],
    },
    {
      name: 'region',
      feeds: ['Sachsen'],
      dropUrlParts: [],
      dropTitlePrefixes: [],
      dropTitleWords: [],
      keepOnlyMentioning: ['Leipzig', 'Landtag'],
    },
  ],
};

const drop = (feed: string, title: string, url = 'https://x.de/a', text = '') =>
  topicVerdict(feed, title, url, text, markers).dropRule;

test('topic: a URL section, a title prefix and a title word drop the entry', () => {
  assert.equal(drop('FAZ', 'Bayern gewinnt', 'https://www.faz.net/aktuell/sport/fussball/x.html'), 'soft');
  assert.equal(drop('taz', 'Die Wahrheit: Glückliche Geldschneider'), 'soft');
  assert.equal(drop('taz', 'Das Detail zum Bundesligaspieltag: In der Doppelrolle'), 'soft');
});

test('topic: title words match at a word start only', () => {
  assert.equal(drop('taz', 'Sportförderung wird gekürzt'), 'soft');
  assert.equal(drop('taz', 'Transport auf der Schiene wird teurer'), null);
});

test('topic: rules apply only to the feeds they name', () => {
  assert.equal(drop('Tagesschau', 'Bayern gewinnt', 'https://www.faz.net/aktuell/sport/x.html'), null);
  assert.equal(drop('Spiegel', 'Görlitz: Neue Brücke'), null);
});

test('topic: keepWords in the title or the snippet overrule a drop rule and are reported', () => {
  const url = 'https://www.faz.net/aktuell/sport/x.html';
  const byTitle = topicVerdict('FAZ', 'Profisportler und die Rente', url, '', markers);
  assert.deepEqual(byTitle, { dropRule: null, keptByKeepWords: 'soft' });
  const bySnippet = topicVerdict('FAZ', 'Vereine im Wandel', url, 'Was die neue Steuerregel bedeutet', markers);
  assert.equal(bySnippet.dropRule, null);
});

test('topic: a scope keeps only entries that mention one of its words, keepWords do not save the rest', () => {
  assert.equal(drop('Sachsen', 'Leipziger Messe meldet Rekord'), null);
  assert.equal(drop('Sachsen', 'Haushalt', 'https://x.de/a', 'Der Landtag berät heute'), null);
  assert.equal(drop('Sachsen', 'Görlitz: Brand in der Altstadt'), 'region');
  assert.equal(drop('Sachsen', 'Bautzen: Rente für Bergleute'), 'region');
});

// The real markers.yml must never cut the topics the reader cares about, whatever the section.
test('markers.yml: soft sections keep Altersvorsorge, Rente, Steuer, Freiberufler, Mieten, Entlassungen', () => {
  const real = loadMarkers('markers.yml');
  const soft = real.topicRules.find((rule) => rule.name === 'soft sections');
  assert.ok(soft, 'markers.yml has a "soft sections" rule');
  const titles = [
    'Altersvorsorge: Was das neue Depot bringt',
    'Rentenpaket: Was sich für Rentner ändert',
    'Einkommensteuer: Die Fristen 2027',
    'Freiberufler und die Scheinselbstständigkeit',
    'Mieten in Großstädten steigen weiter',
    'Entlassungen bei Autozulieferern',
  ];
  for (const feed of soft.feeds) {
    for (const url of soft.dropUrlParts) {
      for (const title of titles) {
        const verdict = topicVerdict(feed, title, `https://www.${url}story.html`, '', real);
        assert.equal(verdict.dropRule, null, `${feed} · ${url} · ${title}`);
      }
    }
  }
  // A Bundesliga story without those words is still dropped.
  assert.equal(topicVerdict('taz', 'DFB-Pokal der Männer: Crazy und labil', 'https://taz.de/x', '', real).dropRule, 'soft sections');
});

test('markers.yml: the Saxony scope keeps Leipzig and state politics, drops other districts', () => {
  const real = loadMarkers('markers.yml');
  const keep = (title: string) => topicVerdict('Sächsische Sachsen', title, 'https://saechsische.de/x', '', real).dropRule;
  assert.equal(keep('Leipzig: Neuer Hauptbahnhof-Plan'), null);
  assert.equal(keep('Kretschmer verteidigt Sparkurs im Landtag'), null);
  assert.notEqual(keep('Görlitz: Brücke nach Zgorzelec gesperrt'), null);
  assert.notEqual(keep('Oberlausitz: Neue Buslinie in Bautzen'), null);
});
