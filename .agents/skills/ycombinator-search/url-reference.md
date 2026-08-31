# Y Combinator URL Reference

Parsing anchors for `ycombinator-search`, recorded per `/add-portal` Step 2
(2026-08-29) so a future maintainer can fix parsers when YC changes its board.

## Access situation (Step 2 findings)

- The public board lives at `https://www.ycombinator.com/jobs` (Work at a
  Startup's public face). Free-text search and pagination require an account;
  the **role-taxonomy pages are server-rendered** and public:
  `/jobs/role/<role>`, `/jobs/role/<role>/remote`, `/jobs/role/<role>/<city>`,
  `/jobs/location/<city>`.
- `googlebot: noindex` / `robots: noindex` metadata on the jobs page; no
  robots.txt disallow was found for `/jobs/role/` paths. The page is a JS app
  (job cards render client-side from embedded data) — plain fetches return the
  shell, so the CLI fetches through the Firecrawl scrape API
  (verified: `statusCode 200`, full cards in markdown, `proxyUsed: basic`).
- **Credential:** `FIRECRAWL_API_KEY`, environment only, billed per scrape.

## Search endpoint

**Pattern:** `https://www.ycombinator.com/jobs/role/<role-slug>[/{remote|city-slug}]`

- Role taxonomy (fixed, 9 slugs): `software-engineer`, `designer`,
  `product-manager`, `recruiting-hr`, `sales-manager`, `marketing`, `support`,
  `operations`, `science`. Unknown slugs render an empty/404 page.
- `remote` suffix filters server-side; a city slug (`san-francisco`) does the
  same. Remote + city cannot be combined on the URL.
- Cards listed: most recently added (~20 per page), no server-side pagination.

## Detail endpoint

**Pattern:** `https://www.ycombinator.com/companies/<company-slug>/jobs/<jobid>-<jobslug>`

- `<jobid>`: 7-char base62 (`NAZgzHR`), part of the URL — there is no bare-id
  page form, so `detail` requires the full URL.

## Markdown anchors (Firecrawl output, verified 2026-08-29)

Card structure (repeated per card):

```
[<Company> (<BATCH>)•<tagline>(<relative date>)](https://www.ycombinator.com/companies/<company-slug>) [<Job Title>](https://www.ycombinator.com/companies/<company-slug>/jobs/<jobid>-<jobslug>)

<commitment: "Full-time">
•
<category: "Engineering">
•
<subcategory: "Full stack">
•
<salary: "$42K - $54K">
•
<location: "AR / Remote (AR)" or "London" or "New York, NY, US">

[Apply](https://account.ycombinator.com/authenticate?...signup_job_id=...)
```

Parser (`parseSearchPage`, stateful walk alternating company tokens and job
tokens):

| Field | Anchor |
|-------|--------|
| Job link | `[Title](https://www.ycombinator.com/companies/<company>/jobs/<id>-<slug>)` — card boundary |
| Company link | preceding `[Company (BATCH)•tagline(date)](/companies/<company>)` token |
| Company name | link text before " (" (batch suffix stripped) |
| Batch | inside the parens, e.g. `S22`, `W21` |
| Date | "(2 days ago)" / "(about 14 hours ago)" inside the company link text → relative → ISO |
| Commitment | first meta line matching `Full-time|Part-time|Contract|Internship` |
| Salary | first meta line starting with `$` |
| Location | **last** meta line before the `[Apply]` link (location always closes the card) |

Meta block = lines between the job link and `[Apply]`, minus bare `•` separators.

## Known quirks

- Apply links route through `account.ycombinator.com` auth — never followed.
- Some cards omit salary (location closes the card); some omit the location
  line entirely.
- The `?remote=true` query param on `/jobs` is NOT a filter (page renders
  unfiltered) — only the `/remote` URL suffix filters server-side.
- Company taglines can contain parens ("SiPhox Health (S20)At-Home health
  monitoring with silicon photonic chips") — parse name strictly before " (<BATCH>)".
