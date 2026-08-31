import { parseDetailPage, requireApiKey, scrapeMarkdown } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export function buildDetailUrl(id: string): string {
  if (id.startsWith("http://") || id.startsWith("https://")) return id
  return `https://wellfound.com/jobs/${id}`
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const apiKey = requireApiKey()
  const url = buildDetailUrl(opts.id)
  const markdown = await scrapeMarkdown(url, apiKey)
  const detail = parseDetailPage(markdown, url)

  if (opts.format === "plain") {
    const out = [
      `TITLE:    ${detail.title ?? "?"}`,
      `COMPANY:  ${detail.company ?? "?"}`,
      `SALARY:   ${detail.salary ?? "?"}`,
      `LOCATION: ${detail.location ?? "?"}`,
      `REMOTE:   ${detail.remotePolicy ?? "?"}`,
      `URL:      ${detail.url}`,
      "",
      detail.description ?? "(no description found)",
      "",
    ].join("\n")
    process.stdout.write(out)
    return 0
  }

  process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
  return 0
}
