import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBerlin, renderNews, safeLinkTarget } from '../src/render.ts';
import type { Item } from '../src/types.ts';

test('formatBerlin converts UTC to Berlin (summer time)', () => {
  assert.equal(formatBerlin(new Date('2026-07-01T06:15:00Z')), '2026-07-01 08:15');
});

test('safeLinkTarget escapes parentheses and spaces', () => {
  assert.equal(safeLinkTarget('https://a.de/x (1)'), 'https://a.de/x%20%281%29');
});

test('renderNews does not let feed text create markup', () => {
  const item: Item = {
    topic: 'national',
    source: 'Evil',
    priority: 1,
    title: '# Fake heading [click](http://evil.example)',
    url: 'https://example.com/a',
    published: new Date('2026-10-26T06:00:00Z'),
    snippet: '- list item\n## more',
    searchText: '',
  };
  const output = renderNews([item], ['national'], new Date('2026-10-26T07:00:00Z'), 72);
  const entryLine = output.split('\n').find((line) => line.startsWith('- **Evil**'));
  assert.ok(entryLine);
  assert.ok(!entryLine.includes('[click]('));
  assert.ok(entryLine.includes('\\[click\\]'));
  // No heading markup appeared on any line except our own.
  const headings = output.split('\n').filter((line) => line.startsWith('#'));
  assert.deepEqual(headings, ['# News for 2026-10-26', '## Germany: politics and general news']);
});

test('renderNews skips empty topics and prints the window', () => {
  const output = renderNews([], ['national', 'economy'], new Date('2026-10-26T07:00:00Z'), 24);
  assert.ok(output.includes('window: 24 h'));
  assert.ok(!output.includes('## '));
});
