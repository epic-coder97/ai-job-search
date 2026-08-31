// Shared helpers for the ycombinator-search CLI.
// YC's job board renders client-side, so every page is fetched through the
// Firecrawl scrape API keyed by FIRECRAWL_API_KEY (environment only).
// Parsing anchors are documented in ../url-reference.md.

export const FIRECRAWL_API = "https://api.firecrawl.dev/v1/scrape"

export const ROLE_TAXONOMY = [
  "software-engineer",
  "designer",
  "product-manager",
  "recruiting-hr",
  "sales-manager",
  "marketing",
  "support",
  "operations",
  "science",
] as const

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function requireApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) {
    writeError(
      "FIRECRAWL_API_KEY not set — YC's job board renders client-side, so every call goes through the Firecrawl API (billed per scrape). Get a key at https://firecrawl.dev and export FIRECRAWL_API_KEY.",
      "MISSING_CREDENTIALS",
    )
    process.exit(1)
  }
  return key
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Scrape one URL via Firecrawl, returning the page markdown. Retries 429/408/5xx with backoff. */
export async function scrapeMarkdown(url: string, apiKey: string): Promise<string> {
  const maxRetries = 6
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(FIRECRAWL_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ycombinator-cli/1.0)",
        },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: false }),
      })
    } catch (e) {
      if (attempt >= maxRetries) {
        throw new HttpError(0, "NETWORK_ERROR", `fetch failed after ${maxRetries} retries: ${e instanceof Error ? e.message : String(e)}`)
      }
      await sleep(backoffMs(attempt))
      continue
    }

    if (res.status === 429 || res.status === 408 || res.status >= 500) {
      if (attempt >= maxRetries) {
        throw new HttpError(res.status, "FIRECRAWL_UNAVAILABLE", `Firecrawl returned ${res.status} after ${maxRetries} retries`)
      }
      await sleep(backoffMs(attempt))
      continue
    }

    if (!res.ok) {
      throw new HttpError(res.status, "FIRECRAWL_ERROR", `Firecrawl returned ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }

    const body = (await res.json()) as {
      success?: boolean
      data?: { markdown?: string }
    }
    const markdown = body?.data?.markdown
    if (typeof markdown !== "string" || markdown.length === 0) {
      throw new HttpError(502, "SCRAPE_EMPTY", "Firecrawl returned no markdown for the page")
    }
    if (!/ycombinator\.com\/companies\/[a-z0-9-]+\/jobs\//.test(markdown)) {
      throw new HttpError(404, "NO_RESULTS", "Page fetched but contains no job cards — unknown role slug or empty page; see --help for the role taxonomy")
    }
    return markdown
  }
}

function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, attempt)
  const jitter = Math.random() * 0.3 * base
  return Math.min(base + jitter, 30_000)
}

// ---------------------------------------------------------------------------
// Parsing — role page
// ---------------------------------------------------------------------------

export interface Job {
  id: string
  title: string
  company: string | null
  batch: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  url: string
  salary: string | null
  commitment: string | null
}

// Alternation: company tokens ("[Acme (S22)•tagline(2 days ago)](/companies/acme)")
// and job tokens ("[Title](/companies/acme/jobs/NAZgzHR-software-engineer)").
const TOKEN =
  /\[([^\]]+?)\s*\(([SWF]\d{2}|IK\d{2}|SS\d{2})\)[^()\]]*\(([^()]*?\d+\s*(?:minutes?|hours?|days?|weeks?|months?)\s*ago)\)\]\(https:\/\/www\.ycombinator\.com\/companies\/([a-z0-9-]+)\)|\[([^\]]+)\]\(https:\/\/www\.ycombinator\.com\/companies\/([a-z0-9-]+)\/jobs\/([A-Za-z0-9]+)-([a-z0-9-]+)\)/g

const COMMITMENT = /^(Full-time|Part-time|Contract|Internship)$/i

interface CompanyInfo {
  name: string
  batch: string
  url: string
  date: string | null
}

/** Parse a YC role page's markdown into job cards. */
export function parseSearchPage(markdown: string): Job[] {
  const jobs: Job[] = []
  const seen = new Set<string>()
  let company: CompanyInfo | null = null
  const matches = [...markdown.matchAll(TOKEN)]

  matches.forEach((m, i) => {
    const [full, coName, coBatch, coDate, coSlug, jobTitle, jobCompanySlug, jobId, jobSlug] = m
    if (coSlug !== undefined) {
      company = { name: coName!.trim(), batch: coBatch!, url: `https://www.ycombinator.com/companies/${coSlug}`, date: coDate ?? null }
      return
    }
    if (jobTitle === undefined || jobCompanySlug === undefined || jobId === undefined) return
    if (seen.has(jobId)) return
    seen.add(jobId)

    // Company attribution: the preceding company token, but only if its slug
    // matches the job URL's company (a stale token must not bleed across).
    const co = company && company.url.endsWith(`/${jobCompanySlug}`) ? company : null

    // Meta block: lines between this job link and the card boundary — the
    // earlier of the next token or the card's [Apply] link — minus bare
    // bullet separators and any link lines.
    const applyIdx = markdown.indexOf("[Apply]", m.index!)
    const nextTokIdx = i + 1 < matches.length ? (matches[i + 1] as RegExpMatchArray).index! : markdown.length
    const applyBound = applyIdx > m.index! ? applyIdx : markdown.length
    const end = Math.min(nextTokIdx, applyBound)
    const meta = (markdown.slice(m.index! + full.length, end) ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== "•" && !/^[!\[]/.test(l))
    const commitment = meta.find((l) => COMMITMENT.test(l)) ?? null
    const salary = meta.find((l) => /^\$/.test(l)) ?? null
    const location = meta.length > 0 ? meta[meta.length - 1]! : null

    jobs.push({
      id: jobId,
      title: jobTitle.trim(),
      company: co?.name ?? null,
      batch: co?.batch ?? null,
      companyUrl: co?.url ?? null,
      location,
      date: relToIso(co?.date ?? null),
      url: `https://www.ycombinator.com/companies/${jobCompanySlug}/jobs/${jobId}-${jobSlug}`,
      salary,
      commitment,
    })
  })

  return jobs
}

