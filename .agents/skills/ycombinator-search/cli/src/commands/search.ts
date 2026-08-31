import { parseSearchPage, renderTable, requireApiKey, scrapeMarkdown, type Job } from "../helpers.js"

export interface SearchOpts {
  query: string
  remote?: boolean
  location?: string
  jobage?: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildSearchUrl(query: string, remote: boolean | undefined, location: string | undefined): string {
  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
  let url = `https://www.ycombinator.com/jobs/role/${slug}`
  if (remote) url += "/remote"
  else if (location) url += `/${location.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-")}`
  return url
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const apiKey = requireApiKey()
  const url = buildSearchUrl(opts.query, opts.remote, opts.location)
  const markdown = await scrapeMarkdown(url, apiKey)
  let jobs: Job[] = parseSearchPage(markdown)
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
