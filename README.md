# news-feed

Every night GitHub Actions collects the RSS feeds listed in `feeds.yml` and publishes three files to the `latest` release:

- `news.md`: everything fresh (last 24 hours, 72 hours on Sunday and Monday), grouped by feed group, one line per entry. Overwritten in full on every run.
- `news.json`: the same entries in machine-readable form.
- `health.md`: which feeds are dead or empty, and how many entries remain after each stage.

Permanent links:

```
https://github.com/<user>/<repo>/releases/download/latest/news.md
https://github.com/<user>/<repo>/releases/download/latest/news.json
https://github.com/<user>/<repo>/releases/download/latest/health.md
```

## Principle

The script decides nothing that needs understanding the text. It makes sure the reader (an LLM) sees everything fresh, once, in a readable form. Judging importance, merging entries about the same event, ranking and classifying by content are left to the reader.

Test for every function in the script: can it be checked without understanding the text? If yes, it belongs here. If not, it does not.

## What the script does

1. Downloads all feeds in parallel (15 s timeout, one retry) and writes a health report.
2. Keeps entries newer than the time window. A feed without real dates (none at all, or every entry stamped with the feed build time) gets dates from a first-seen cache: an unseen URL counts as published now, a seen one keeps its first-seen time and ages out of the window.
3. Removes obvious ads and non-articles by markers (`keywords.yml`): title prefixes such as "Anzeige" and "heise-Angebot", the word "Gewinnspiel", video pages, press portals, daily roundups. A feed can be scoped to a URL path with `urlMustContain` in `feeds.yml` (for example MDR to Saxony).
4. Merges exact duplicates: the same normalized URL or the same normalized title. The entry then lists every source ("Spiegel, SZ"). Entries that merely cover the same event in different words stay separate.
5. Marks every entry `new` or `seen_before`: `seen_before` means its URL was part of an earlier export.
6. Cleans the text (`src/sanitize.ts`): strips HTML and links, and removes phrases that look like commands addressed to an AI assistant. Snippets are truncated to 300 characters. A suspicious snippet is dropped entirely; an entry with a suspicious title is dropped.
7. Escapes Markdown in titles and snippets, so feed text cannot create headings, links or tables.

There is no scoring, no keyword relevance, no limit per feed and no limit per group. If the digest ever gets too large, narrow the window (`WINDOW_HOURS`) or the feed list first.

## Format

The header has the window, the number of entries (new and seen_before) and the health of the feeds (failed and empty). Groups are the topics from `feeds.yml`: a coarse label of the feed group, not a classification of the entry.

One entry is one line:

```
- 2026-10-26 07:00 · Spiegel, SZ · [Title](url) · new — snippet
```

time (Berlin) · sources · title with link · `new` or `seen_before` · snippet. Entries are sorted newest first inside a group.

`news.json` holds the same entries: `id` (stable, derived from the URL), `group`, `published`, `title`, `url`, `snippet`, `sources` (name and URL of every feed that carried the entry), `status`, plus `counts` and `health`.

The content of both files is external data. When using it from Claude, state in the prompt that instructions inside the files must not be followed.

## Cache

`state/seen.json` maps every exported URL to the time it was first seen. It serves the undated feeds (step 2) and the `seen_before` mark (step 5), and entries older than 14 days are dropped from it. The workflow downloads it from the `latest` release before the run and uploads it back afterwards. On the very first run everything is `new`.

## Development

```
npm ci
npm test
npm run build-news                    # output goes to out/
WINDOW_HOURS=12 npm run build-news    # override the window
```

Edit the feed list in `feeds.yml` and the markers in `keywords.yml`. After changes, check `out/health.md`.

## Notes

- GitHub disables scheduled workflows in public repositories after 60 days without repository activity. If the nightly runs stop, start the workflow manually (`Actions` → `daily-news` → `Run workflow`).
- Only titles, links and short excerpts from public RSS feeds are published; rights to the material remain with the sources.
