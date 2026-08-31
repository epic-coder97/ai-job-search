import { describe, test, expect } from "bun:test"
import { parseSearchPage, relToIso, parseDetailPage } from "../src/helpers.js"
import { buildSearchUrl } from "../src/commands/search.js"
import { buildDetailUrl } from "../src/commands/detail.js"
import { runCLI, parseJSON } from "./helpers.js"

// Fixture captured live via Firecrawl (2026-08-29), two cards.
const FIXTURE = `
3mo

Save

Mark Applied

Hide

3mo

AI Engineer

United States

$108k-$130k/yrRemoteFull Time

![GitLab](https://s2.googleusercontent.com/s2/favicons?domain=gitlab.com&sz=128)

GitLabNASDAQ: GTLB: Intelligent orchestration platform for DevSecOps and software development.

Deep AI/ML engineering experience, strong software fundamentals, API/SDK integration, and system design.

Python, JavaScript/TypeScript, REST APIs

[Job Posting](https://hiringcafe.com/job/ai-engineer-gitlab-united-states-pd1l9p7ceysh65be) [View all](https://hiringcafe.com/org/gitlab.com)

1w

Save

Mark Applied

Hide

1w

AI Engineer

Arlington, Virginia, United States

OnsiteFull Time

![Fivecast](https://s2.googleusercontent.com/s2/favicons?domain=fivecast.com&sz=128)

Fivecast: N Australian AI-powered OSINT software serving government agencies.

5+ YOEBachelor's degree in computer science.

AWS, GCP, React, Spring, UML

[Job Posting](https://hiringcafe.com/job/ai-engineer-fivecast-arlington-virginia-wqudl88ifj5tf4ut) [View all](https://hiringcafe.com/org/fivecast.com)
`

describe("parseSearchPage", () => {
  test("extracts title, company, salary, workplace, location, date", () => {
    const jobs = parseSearchPage(FIXTURE)
    expect(jobs.length).toBe(2)
    expect(jobs[0]!.title).toBe("AI Engineer")
    expect(jobs[0]!.company).toBe("GitLab")
    expect(jobs[0]!.salary).toContain("$108k-$130k/yr")
    expect(jobs[0]!.workplace).toBe("Remote")
    expect(jobs[0]!.location).toBe("United States")
    expect(jobs[0]!.url).toContain("ai-engineer-gitlab-united-states")
    expect(jobs[0]!.date).not.toBeNull()
    // Second card: no salary, ticker-free company line
    expect(jobs[1]!.company).toBe("Fivecast")
    expect(jobs[1]!.salary).toBeNull()
    expect(jobs[1]!.workplace).toBe("Onsite")
  })
})

describe("relToIso", () => {
  test("converts compact tokens", () => {
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    expect(relToIso("1w")).toBe(week)
    expect(relToIso("10h")).not.toBeNull()
    expect(relToIso("3mo")).not.toBeNull()
    expect(relToIso(null)).toBeNull()
    expect(relToIso("nonsense")).toBeNull()
  })
})

describe("url builders", () => {
  test("slugify and detail forms", () => {
    expect(buildSearchUrl("AI Engineer")).toBe("https://hiringcafe.com/jobs/ai-engineer")
    expect(buildDetailUrl("ai-engineer-gitlab-united-states-pd1l9p7ceysh65be")).toBe(
      "https://hiringcafe.com/job/ai-engineer-gitlab-united-states-pd1l9p7ceysh65be",
    )
    expect(buildDetailUrl("https://hiringcafe.com/job/x")).toBe("https://hiringcafe.com/job/x")
  })
})

describe("parseDetailPage", () => {
  test("extracts the description section", () => {
    const md = [
      "United States",
      "![GitLab](https://s2.googleusercontent.com/x)",
      "Posted 3mo ago",
      "# AI Engineer",
      "GitLab",
      "[gitlab.com](https://gitlab.com/) [View all open roles](https://hiringcafe.com/org/gitlab.com)",
      "United States",
      "$108k-$130k/yrRemoteFull Time",
      "## Job description",
      "GitLab is the intelligent orchestration platform.",
      "- Ship things",
      "## About GitLab",
      "Year founded 2014",
    ].join("\n")
    const d = parseDetailPage(md, "https://hiringcafe.com/job/ai-engineer-gitlab-united-states-pd1l9p7ceysh65be")
    expect(d.title).toBe("AI Engineer")
    expect(d.company).toBe("GitLab")
    expect(d.salary).toContain("$108k")
    expect(d.workplace).toBe("Remote")
    expect(d.location).toBe("United States")
    expect(d.description).toContain("intelligent orchestration platform")
    expect(d.description).not.toContain("Year founded")
  })
})

describe("cli contract", () => {
  test("missing --query exits 1 with NO_QUERY", async () => {
    const r = await runCLI(["search"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("NO_QUERY")
  })

  test("--page exits 1 with PAGE_DISALLOWED", async () => {
    const r = await runCLI(["search", "-q", "ai", "--page", "2"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("PAGE_DISALLOWED")
  })

  test("bogus flag exits 1 with UNKNOWN_FLAG", async () => {
    const r = await runCLI(["search", "-q", "ai", "--bogus", "1"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("UNKNOWN_FLAG")
  })

  test("unset FIRECRAWL_API_KEY exits 1 with MISSING_CREDENTIALS", async () => {
    const r = await runCLI(["search", "-q", "ai engineer"], { FIRECRAWL_API_KEY: undefined })
    expect(r.exitCode).toBe(1)
    expect(parseJSON<{ code: string }>(r.stderr).code).toBe("MISSING_CREDENTIALS")
  })
})

const hasKey = !!process.env.FIRECRAWL_API_KEY

describe("live smoke test", () => {
  test.skipIf(!hasKey)("search returns >=1 real result", async () => {
    const r = await runCLI(["search", "-q", "ai engineer", "--limit", "3", "--format", "json"])
    expect(r.exitCode).toBe(0)
    const body = parseJSON<{ meta: { count: number }; results: { id: string; title: string; url: string }[] }>(r.stdout)
    expect(body.meta.count).toBeGreaterThan(0)
    expect(body.results[0]!.url).toContain("hiringcafe.com/job/")
  }, 60_000)
})
