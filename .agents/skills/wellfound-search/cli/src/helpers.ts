// Shared helpers for the wellfound-search CLI.
// Fetching goes through the Firecrawl scrape API because Wellfound sits behind
// Cloudflare Turnstile (plain fetches receive a challenge shell, not job cards).
// See ../url-reference.md for the parsing anchors recorded at registration time.

export const FIRECRAWL_API = "https://api.firecrawl.dev/v1/scrape"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

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
      "FIRECRAWL_API_KEY not set — Wellfound is Cloudflare-protected, so every fetch goes through the Firecrawl API (billed per scrape). Get a key at https://firecrawl.dev and export FIRECRAWL_API_KEY.",
      "MISSING_CREDENTIALS",
    )
    process.exit(1)
  }
  return key
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Scrape one URL via Firecrawl, returning the page markdown. Retries 429/5xx with backoff. */
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
          "User-Agent": "Mozilla/5.0 (compatible; wellfound-cli/1.0)",
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

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxRetries) {
        throw new HttpError(res.status, "FIRECRAIL_UNAVAILABLE", `Firecrawl returned ${res.status} after ${maxRetries} retries`)
      }
      await sleep(backoffMs(attempt))
      continue
    }

    if (!res.ok) {
      throw new HttpError(res.status, "FIRECRAWL_ERROR", `Firecrawl returned ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }

    const body = (await res.json()) as {
      success?: boolean
      data?: { markdown?: string; metadata?: { statusCode?: number } }
    }
    const markdown = body?.data?.markdown
    if (typeof markdown !== "string" || markdown.length === 0) {
      throw new HttpError(502, "SCRAPE_EMPTY", "Firecrawl returned no markdown for the page")
    }
    // A Turnstile challenge or dead page renders without any job links —
    // surface that instead of a silent zero-result search.
    if (!/\(https:\/\/wellfound\.com\/jobs\/\d+/.test(markdown) && !/#{1,3}\s*About the job/i.test(markdown)) {
      throw new HttpError(403, "SCRAPE_CHALLENGED", "Page fetched but contains no job content — Cloudflare challenge or dead listing; retry later or use the full posting URL")
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
// Parsing — search page
// ---------------------------------------------------------------------------

export interface Job {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null
  url: string
  salary: string | null
  commitment: string | null
}

// Walk the markdown, alternating between company tokens and job-link tokens.
const TOKEN =
  /\[\*\*([^\*]+?)\*\*\]\(https:\/\/wellfound\.com\/company\/([a-z0-9-]+)\)|\[([^\]]+)\]\((https:\/\/wellfound\.com\/jobs\/(\d+)(?:-[^)]+)?)\)/g

const COMMITMENT = /\)\s*\n?\s*(Full-time|Part-time|Contract|Internship|Full Time|Contractor)\b/
const CURRENCY = /^[$₹€£][^\n]*/
const LOCATION = /[^\n#]*•[^\n#]*/

/** Parse a Wellfound role page's markdown into job cards. */
export function parseSearchPage(markdown: string): Job[] {
  const jobs: Job[] = []
  const seen = new Set<string>()
  let company: { name: string; url: string } | null = null
  const matches = [...markdown.matchAll(TOKEN)]

  matches.forEach((m, i) => {
    const [full, companyName, companySlug, jobTitle, jobPath, jobId] = m
    if (companyName !== undefined && companySlug !== undefined) {
      company = { name: companyName.trim(), url: `https://wellfound.com/company/${companySlug}` }
      return
    }
    if (jobTitle === undefined || jobPath === undefined || jobId === undefined) return
    if (seen.has(jobId)) return // sponsored repeats
    seen.add(jobId)

    const chunkEnd = i + 1 < matches.length ? (matches[i + 1] as RegExpMatchArray).index! : markdown.length
    const chunk = markdown.slice(m.index! + full.length, chunkEnd)

    const commitMatch = chunk.match(COMMITMENT)
    const salaryLine = chunk.split("\n").find((l) => CURRENCY.test(l.trim()))?.trim() ?? null
    // Location line: contains "•", has real text before it, and is not a salary/equity fragment.
    const locLine =
      chunk
        .split("\n")
        .map((l) => l.trim())
        .find(
          (l) =>
            l.includes("•") &&
            l.length > 8 &&
            !l.startsWith(")") &&
            !CURRENCY.test(l),
        ) ?? null
    const dateMatch = chunk.match(/(\d+)\s*\+?\s*(minute|hour|day|week|month)s?\s+ago|Just posted|Today/i)

    jobs.push({
      id: jobId,
      title: jobTitle.trim(),
      company: (company as { name: string } | null)?.name ?? null,
      companyUrl: (company as { url: string } | null)?.url ?? null,
      location: locLine ? locLine.replace(/\s*\+\d+\s*$/, "").trim() : null,
      date: relToIso(dateMatch?.[0] ?? null),
      url: jobPath,
      salary: salaryLine,
      commitment: commitMatch?.[1] ?? null,
    })
  })

  return jobs
}

