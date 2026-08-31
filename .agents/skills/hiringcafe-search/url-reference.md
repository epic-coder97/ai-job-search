# HiringCafe URL Reference

Parsing anchors for `hiringcafe-search`, recorded per `/add-portal` Step 2
(2026-08-29) so a future maintainer can fix parsers when HiringCafe changes.

## Access situation (Step 2 findings)

- **robots.txt** (`https://hiringcafe.com/robots.txt` — note the *com* domain;
  hiring.cafe redirects there): **allows** `/jobs`, `/jobs/`, `/job`, `/job/`,
  `/recently-posted-jobs`; **disallows** `/viewjob/`, `/org/`, `/company/`,
  `/b/`, `/req/`, `/board/`, and crucially **`?page=` / `&page=` patterns** —
  hence pagination is unsupported in the CLI.
- **Bot protection:** plain fetches (WebFetch, honest UA) receive **HTTP 403**
  on job pages. Verified: Firecrawl scrape API renders pages fine
  (`statusCode: 200, proxyUsed: "basic"` on both list and detail pages).
- **Credential:** `FIRECRAWL_API_KEY`, environment only, billed per scrape.

## Search endpoint

**Pattern:** `https://hiringcafe.com/jobs/<slugified-query>[?page=<n>]`

- `<slugified-query>`: free text, lowercased, hyphenated (`ai engineer` →
  `ai-engineer`). The landing page renders ~20 server-side cards.
- `?page=` is disallowed by robots.txt → CLI supports page 1 only.

## Detail endpoint

**Pattern:** `https://hiringcafe.com/job/<slug>`

- `<slug>`: long kebab slug with random suffix
  (`ai-engineer-gitlab-united-states-pd1l9p7ceysh65be`), taken from search
  results' `url` field.

## Markdown anchors (Firecrawl output, verified 2026-08-29)

Search card structure (repeated per card):

```
<date token: "3mo" / "1w" / "10h">
Save / Mark Applied / Hide chrome
<date token again>
<title: "AI Engineer">
<location: "United States" or "Camden, New Jersey, United States">
<salary/work line: "$108k-$130k/yrRemoteFull Time" or "HybridFull Time">
![favicon](https://s2.googleusercontent.com/s2/favicons?domain=...)
<company line: "GitLabNASDAQ: GTLB: ..." / "Tiny Health: Private U.S. ...">
<summary line>
<skills line: "Python, JavaScript/TypeScript, ...">
[Job Posting](https://hiringcafe.com/job/<slug>) [View all](https://hiringcafe.com/org/<domain>)
```

Parser (`parseSearchPage`, stateful walk on `[Job Posting](...)` tokens, each
job's chunk = the text before it since the previous job token):

| Field | Anchor |
|-------|--------|
| Job URL | `[Job Posting](https://hiringcafe.com/job/<slug>)` — card boundary |
| Company | line after the favicon link; strip trailing ticker/source at `NASDAQ:`/`NYSE:`/`BSE:`/`BATS:`, else take text before the first `:` (max ~60 chars) |
| Salary + workplace | the line combining `$.../yr` and a `Remote`/`Hybrid`/`Onsite` token (salary optional) |
| Title | first non-chrome line above location, walking backward over date tokens |
| Location | non-chrome line above the salary/work line |
| Date | `^\d+\s*(mo\|w\|d\|h\|hr)s?$` tokens → relative → ISO |

Chrome lines to skip: `Save`, `Mark Applied`, `Hide`, `See how many viewed or applied`.

Detail page anchors:

| Field | Anchor |
|-------|--------|
| Title | first `# ` H1 |
| Company | first line after the H1 that is a plain name |
| Salary/workplace | `$.../yr` line carrying `Remote`/`Hybrid`/`Onsite` + `Full Time` |
| Location | first non-empty line of the page (before the H1) |
| Description | `## Job description` … up to `## About <Company>` or `## Similar jobs` |

## Known quirks

- Card date tokens repeat (before and after chrome) — first parse wins.
- Some cards have no salary (line is just `HybridFull Time`) — salary null.
- Company lines concatenate ticker metadata (`GitLabNASDAQ: GTLB: ...`) —
  strip at the first ALL-CAPS ticker marker.
- The "Similar jobs" section on detail pages repeats `[Job Posting]` links —
  the detail parser never runs the card walker, so no contamination.
