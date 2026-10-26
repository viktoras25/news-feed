import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jaccard, normalizeUrl, sharedTokenCount, titleTokens } from '../src/dedupe.ts';

test('normalizeUrl removes www, utm, fragment and trailing slash', () => {
  assert.equal(
    normalizeUrl('https://www.Example.com/a/b/?utm_source=x&id=5#top'),
    'example.com/a/b?id=5',
  );
});

test('normalizeUrl treats http and https as the same address', () => {
  assert.equal(normalizeUrl('http://example.com/a'), normalizeUrl('https://example.com/a/'));
});

test('jaccard of similar titles is above the threshold', () => {
  const a = titleTokens('Bundestag beschließt neues Rentenpaket mit großer Mehrheit');
  const b = titleTokens('Bundestag beschließt neues Rentenpaket mit großer Mehrheit - Bericht');
  assert.ok(jaccard(a, b) >= 0.75);
});

test('jaccard of unrelated titles is low', () => {
  const a = titleTokens('Leipzig sperrt Brücke wegen Bauarbeiten');
  const b = titleTokens('Bundestag beschließt neues Rentenpaket');
  assert.equal(jaccard(a, b), 0);
});

test('sharedTokenCount counts common words', () => {
  const a = titleTokens('Lula gewinnt Stichwahl in Brasilien');
  const b = titleTokens('Brasilien: Lula gewinnt knapp');
  assert.equal(sharedTokenCount(a, b), 3);
});