/** Convert Wellfound's relative dates ("1 week ago") to ISO YYYY-MM-DD. */
export function relToIso(rel: string | null): string | null {
  if (!rel) return null
  const now = new Date()
  const low = rel.toLowerCase()
  if (low.includes("just posted") || low.includes("today")) return now.toISOString().slice(0, 10)
  const m = low.match(/(\d+)\s*\+?\s*(minute|hour|day|week|month)/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  const unitMs: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }
  return new Date(now.getTime() - n * unitMs[m[2]!]!).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Parsing — detail page
// ---------------------------------------------------------------------------

const TAGS = /<[^>]+>/g
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " }

export function decodeText(s: string): string {
  return s
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(TAGS, "")
}

/** Extract description markdown between "## About the job" and the next section. */
export function extractDescription(markdown: string): string | null {
  const start = markdown.search(/#{1,3}\s*About the job/i)
  if (start === -1) return null
  const rest = markdown.slice(start)
  const end = rest.slice(5).search(/#{1,3}\s*(About the company|Similar Jobs|About the team)/i)
  const body = end === -1 ? rest : rest.slice(0, end + 5)
  return body
    .split("\n")
    .filter((l) => !/^\s*(Save|Apply Now|Show more|Show less)\s*$/i.test(l))
    .join("\n")
    .trim()
}

export interface JobDetail {
  id: string
  url: string
  title: string | null
  company: string | null
  salary: string | null
  location: string | null
  remotePolicy: string | null
  description: string | null
}

/** Parse a Wellfound job-detail page's markdown. */
export function parseDetailPage(markdown: string, url: string): JobDetail {
  const idMatch = url.match(/\/jobs\/(\d+)/)
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
  const company = markdown.match(/\[\*\*([^\*]+?)\*\*\]\(https:\/\/wellfound\.com\/company\//)?.[1]?.trim() ?? null
  const salary = markdown.split("\n").find((l) => CURRENCY.test(l.trim()))?.trim() ?? null
  const locLine =
    markdown
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.includes("•") && l.length > 8 && !l.startsWith(")") && !CURRENCY.test(l))?.trim() ?? null
  const remotePolicy =
    markdown.match(/\|\s*(?:Remote \()?\s*\\?\|\s*Remote \(\s*\n([^)]+)\)/)?.[1]?.trim() ??
    markdown.match(/Remote Work Policy\s*\n+\s*([^\n]+)/)?.[1]?.trim() ??
    (markdown.match(/Hires remotely in\s*\n+\s*([^\n]+)/)?.[1]?.trim() ?? null)

  return {
    id: idMatch?.[1] ?? url,
    url,
    title,
    company,
    salary,
    location: locLine ? locLine.replace(/\s*\+\d+\s*$/, "").trim() : null,
    remotePolicy,
    description: extractDescription(markdown),
  }
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

export function renderTable(jobs: Job[]): string {
  if (jobs.length === 0) return "(no results)\n"
  const rows = jobs.map((j) => [
    j.title.slice(0, 34),
    (j.company ?? "?").slice(0, 18),
    (j.location ?? "?").replace(/\s+/g, " ").slice(0, 34),
    j.salary ?? "?",
    j.date ?? "?",
    j.id,
  ])
  const widths = [34, 18, 34, 22, 10, 12]
  const line = (cells: string[]) => cells.map((c, i) => (c ?? "").padEnd(widths[i]!)).join(" | ")
  return [line(["TITLE", "COMPANY", "LOCATION", "SALARY", "DATE", "ID"]), line(widths.map((w) => "-".repeat(w))), ...rows.map(line), ""].join("\n")
}
