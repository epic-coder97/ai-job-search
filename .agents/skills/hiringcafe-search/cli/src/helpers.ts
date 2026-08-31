// Shared helpers for the hiringcafe-search CLI.
// HiringCafe blocks plain fetches (HTTP 403), so every page is fetched through
// the Firecrawl scrape API keyed by FIRECRAWL_API_KEY (environment only).
// Parsing anchors are documented in ../url-reference.md.

export const FIRECRAWL_API = "https://api.firecrawl.dev/v1/scrape"

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
      "FIRECRAWL_API_KEY not set — HiringCafe blocks plain fetches, so every call goes through the Firecrawl API (billed per scrape). Get a key at https://firecrawl.dev and export FIRECRAWL_API_KEY.",
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
          "User-Agent": "Mozilla/5.0 (compatible; hiringcafe-cli/1.0)",
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
    if (!/hiringcafe\.com\/(job|jobs)\//.test(markdown) && !/#{1,3}\s*Job description/i.test(markdown)) {
      throw new HttpError(403, "SCRAPE_CHALLENGED", "Page fetched but contains no job content — bot challenge or dead listing; retry later")
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
  location: string | null
  date: string | null
  url: string
  salary: string | null
  workplace: string | null
}

// Card boundary: the "Job Posting" link every card ends with.
const JOB_LINK = /\[Job Posting\]\((https:\/\/hiringcafe\.com\/job\/([a-z0-9-]+))\)/g

const CHROME = /^(Save|Mark Applied|Hide|See how many viewed or applied)$/i
const DATE_TOKEN = /^(\d+)\s*(mo|w|d|h|hr)s?$/i
// The commitment part is required: the page header's "Remote · Hybrid · Onsite"
// filter text must not parse as a card's work line.
const WORK_LINE = /(\$[^\n]*\/yr)?\s*(Remote|Hybrid|Onsite)\s*(Full Time|Part Time|Contract|Internship)/

const TICKER = /(NASDAQ|NYSE|BSE|BATS|NSE|TSX|FRA|EPA|OTC):/

