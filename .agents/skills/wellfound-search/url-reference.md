# Wellfound URL Reference

Parsing anchors for `wellfound-search`, recorded per `/add-portal` Step 2 so a
future maintainer can fix parsers when Wellfound changes its markup.

## Access situation (Step 2 findings, 2026-08-29)

- **robots.txt** (`https://wellfound.com/robots.txt`): disallows `/search`,
  `/_jobs/`, `/u/`, `/auth/`, onboarding/profile paths and several query-param
  patterns; **allows** `/role/`, `/jobs/`, `/company/` indexing and provides
  sitemaps. No login required to view listings.
- **Bot protection:** the site injects **Cloudflare Turnstile**. A script
  overrides `window.fetch` and, when a response carries
  `cf-mitigated: challenge` (sitekey `0x4AAAAAAAgpA-...`), shows a
  "One more step before you proceed..." overlay. Plain HTTP fetches (honest UA,
  headless) receive the challenge shell — not job content.
- **Consequence:** the CLI uses the **Firecrawl scrape API**
  (`https://api.firecrawl.dev/v1/scrape`), which renders the page and returns
  clean markdown (`statusCode: 200, proxyUsed: "basic"` verified live on both
  list and detail pages). Credential: `FIRECRAWL_API_KEY`, environment only,
  billed per scrape.

## Search endpoint

**Pattern:** `https://wellfound.com/role/r/<role-slug>[?remote=true][&page=<n>]`

- `<role-slug>`: lowercased, hyphenated role name — `ai-engineer`,
  `machine-learning-engineer`, `data-scientist`, `software-engineer`, …
- `?remote=true` filters to remote listings; `&page=N` paginates (~30 cards/page,
  server-rendered).
- Free-text search (`/jobs?q=...`) is client-rendered and NOT scrapeable without
  JS+Turnstile; the CLI therefore accepts role names only.

## Detail endpoint

**Pattern:** `https://wellfound.com/jobs/<id>-<slug>`

- `<id>` numeric (e.g. `4574038`), `<slug>` kebab title (`ai-engineer`).
- Bare-id form `https://wellfound.com/jobs/<id>` redirects to the canonical
  slug URL; prefer the full URL from search results.

## Markdown anchors (as returned by Firecrawl, verified 2026-08-29)

List page — per-card structure (companies may own several consecutive job links):

```
[**<Company>**](https://wellfound.com/company/<company-slug>)
... company blurb, badges ...
[<Job Title>](https://wellfound.com/jobs/<id>-<slug>) <Full-time|Part-time|Contract|Internship>
<salary line: "$150k – $200k" / "₹12L – ₹20L • No equity">
<location line: "Remote only • Everywhere" / "Onsite or remote • Bengaluru+4">
<relative date: "1 week ago" / "3 days ago">
```

Parser tokens (stateful walk, `parseSearchPage` in `helpers.ts`):

| Field | Anchor |
|-------|--------|
| Company | `[**Name**](https://wellfound.com/company/<slug>)` — carries over to following job links until the next company token |
| Job link | `[Title](https://wellfound.com/jobs/<id>-<slug>)` — the card boundary |
| Commitment | text immediately after the job link (`) Full-time`) |
| Salary | first line containing `$`/`₹`/`€`/`£` before the next card |
| Location | first line containing `•` before the next card (strip trailing `+N`) |
| Date | `N <unit> ago` / `Just posted` / `Today`, relative → ISO |

Detail page anchors:

| Field | Anchor |
|-------|--------|
| Title | first `# ` H1 line |
| Salary | first `$`/`₹`/`€`/`£` line in the header block |
| Remote policy | `Remote Work Policy` / `Hires remotely in` lines |
| Description | section under `## About the job` (fallback: after the first H1), ends at `## About the company` or `## Similar Jobs` |

## Known quirks

- Some cards carry `+N` location suffixes (hidden additional locations).
- Repeat postings share title+company but differ by `id` — dedupe on the URL/id.
- Sponsored cards can repeat a listing within one page; dedupe by id client-side.
- If Firecrawl is challenged (rare), the response is short HTML without job links
  → parser yields 0 results → CLI surfaces a `SCRAPE_CHALLENGED` error rather
  than silently returning empty.
