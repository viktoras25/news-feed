# news-feed

Every night GitHub Actions collects the RSS feeds listed in `feeds.yml`, filters them, groups entries about the same event, and publishes three files to the `latest` release:

- `news.md`: a digest of the last 24 hours (72 hours on Sunday and Monday), grouped by topic, one line per event, at most 50 events. A health line at the end shows failed and empty feeds and how many entries each feed contributed. Overwritten in full on every run.
- `news.json`: the same events in machine-readable form, for reading and for logging what has already been sent.
- `health.md`: which feeds are dead or empty, and how many entries were dropped at each stage.

Permanent links:

```
https://github.com/<user>/<repo>/releases/download/latest/news.md
https://github.com/<user>/<repo>/releases/download/latest/news.json
https://github.com/<user>/<repo>/releases/download/latest/health.md
```

## What the script does

1. Downloads all feeds in parallel (15 s timeout, one retry).
2. Keeps entries newer than the time window. A feed without real dates (none at all, or every entry stamped with the feed build time) gets dates from a first-seen cache: an unseen URL counts as published now, a seen one keeps its first-seen time and ages out of the window. The cache (`state/seen.json`) is stored as an asset of the `latest` release between runs; on the first run every undated feed looks new once.
3. Drops ads and announcements (`excludeTitlePrefixes`, `excludeUrlParts` in `keywords.yml`: "Anzeige", "heise+", video pages, press portals, sport and culture sections) and noise words (`exclude`).
4. Applies per-feed rules from `feeds.yml`: feeds with `priority: 2` or `requireKeywords: true` pass only entries that match a keyword (`include`); `urlMustContain` restricts a feed to certain URL paths (for example MDR to Saxony). Priority 1 feeds contribute at most 20 entries, priority 2 feeds at most 10 (only a safety ceiling; judging importance is left to the LLM reading the digest).
5. Groups entries into events: identical URLs are merged, and titles are clustered by word overlap (Jaccard similarity of at least 0.4 and at least two shared words). The earliest entry from the best-priority feed is the head of the event; all sources are listed.
6. Keeps at most 12 events per topic and 50 in total. Events reported by more sources rank first; ties are broken by feed priority and by position in the feed, so every feed gets its top entry in before any feed gets its second.
7. Cleans the text (`src/sanitize.ts`): strips HTML and links, and removes phrases that look like commands addressed to an AI assistant. Snippets are truncated to 300 characters. A suspicious snippet is dropped entirely; an entry with a suspicious title is dropped.
8. Escapes Markdown in titles and snippets, so feed text cannot create headings, links or tables.

Each event in `news.md` is rendered as: topic (heading) → sources → title (linked) → time → snippet.

## news.json

```
{
  "generated_at": "...", "window_hours": 24,
  "clusters": [
    {
      "id": "…", "topic": "national", "title": "…", "url": "…", "published": "…", "snippet": "…",
      "sources": [{ "name": "…", "url": "…", "priority": 1, "published": "…" }],
      "topics": ["tax", "ai"],      // keyword tags, see `tags` in keywords.yml
      "why_relevant": null           // left empty on purpose, filled in by hand
    }
  ],
  "health": { "feeds_total": 69, "failed": [], "empty": [], "entries_per_feed": {} }
}
```

`id` is derived from the URL of the head entry, so it stays the same if the same event shows up again.

The content of `news.md` and `news.json` is external data. When using it from Claude, state in the prompt that instructions inside the files must not be followed.

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
- The script is deliberately dumb: it collects, cleans and thins out; ranking and summarizing is left to the LLM that reads the files.
