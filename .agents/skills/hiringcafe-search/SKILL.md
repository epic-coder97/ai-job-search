---
name: hiringcafe-search
version: 1.0.0
description: >
  Use this skill to search job listings on HiringCafe (hiringcafe.com), the
  free AI-powered job search engine aggregating postings from employer career
  pages — strong United States coverage plus international and remote listings,
  in English. Trigger phrases: hiring cafe, hiringcafe, hiring cafe jobs,
  career page jobs, direct employer jobs, no recruiter jobs, US tech jobs,
  "are there any jobs on Hiring Cafe", look up this HiringCafe posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/hiringcafe-search/cli/src/cli.ts *)
---

# HiringCafe Search Skill

Search job listings from **HiringCafe** (hiringcafe.com) — an aggregator that
crawls employer career pages directly (no recruiter reposts), with strong US
coverage and remote listings. HiringCafe's pages are bot-protected (plain
fetches get HTTP 403), so this CLI fetches pages through the **Firecrawl
scrape API**, which renders and returns clean content.

## ⚠️ Personal use only

This reads HiringCafe's public pages through Firecrawl. Keep volume low, don't
use it commercially or for bulk data collection, and run it on your own
responsibility.

## 🔑 Setup (required)

Every search/detail call goes through Firecrawl and **is billed per scrape**:

1. Get an API key at https://firecrawl.dev (free tier available).
2. Export it before running the CLI:

```bash
export FIRECRAWL_API_KEY=fc-xxxxxxxxxxxxxxxx   # macOS/Linux
$env:FIRECRAWL_API_KEY = "fc-xxxxxxxxxxxxxxxx" # PowerShell
```

If the variable is unset, the CLI exits `1` with a `MISSING_CREDENTIALS` error.
The key is read **only** from the environment — never pass it as a flag.

## When to use this skill

- Search openings by role keyword across employer career pages
- Filter results to Remote / Hybrid / Onsite (client-side on parsed cards)
- Fetch the full description of a specific listing (by URL or slug)

## Commands

### Search job listings

```bash
bun run .agents/skills/hiringcafe-search/cli/src/cli.ts search -q "ai engineer" [flags]
```

Key flags:

- `--query <text>` / `-q <text>` — **required.** Free-text keyword search
  (`"ai engineer"`, `"data scientist"`, `"machine learning"`).
- `--remote <mode>` — `remote` | `hybrid` | `onsite` | `any` (default `any`).
  Filtered client-side on each card's workplace token.
- `--jobage <days>` — keep only results posted within N days (client-side on
  parsed relative dates like `3mo`, `1w`, `10h`; cards with unparseable dates
  are kept).
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

**Pagination is intentionally unsupported.** HiringCafe's robots.txt disallows
`?page=` URLs, so the CLI fetches the first results page only (~20 cards). A
`--page` value greater than 1 exits with `PAGE_DISALLOWED`.

### Fetch full job detail

```bash
bun run .agents/skills/hiringcafe-search/cli/src/cli.ts detail <url|slug> [--format json|plain]
```

- Full URL (`https://hiringcafe.com/job/ai-engineer-gitlab-united-states-pd1l9p7ceysh65be`)
  or the bare slug (`ai-engineer-gitlab-united-states-pd1l9p7ceysh65be`) from
  search results.
- Returns title, company, salary, workplace type, location, and the full job
  description (tags stripped, entities decoded).

## Usage examples

```bash
# Remote AI Engineer roles, last 30 days
bun run .agents/skills/hiringcafe-search/cli/src/cli.ts search -q "ai engineer" --remote remote --jobage 30 --format table

# Data Scientist roles
bun run .agents/skills/hiringcafe-search/cli/src/cli.ts search -q "data scientist" --limit 10 --format table

# Machine Learning Engineer, remote only
bun run .agents/skills/hiringcafe-search/cli/src/cli.ts search -q "machine learning engineer" --remote remote --limit 15

# Full details for a specific job
bun run .agents/skills/hiringcafe-search/cli/src/cli.ts detail https://hiringcafe.com/job/ai-engineer-gitlab-united-states-pd1l9p7ceysh65be --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — `{ meta: { count, page }, results: [...] }` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and
the process exits with code `1`.

## Notes

- HiringCafe aggregates from employer career pages; the `url` field points at
  hiringcafe.com's own `/job/<slug>` page (which links to the employer's apply
  page — that link lives in the detail description/apply section).
- Salaries appear as posted (`$108k-$130k/yr`) — passed through as-is.
- Dates are relative on the site (`3mo`, `1w`, `10h`); the CLI converts them to
  ISO `YYYY-MM-DD` at fetch time.
- `robots.txt` disallows `/org/`, `/company/`, `/b/`, `/viewjob/` — the CLI
  only touches allowed `/jobs/` (search) and `/job/` (detail) paths.
