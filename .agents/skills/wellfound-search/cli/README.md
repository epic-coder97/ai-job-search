# wellfound-cli

CLI for searching **startup** jobs on [Wellfound](https://wellfound.com) (formerly AngelList Talent) — global startup market, predominantly English postings.

**Data source**: Wellfound public role pages (`/role/r/<slug>`) and job pages (`/jobs/<id>-<slug>`), fetched via [Firecrawl](https://www.firecrawl.dev/) `v1/scrape` when a Firecrawl key is set, otherwise via plain fetch with an honest UA (usually challenged — see Setup).
**Authentication**: No Wellfound login. Firecrawl API key required for reliable access (Cloudflare Turnstile otherwise returns a challenge shell).
**Dependencies**: None (plain `bun` + `fetch` + regex). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** This reads Wellfound's public job pages; automated access may be against Wellfound's Terms of Service. Keep volume low, don't use it commercially or for bulk data collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/wellfound-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies. A Firecrawl key is still required for reliable results (see below).

## Setup — Firecrawl API key

Wellfound's pages are behind Cloudflare Turnstile; a plain fetch typically returns a challenge page, not job cards. The CLI fetches through Firecrawl's scrape API (see `../url-reference.md` for the request shape).

```bash
export FIRECRAWL_API_KEY="fc-..."        # preferred
# or
export FIRECRAWL_API_TOKEN="fc-..."      # alias, same value
```

- The key is read **only** from the environment — never as a `--flag`.
- If the variable is unset when a fetch is needed, the CLI exits `1` with `{"error":"FIRECRAWL_API_KEY not set...","code":"MISSING_CREDENTIALS"}` on stderr and does not fall through to a confusing unauthenticated failure.
- Every `search`/`detail` call via Firecrawl is **billed per query** by Firecrawl.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search startup job listings (role pages) |
| `detail` | Fetch full detail for a single Wellfound posting |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# AI Engineer roles, remote, first page (test query)
bun run src/cli.ts search -q "AI Engineer" --remote --limit 5 --format table

# Backend engineer, any location, last 14 days
bun run src/cli.ts search -q "backend engineer" --jobage 14 --format table

# Remote AI Engineer jobs, page 2
bun run src/cli.ts search -q "AI Engineer" --remote --page 2 --format table

# Full detail for one job
bun run src/cli.ts detail 4574038 --format plain
bun run src/cli.ts detail https://wellfound.com/jobs/4574038-ai-engineer --format plain
```

See `../SKILL.md` for the full flag reference and the Terms-of-Service note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (role/skill/title). Recommended; mapped to role slug `ai-engineer`. |
| `--remote` | | If present restricts to `?remote=true`. Omit for all locations. |
| `--jobage` | | Posted within N days: `1`, `7`, `14`, `30`. Client-side filter on relative date. |
| `--page` | | 1-indexed page. Default `1`. |
| `--limit` | `-n` | Cap results emitted (client-side). |
| `--format` | | `json` \| `table` \| `plain`. Default `json`. |

## Notes

- Global startup market; English postings. Wellfound has no location query param — filter by `--remote` and the `location` field client-side.
- `id` values are numeric Wellfound job IDs (from `/jobs/<id>-<slug>`).
- The CLI retries 429/5xx with exponential backoff + jitter (max ~6 retries); 404 returns empty rather than crashing.

