import { parseSearchPage, renderTable, requireApiKey, scrapeMarkdown, type Job } from "../helpers.js"

export interface SearchOpts {
  query: string
  remote?: "remote" | "hybrid" | "onsite" | "any"
  jobage?: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildSearchUrl(query: string): string {
  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
  return `https://hiringcafe.com/jobs/${slug}`
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const apiKey = requireApiKey()
  const url = buildSearchUrl(opts.query)
  const markdown = await scrapeMarkdown(url, apiKey)
  let jobs: Job[] = parseSearchPage(markdown)
  if (opts.remote && opts.remote !== "any") {
    jobs = jobs.filter((j) => (j.workplace ?? "").toLowerCase() === opts.remote)
  }
  if (opts.jobage !== undefined) {
    jobs = jobs.filter((j) => j.date === null || withinDays(j.date, opts.jobage!))
  }
  if (opts.limit !== undefined) jobs = jobs.slice(0, opts.limit)

  if (opts.format === "table" || opts.format === "plain") {
    process.stdout.write(renderTable(jobs))
    return 0
  }

  process.stdout.write(JSON.stringify({ meta: { count: jobs.length, page: 1 }, results: jobs }, null, 2) + "\n")
  return 0
}

function withinDays(iso: string, days: number): boolean {
  return Date.now() - new Date(iso).getTime() <= days * 86_400_000
}
