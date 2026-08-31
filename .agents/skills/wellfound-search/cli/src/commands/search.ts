import { parseSearchPage, renderTable, requireApiKey, scrapeMarkdown, type Job } from "../helpers.js"

export interface SearchOpts {
  query: string
  remote?: "remote" | "any"
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildSearchUrl(query: string, remote: string | undefined, page: number): string {
  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
  let url = `https://wellfound.com/role/r/${slug}`
  const params: string[] = []
  if (remote === "remote") params.push("remote=true")
  if (page > 1) params.push(`page=${page}`)
  if (params.length > 0) url += `?${params.join("&")}`
  return url
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const apiKey = requireApiKey()
  const url = buildSearchUrl(opts.query, opts.remote, opts.page)
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

  process.stdout.write(
    JSON.stringify(
      { meta: { count: jobs.length, page: opts.page }, results: jobs },
      null,
      2,
    ) + "\n",
  )
  return 0
}

function withinDays(iso: string, days: number): boolean {
  const then = new Date(iso).getTime()
  return Date.now() - then <= days * 86_400_000
}
