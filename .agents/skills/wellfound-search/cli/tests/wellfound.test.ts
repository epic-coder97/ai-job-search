import { describe, test, expect } from "bun:test"
import { parseSearchPage, relToIso, extractDescription } from "../src/helpers.js"
import { buildSearchUrl } from "../src/commands/search.js"
import { buildDetailUrl as buildDetailUrlCmd } from "../src/commands/detail.js"
import { runCLI, parseJSON } from "./helpers.js"

// ---------------------------------------------------------------------------
// Parser unit tests against a fixture captured live via Firecrawl (2026-08-29)
// ---------------------------------------------------------------------------

const FIXTURE = `
[**Monte Carlo**](https://wellfound.com/company/monte-carlo-data-1)

Actively Hiring

New Relic for data teams11-50 Employees

[Senior AI Engineer](https://wellfound.com/jobs/4639961-senior-ai-engineer) Full-time

$180k – $240k

Remote • United States

1 day ago

1 day agoSave

Apply

[Senior Pre Sales Engineer - US](https://wellfound.com/jobs/4523994-senior-pre-sales-engineer-us) Full-time

Remote • United States

4 weeks ago

[**Marble**](https://wellfound.com/company/marble-19)

[AI Engineer](https://wellfound.com/jobs/4574038-ai-engineer) Full-time

$150k – $200k

Onsite or remote • New York+1

1 week ago

[AI Engineer](https://wellfound.com/jobs/4235671-ai-engineer) Full-time

₹12L – ₹20L • No equity

Onsite or remote • Bengaluru+4

7 days ago
`

describe("parseSearchPage", () => {
  test("extracts jobs with carried-over company attribution", () => {
    const jobs = parseSearchPage(FIXTURE)
    expect(jobs.length).toBe(4)
    expect(jobs[0]!.company).toBe("Monte Carlo")
    expect(jobs[0]!.id).toBe("4639961")
    expect(jobs[0]!.title).toBe("Senior AI Engineer")
    expect(jobs[0]!.salary).toContain("$180k")
    expect(jobs[0]!.location).toBe("Remote • United States")
    // second Monte Carlo job keeps the carried-over company
    expect(jobs[1]!.company).toBe("Monte Carlo")
    // company switches to Marble for the third
    expect(jobs[2]!.company).toBe("Marble")
    expect(jobs[2]!.location).toBe("Onsite or remote • New York")
    expect(jobs[3]!.salary).toContain("₹12L")
  })

  test("deduplicates sponsored repeats by id", () => {
    const dup = FIXTURE + `[AI Engineer](https://wellfound.com/jobs/4574038-ai-engineer) Full-time`
    expect(parseSearchPage(dup).length).toBe(4)
  })
})

describe("relToIso", () => {
  test("converts relative dates to ISO", () => {
    const today = relToIso("Today")!
    expect(today).toBe(new Date().toISOString().slice(0, 10))
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    expect(relToIso("1 week ago")).toBe(weekAgo)
    expect(relToIso("3 days ago")).not.toBeNull()
    expect(relToIso(null)).toBeNull()
  })
})

describe("extractDescription", () => {
  test("slices the About-the-job section", () => {
    const md = "# AI Engineer\n\n## About the job\n\nBuild AI things.\n\n- Python\n\n## About the company\n\nWe are a company."
    const desc = extractDescription(md)!
    expect(desc).toContain("Build AI things")
    expect(desc).toContain("Python")
    expect(desc).not.toContain("We are a company")
  })
})

describe("url builders", () => {
  test("slugifies queries and applies filters", () => {
    expect(buildSearchUrl("AI Engineer", "remote", 1)).toBe("https://wellfound.com/role/r/ai-engineer?remote=true")
    expect(buildSearchUrl("Machine Learning Engineer", "any", 2)).toBe("https://wellfound.com/role/r/machine-learning-engineer?page=2")
    expect(buildDetailUrlCmd("4574038")).toBe("https://wellfound.com/jobs/4574038")
    expect(buildDetailUrlCmd("https://wellfound.com/jobs/4574038-ai-engineer")).toBe("https://wellfound.com/jobs/4574038-ai-engineer")
  })
})

// ---------------------------------------------------------------------------
// CLI contract tests (no network, no credentials needed)
// ---------------------------------------------------------------------------

describe("cli contract", () => {
  test("missing required --query exits 1 with JSON error on stderr", async () => {
    const r = await runCLI(["search"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    const err = parseJSON<{ error: string; code: string }>(r.stderr)
    expect(err.code).toBe("NO_QUERY")
  })

  test("bogus flag exits 1 with UNKNOWN_FLAG", async () => {
    const r = await runCLI(["search", "-q", "ai engineer", "--bogus", "1"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("unset FIRECRAWL_API_KEY exits 1 with MISSING_CREDENTIALS", async () => {
    const r = await runCLI(["search", "-q", "ai engineer"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    const err = parseJSON<{ error: string; code: string }>(r.stderr)
    expect(err.code).toBe("MISSING_CREDENTIALS")
    expect(err.error).toContain("FIRECRAWL_API_KEY")
  })

  test("detail without id exits 1", async () => {
    const r = await runCLI(["detail"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("NO_ID")
  })

  test("--help prints usage", async () => {
    const r = await runCLI(["--help"], { FIRECRAWL_API_KEY: undefined })
    expect(r.stdout).toContain("wellfound-cli")
    expect(r.stdout).toContain("SEARCH FLAGS")
  })
})

// ---------------------------------------------------------------------------
// Live smoke test — runs only when FIRECRAWL_API_KEY is set (billed call)
// ---------------------------------------------------------------------------

const hasKey = !!process.env.FIRECRAWL_API_KEY

describe("live smoke test", () => {
  test.skipIf(!hasKey)("search returns >=1 real result", async () => {
    const r = await runCLI(["search", "-q", "ai engineer", "--limit", "3", "--format", "json"])
    expect(r.exitCode).toBe(0)
    const body = parseJSON<{ meta: { count: number }; results: { id: string; title: string; url: string }[] }>(r.stdout)
    expect(body.meta.count).toBeGreaterThan(0)
    expect(body.results[0]!.id).toBeTruthy()
    expect(body.results[0]!.title).toBeTruthy()
    expect(body.results[0]!.url).toContain("wellfound.com/jobs/")
  }, 60_000)
})
