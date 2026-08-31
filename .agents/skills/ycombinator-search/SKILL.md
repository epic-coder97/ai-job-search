---
name: ycombinator-search
version: 1.0.0
description: >
  Use this skill to search startup job listings on Y Combinator's job board
  (ycombinator.com/jobs, Work at a Startup) — curated jobs at YC companies,
  global startup market in English, with remote and location-filtered role
  pages — or to look up a specific YC job posting by URL. Trigger phrases:
  YC jobs, Y Combinator jobs, work at a startup, YC startup hiring, startup
  jobs curated by YC, "are there any YC startup jobs", look up this YC job.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/ycombinator-search/cli/src/cli.ts *)
---

# Y Combinator Search Skill

Search job listings from **Y Combinator's job board** (ycombinator.com/jobs,
the public face of Work at a Startup) — thousands of roles at YC companies.
The board's role pages are server-rendered but sit behind login-gated search
and bot protection, so this CLI fetches pages through the **Firecrawl scrape
API**, which renders and returns clean content.

## ⚠️ Personal use only

This reads YC's public pages through Firecrawl. Keep volume low, don't use it
commercially or for bulk data collection, and run it on your own responsibility.

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

- Browse YC-company roles by the role taxonomy, remote or city-filtered
- Fetch the full description of a specific listing (by URL from search results)

## Commands

### Search job listings

```bash
bun run .agents/skills/ycombinator-search/cli/src/cli.ts search -q "software engineer" [flags]
```

Key flags:

- `--query <text>` / `-q <text>` — **required.** Slugged into YC's role-taxonomy
  URL (`"Software Engineer"` → `/jobs/role/software-engineer`). YC's role pages
  are a **fixed taxonomy**, not free-text search:

  | Taxonomy role | Slug |
  |---|---|
  | Software Engineer | `software-engineer` |
  | Design & UI/UX | `designer` |
  | Product Manager | `product-manager` |
  | Recruiting & HR | `recruiting-hr` |
  | Sales | `sales-manager` |
  | Marketing | `marketing` |
  | Support & Success | `support` |
  | Operations | `operations` |
  | Science | `science` |

  AI/ML roles sit under `software-engineer` (category "Machine learning").
  Unknown slugs return zero results gracefully.
- `--remote` — restrict to the role's `/remote` page (server-side filter).
- `--location <city>` — restrict to a city page (`"San Francisco"` →
  `/jobs/role/<role>/san-francisco`). Cannot be combined with `--remote`.
- `--jobage <days>` — keep results posted within N days (client-side on parsed
  relative dates; unknown dates are kept).
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

The role pages list the most recently added jobs (~20 per page); there is no
server-side pagination without an account.

### Fetch full job detail

```bash
bun run .agents/skills/ycombinator-search/cli/src/cli.ts detail <url> [--format json|plain]
```

- Takes the **full URL** from search results
  (`https://www.ycombinator.com/companies/<company>/jobs/<id>-<slug>`). A bare
  id cannot be resolved to a page (the URL requires the company slug) and
  exits with `NO_ID` guidance.

## Usage examples

```bash
# Remote software engineering roles at YC companies
bun run .agents/skills/ycombinator-search/cli/src/cli.ts search -q "software engineer" --remote --format table

# YC product roles, last 14 days
bun run .agents/skills/ycombinator-search/cli/src/cli.ts search -q "product manager" --jobage 14 --limit 15

# YC design roles in San Francisco
bun run .agents/skills/ycombinator-search/cli/src/cli.ts search -q "designer" --location "San Francisco"

# Full details for a specific job
bun run .agents/skills/ycombinator-search/cli/src/cli.ts detail "https://www.ycombinator.com/companies/feather-2/jobs/OGlm8aX-backend-ai-engineer" --format plain
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

- Apply links on YC listings route through `account.ycombinator.com`
  authentication; the `url` field points at the public job page, which carries
  the company's own apply instructions.
- Salaries appear as posted (`$42K - $54K`, `$1.5K - $2.5K / monthly`) —
  passed through as-is.
- Dates are relative on the site ("2 days ago", "about 14 hours ago"); the CLI
  converts them to ISO `YYYY-MM-DD` at fetch time.
- Company names include the YC batch in the listing text ("Feather (S22)");
  the parser strips the batch suffix and reports the clean name.