/** Parse a HiringCafe search page's markdown into job cards. */
export function parseSearchPage(markdown: string): Job[] {
  const jobs: Job[] = []
  const seen = new Set<string>()
  const matches = [...markdown.matchAll(JOB_LINK)]

  matches.forEach((m, i) => {
    const url = m[1]!
    const slug = m[2]!
    if (seen.has(slug)) return
    seen.add(slug)

    const chunkStart = i > 0 ? (matches[i - 1] as RegExpMatchArray).index! + matches[i - 1]![0].length : 0
    const chunk = markdown.slice(chunkStart, m.index!)

    // Lines before the [Job Posting] link, cleaned of chrome and empties.
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !CHROME.test(l))

    // Plain-text guard: header junk (links, pipes, markup) is excluded so
    // page chrome never parses into card fields. Company lines carry a long
    // ticker + blurb tail, so they get a looser length cap.
    const plain = (l: string) => l.length <= 80 && !/^(https?|\[|!|\()/.test(l) && !/[|{}]/.test(l)
    const plainCompany = (l: string) => l.length <= 200 && !/^(https?|\[|!|\()/.test(l) && !/[|{}]/.test(l)

    // Company: first plain line after the favicon link; strip ticker metadata.
    const faviconIdx = lines.findIndex((l) => /s2\.googleusercontent\.com\/s2\/favicons/.test(l))
    let company: string | null = null
    if (faviconIdx !== -1) {
      for (let k = faviconIdx + 1; k < Math.min(faviconIdx + 3, lines.length); k++) {
        const raw = lines[k]!
        if (!plainCompany(raw)) continue
        company = (raw.match(TICKER)?.index !== undefined ? raw.slice(0, raw.match(TICKER)!.index) : raw.split(/:(?=[^/])/, 1)[0] ?? raw).trim()
        if (company.length === 0 || company.length > 60) company = raw.split(":")[0]!.trim()
        break
      }
    }

    // Salary/workplace line.
    const workIdx = lines.findIndex((l) => WORK_LINE.test(l) && /(Remote|Hybrid|Onsite)/.test(l))
    let salary: string | null = null
    let workplace: string | null = null
    if (workIdx !== -1) {
      const wm = lines[workIdx]!.match(WORK_LINE)!
      salary = wm[1] ?? null
      workplace = wm[2]!
    }

    // Card layout: title, then location, then the salary/work line — so
    // walking backward from the work line: last = location, before it = title.
    const baseIdx = workIdx !== -1 ? workIdx : faviconIdx
    const above = lines
      .slice(0, baseIdx === -1 ? lines.length : baseIdx)
      .filter((l) => !DATE_TOKEN.test(l) && !/s2\.googleusercontent/.test(l) && plain(l))
    let title: string | null = null
    let location: string | null = null
    if (above.length >= 2) {
      location = above[above.length - 1]!
      title = above[above.length - 2]!
    } else if (above.length === 1) {
      title = above[0]!
    }

    // Date: first relative token in the card.
    const dateLine = lines.find((l) => DATE_TOKEN.test(l))

    jobs.push({
      id: slug,
      title: title ?? "Unknown",
      company,
      location: location ?? null,
      date: relToIso(dateLine ?? null),
      url,
      salary,
      workplace,
    })
  })

  return jobs
}

/** Convert HiringCafe's compact relative dates ("3mo", "1w", "10h") to ISO. */
export function relToIso(rel: string | null): string | null {
  if (!rel) return null
  const m = rel.toLowerCase().match(/^(\d+)\s*(mo|w|d|h|hr)s?$/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  const unitMs: Record<string, number> = { mo: 2_592_000_000, w: 604_800_000, d: 86_400_000, h: 3_600_000, hr: 3_600_000 }
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

/** Parse a HiringCafe job-detail page's markdown. */
export function parseDetailPage(markdown: string, url: string): {
  id: string
  url: string
  title: string | null
  company: string | null
  salary: string | null
  workplace: string | null
  location: string | null
  description: string | null
} {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
  const topLines = markdown.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  const h1Idx = topLines.findIndex((l) => l.startsWith("# "))
  // Location: first plain-text line before the H1 (page opens with it).
  const location = h1Idx > 0 ? topLines.slice(0, h1Idx).find((l) => !/^!?\[/.test(l) && !/^Posted /.test(l)) ?? null : null
  // Company: the plain-name line right after the H1 (before any link line).
  let company: string | null = null
  if (h1Idx !== -1) {
    for (const l of topLines.slice(h1Idx + 1, h1Idx + 6)) {
      if (/^\[/.test(l) || l.length > 60) break
      company = l
      break
    }
  }
  const workIdx = topLines.findIndex((l) => /\/yr/.test(l) || (/^(Remote|Hybrid|Onsite)/.test(l) && /Full Time|Part Time|Contract|Internship/.test(l)))
  const workLine = workIdx !== -1 ? topLines[workIdx]! : null
  const salary = workLine?.match(/\$[^\s]+(?:-\$[^\s]+)?\/yr/)?.[0] ?? workLine?.match(/\$[^\n]*?\/yr/)?.[0] ?? null
  const workplace = workLine?.match(/(Remote|Hybrid|Onsite)/)?.[1] ?? null

  // Description: "## Job description" … up to "## About …" or "## Similar jobs".
  const startIdx = topLines.findIndex((l) => /^#{1,3}\s*Job description/i.test(l))
  let description: string | null = null
  if (startIdx !== -1) {
    const rest = topLines.slice(startIdx + 1)
    const endIdx = rest.findIndex((l) => /^#{1,3}\s*(About\s|Similar jobs)/i.test(l))
    description = (endIdx === -1 ? rest : rest.slice(0, endIdx)).join("\n").trim()
  }

  return { id: url.match(/\/job\/([a-z0-9-]+)/)?.[1] ?? url, url, title, company, salary, workplace, location, description }
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

export function renderTable(jobs: Job[]): string {
  if (jobs.length === 0) return "(no results)\n"
  const rows = jobs.map((j) => [
    j.title.slice(0, 34),
    (j.company ?? "?").slice(0, 18),
    (j.location ?? "?").slice(0, 30),
    (j.salary ?? "?").slice(0, 20),
    (j.workplace ?? "?").slice(0, 8),
    j.date ?? "?",
  ])
  const widths = [34, 18, 30, 20, 8, 10]
  const line = (cells: string[]) => cells.map((c, i) => (c ?? "").padEnd(widths[i]!)).join(" | ")
  return [line(["TITLE", "COMPANY", "LOCATION", "SALARY", "WORK", "DATE"]), line(widths.map((w) => "-".repeat(w))), ...rows.map(line), ""].join("\n")
}
