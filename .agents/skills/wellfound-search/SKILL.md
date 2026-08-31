---
name: wellfound-search
version: 1.0.0
description: >
  Use this skill to search startup job listings on Wellfound (wellfound.com,
  formerly AngelList Talent) — the global startup market in English, with strong
  remote coverage — or to look up a specific Wellfound posting by URL/id. Trigger
  phrases: wellfound, angel list talent, angel.co, startup jobs, startup hiring,
  find startup jobs, AI Engineer jobs, remote startup jobs, tech startup jobs,
  "are there any AI jobs on Wellfound", look up this Wellfound job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/wellfound-search/cli/src/cli.ts *)
---

# Wellfound Search Skill

Search live job listings from **Wellfound** (wellfound.com, formerly AngelList
Talent) — the global startup job board with strong remote coverage. Wellfound's
pages sit behind **Cloudflare Turnstile bot protection**, so plain HTTP fetches
receive a challenge page instead of job cards. This CLI therefore fetches pages
through the **Firecrawl scrape API**, which renders and returns clean content.

## ⚠️ Personal use only

This reads Wellfound's public job pages through Firecrawl. Automated access is
against Wellfound's Terms of Service, so **keep volume low and don't use it
commercially or for bulk data collection.** Run it on your own responsibility.

## 🔑 Setup (required)

Every search/detail call goes through Firecrawl and **is billed per scrape**:

1. Get an API key at https://firecrawl.dev (free tier available).
2. Export it before running the CLI:

```bash
export FIRECRAWL_API_KEY=fc-xxxxxxxxxxxxxxxx   # macOS/Linux
$env:FIRECRAWL_API_KEY = "fc-xxxxxxxxxxxxxxxx" # PowerShell
```

If the variable is unset, the CLI exits `1` with a `MISSING_CREDENTIALS` error
rather than making a request that fails confusingly. The key is read **only**
from the environment — never pass it as a flag (flags leak into shell history).

## When to use this skill

- Search startup job openings by role, remote or location-filtered
- Filter by posting age, paginate, cap results
- Fetch the full description of a specific listing (by `id` or URL)

## Commands

### Search job listings

```bash
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "ai engineer" [flags]
```

Key flags:

- `--query <text>` / `-q <text>` — **required.** Role to search. Slugged into
  Wellfound's role URL (`"AI Engineer"` → `/role/r/ai-engineer`). Use role names,
  not free text ("ai engineer" works; "python postgres" will 404 to zero results).
- `--remote <mode>` — `remote` adds the `?remote=true` filter; `any` (default)
  omits it. (Hybrid/onsite filters are not exposed by the role URL.)
- `--jobage <days>` — keep only results posted within N days (client-side on the
  parsed relative date; results with an unparseable date are kept).
- `--page <n>` — 1-indexed page via the role URL's `&page=` param (~30 cards/page).
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/wellfound-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

- Full URL (`https://wellfound.com/jobs/4574038-ai-engineer`) or a bare numeric id
  (`4574038`). A bare id resolves to `https://wellfound.com/jobs/<id>` — Wellfound
  redirects it to the canonical slug URL; if the fetch still misses, prefer the
  full URL from `search` output.
- Returns title, company, salary, location, remote policy, and the full
  description text (tags stripped, entities decoded).

## Usage examples

```bash
# Remote AI Engineer roles, last 14 days
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "ai engineer" --remote remote --jobage 14 --format table

# Machine Learning roles, page 2
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "machine learning engineer" --page 2 --limit 20

# Data Scientist roles, remote
bun run .agents/skills/wellfound-search/cli/src/cli.ts search -q "data scientist" --remote remote --limit 10 --format table

# Full details for a specific job
bun run .agents/skills/wellfound-search/cli/src/cli.ts detail https://wellfound.com/jobs/4574038-ai-engineer --format plain
bun run .agents/skills/wellfound-search/cli/src/cli.ts detail 4574038 --format json
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, `{ meta: { count, page }, results: [...] }` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the
process exits with code `1`.

## Notes

- **Search is role-slug based, not free-text.** Wellfound's server-rendered role
  pages (`/role/r/<slug>`) are the only reliably scrapeable search surface; the
  free-text `/jobs` search is client-rendered. Slugs: `ai-engineer`,
  `machine-learning-engineer`, `data-scientist`, `backend-engineer`, …
- Each search/detail call costs 1+ Firecrawl credit (per-query billing).
- Salaries appear as posted (`$150k – $200k`, `₹12L – ₹20L`) — passed through as-is.
- Dates are relative on the site ("1 week ago"); the CLI converts them to
  ISO `YYYY-MM-DD` at fetch time.
- Cloudflare may still challenge Firecrawl occasionally (4xx with challenge HTML);
  the CLI retries with backoff and reports a clear error if it persists.
