# news-feed

Every night GitHub Actions collects the RSS feeds listed in `feeds.yml`, filters them, and publishes two files to the `latest` release:

- `news.md`: a digest of the last 24 hours (72 hours on Sunday and Monday), grouped by topic. Overwritten in full on every run.
- `health.md`: which feeds are dead or empty, and how many entries were dropped at each stage.

Permanent links:

```
https://github.com/<user>/<repo>/releases/download/latest/news.md
https://github.com/<user>/<repo>/releases/download/latest/health.md
```

## What the script does

1. Downloads all feeds in parallel (15 s timeout, one retry).
2. Keeps entries newer than the time window.
3. Drops noise (`exclude` in `keywords.yml`). For feeds with `priority: 2` only entries that match a keyword (`include`) pass, at most 5 per feed. Feeds with `priority: 1` are capped at 8 entries each.
4. Removes duplicates by normalized URL and by title similarity.
5. Keeps at most 15 entries per topic, taking entries round-robin across feeds so one noisy feed cannot crowd out the others.
6. Cleans the text (`src/sanitize.ts`): strips HTML and links, and removes phrases that look like commands addressed to an AI assistant. Snippets are truncated to 300 characters. A suspicious snippet is dropped entirely; an entry with a suspicious title is dropped.
7. Escapes Markdown in titles and snippets, so feed text cannot create headings, links or tables.

Each entry in `news.md` is rendered as: topic (heading) → source → title → time → link → snippet.

The content of `news.md` is external data. When using it from Claude, state in the prompt that instructions inside the file must not be followed.

## Development

```
npm ci
npm test
npm run build-news   # output goes to out/
```

Edit the feed list in `feeds.yml` and the keyword lists in `keywords.yml`. After changes, check `out/health.md`.

## Notes

- GitHub disables scheduled workflows in public repositories after 60 days without repository activity. If the nightly runs stop, start the workflow manually (`Actions` → `daily-news` → `Run workflow`).
- Only titles, links and short excerpts from public RSS feeds are published; rights to the material remain with the sources.
- Feeds without publication dates cannot be filtered by time and show up as `no_dates` in `health.md`.