/** Convert YC's relative dates ("2 days ago", "about 14 hours ago") to ISO. */
export function relToIso(rel: string | null): string | null {
  if (!rel) return null
  const m = rel.toLowerCase().replace(/^about\s+/, "").match(/(\d+)\s*(minute|hour|day|week|month)/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  const unitMs: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }
  return new Date(Date.now() - n * unitMs[m[2]!]!).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Parsing — detail page
// ---------------------------------------------------------------------------

const TAGS = /<[^>]+>/g
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " }

export function decodeText(s: string): string {
  return s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e).replace(TAGS, "")
}

export interface JobDetail {
  id: string
  url: string
  title: string | null
  company: string | null
  salary: string | null
  location: string | null
  description: string | null
}

/** Parse a YC job-detail page's markdown. */
export function parseDetailPage(markdown: string, url: string): JobDetail {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
  const company = markdown.match(/\[([^\]]+)\s*\(([SWF]\d{2}|IK\d{2})\)/)?.[1]?.trim() ?? null
  const salary = markdown.split("\n").map((l) => l.trim()).find((l) => /^\$/.test(l) && /\d/.test(l)) ?? null
  const location =
    markdown.match(/\*\*Location:?\*\*\s*\n+\s*([^\n]+)/)?.[1]?.trim() ??
    markdown.match(/^Location:?\s*\n+\s*([^\n]+)$/im)?.[1]?.trim() ?? null

  // Description: prose paragraphs from the body, stopping at footer sections.
  const footerIdx = markdown.search(/^#{1,3}\s*(About (Work at a Startup|YC|Y Combinator)|Related jobs|Similar jobs|More jobs)/im)
  const body = footerIdx === -1 ? markdown : markdown.slice(0, footerIdx)
  const paragraphs = body
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 200 && !p.startsWith("[") && !p.startsWith("!"))
  const description = paragraphs.length > 0 ? paragraphs.join("\n\n") : null

  return { id: url.match(/\/jobs\/([A-Za-z0-9]+)-/)?.[1] ?? url, url, title, company, salary, location, description }
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

export function renderTable(jobs: Job[]): string {
  if (jobs.length === 0) return "(no results)\n"
  const rows = jobs.map((j) => [
    j.title.slice(0, 34),
    (j.company ?? "?").slice(0, 20),
    (j.batch ?? "?").slice(0, 5),
    (j.location ?? "?").replace(/\s+/g, " ").slice(0, 30),
    (j.salary ?? "?").slice(0, 18),
    j.date ?? "?",
  ])
  const widths = [34, 20, 5, 30, 18, 10]
  const line = (cells: string[]) => cells.map((c, i) => (c ?? "").padEnd(widths[i]!)).join(" | ")
  return [line(["TITLE", "COMPANY", "BATCH", "LOCATION", "SALARY", "DATE"]), line(widths.map((w) => "-".repeat(w))), ...rows.map(line), ""].join("\n")
}
