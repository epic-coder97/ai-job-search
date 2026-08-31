import { describe, test, expect } from "bun:test"
import { parseSearchPage, relToIso, parseDetailPage, ROLE_TAXONOMY } from "../src/helpers.js"
import { buildSearchUrl } from "../src/commands/search.js"
import { runCLI, parseJSON } from "./helpers.js"

// Fixture cards modeled on the live scrape (2026-08-29).
const FIXTURE = `
[Embeddables (S18)•The funnel builder built for health & wellness brands.(2 days ago)](https://www.ycombinator.com/companies/embeddables) [Software Engineer](https://www.ycombinator.com/companies/embeddables/jobs/NAZgzHR-software-engineer)

Full-time

•

Engineering

•

Full stack

•

$42K - $54K

•

AR / Remote (AR)

[Apply](https://account.ycombinator.com/authenticate?continue=application%3Fsignup_job_id%3D102216)

[Feather (S22)•Voice AI(9 days ago)](https://www.ycombinator.com/companies/feather-2) [Backend + AI Engineer](https://www.ycombinator.com/companies/feather-2/jobs/OGlm8aX-backend-ai-engineer)

Full-time

•

Engineering

•

•

DL, IN / Delhi, IN / Remote (IN)

[Apply](https://account.ycombinator.com/authenticate?continue=application%3Fsignup_job_id%3D91212)
`

describe("parseSearchPage", () => {
  test("extracts company, batch, title, salary, location, date", () => {
    const jobs = parseSearchPage(FIXTURE)
    expect(jobs.length).toBe(2)
    expect(jobs[0]!.company).toBe("Embeddables")
    expect(jobs[0]!.batch).toBe("S18")
    expect(jobs[0]!.title).toBe("Software Engineer")
    expect(jobs[0]!.salary).toBe("$42K - $54K")
    expect(jobs[0]!.commitment).toBe("Full-time")
    expect(jobs[0]!.location).toBe("AR / Remote (AR)")
    expect(jobs[0]!.url).toContain("/companies/embeddables/jobs/NAZgzHR-software-engineer")
    expect(jobs[0]!.date).not.toBeNull()
    // Second card: no salary, attribution switches to Feather
    expect(jobs[1]!.company).toBe("Feather")
    expect(jobs[1]!.batch).toBe("S22")
    expect(jobs[1]!.salary).toBeNull()
    expect(jobs[1]!.location).toBe("DL, IN / Delhi, IN / Remote (IN)")
  })

  test("stale company token does not bleed across slugs", () => {
    const orphan = `
[Embeddables (S18)•funnels(2 days ago)](https://www.ycombinator.com/companies/embeddables) [Software Engineer](https://www.ycombinator.com/companies/embeddables/jobs/NAZgzHR-software-engineer)

Full-time

•

London

[Apply](https://x)

[Unknown Title](https://www.ycombinator.com/companies/other-co/jobs/AbCd123-some-role)

Full-time

•

New York

[Apply](https://y)
`
    const jobs = parseSearchPage(orphan)
    expect(jobs[1]!.company).toBeNull()
    expect(jobs[1]!.batch).toBeNull()
  })
})

describe("relToIso", () => {
  test("converts relative dates", () => {
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    expect(relToIso("1 day ago")).toBe(day)
    expect(relToIso("about 14 hours ago")).not.toBeNull()
    expect(relToIso(null)).toBeNull()
  })
})

describe("buildSearchUrl", () => {
  test("slugifies with suffix filters", () => {
    expect(buildSearchUrl("Software Engineer", true, undefined)).toBe("https://www.ycombinator.com/jobs/role/software-engineer/remote")
    expect(buildSearchUrl("designer", false, "San Francisco")).toBe("https://www.ycombinator.com/jobs/role/designer/san-francisco")
    expect(buildSearchUrl("Product Manager", false, undefined)).toBe("https://www.ycombinator.com/jobs/role/product-manager")
  })

  test("taxonomy has the documented roles", () => {
    expect(ROLE_TAXONOMY).toContain("software-engineer")
    expect(ROLE_TAXONOMY.length).toBe(9)
  })
})

describe("parseDetailPage", () => {
  test("extracts title, company, description paragraphs", () => {
    const md = [
      "# Backend + AI Engineer",
      "[Feather (S22)•Voice AI](https://www.ycombinator.com/companies/feather-2)",
      "**Salary:** $150K - $220K",
      "**Location:** Delhi, IN / Remote (IN)",
      "Feather is building Voice AI for healthcare. ".repeat(6),
      "",
      "## About Work at a Startup",
      "Footer text.",
    ].join("\n")
    const d = parseDetailPage(md, "https://www.ycombinator.com/companies/feather-2/jobs/OGlm8aX-backend-ai-engineer")
    expect(d.title).toBe("Backend + AI Engineer")
    expect(d.company).toBe("Feather")
    expect(d.id).toBe("OGlm8aX")
    expect(d.description).toContain("Voice AI for healthcare")
    expect(d.description).not.toContain("Footer text")
  })
})

describe("cli contract", () => {
  test("missing --query exits 1 with NO_QUERY", async () => {
    const r = await runCLI(["search"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("NO_QUERY")
  })

  test("--remote + --location conflict exits 1", async () => {
    const r = await runCLI(["search", "-q", "designer", "--remote", "-l", "London"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("CONFLICTING_FLAGS")
  })

  test("bare id detail exits 1 with BAD_ID", async () => {
    const r = await runCLI(["detail", "OGlm8aX"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("BAD_ID")
  })

  test("bogus flag exits 1 with UNKNOWN_FLAG", async () => {
    const r = await runCLI(["search", "-q", "designer", "--bogus", "1"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("unset FIRECRAWL_API_KEY exits 1 with MISSING_CREDENTIALS", async () => {
    const r = await runCLI(["search", "-q", "software engineer"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("MISSING_CREDENTIALS")
  })
})

const hasKey = !!process.env.FIRECRAWL_API_KEY

describe("live smoke test", () => {
  test.skipIf(!hasKey)("search returns >=1 real result", async () => {
    const r = await runCLI(["search", "-q", "software engineer", "--remote", "--limit", "3", "--format", "json"])
    expect(r.exitCode).toBe(0)
    const body = parseJSON<{ meta: { count: number }; results: { id: string; title: string; url: string }[] }>(r.stdout)
    expect(body.meta.count).toBeGreaterThan(0)
    expect(body.results[0]!.url).toContain("ycombinator.com/companies/")
  }, 60_000)
})
