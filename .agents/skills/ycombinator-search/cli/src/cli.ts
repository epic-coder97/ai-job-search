#!/usr/bin/env bun
// CLI for searching jobs on Y Combinator's job board. The board renders
// client-side, so every page goes through the Firecrawl scrape API — billed
// per call, keyed by the FIRECRAWL_API_KEY environment variable.
//
// Personal use only. Keep volume low; do not use commercially or for bulk data.

import { ROLE_TAXONOMY, writeError } from "./helpers.js"
import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit", r: "remote", l: "location" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `ycombinator-cli — search YC startup jobs (via Firecrawl; requires FIRECRAWL_API_KEY)

USAGE
  bun run src/cli.ts search --query "<role>" [flags]
  bun run src/cli.ts detail <url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Role taxonomy slug source. REQUIRED. Slugged into YC's
                          role URL ("Software Engineer" -> /jobs/role/software-engineer).
                          Taxonomy (fixed): ${ROLE_TAXONOMY.join(", ")}.
                          AI/ML roles sit under software-engineer. Unknown slugs
                          return zero results.
  --remote, -r            Restrict to the role's /remote page (server-side filter).
  --location, -l <city>   Restrict to a city page (e.g. "San Francisco").
                          Cannot be combined with --remote.
  --jobage <days>         Keep results posted within N days (client-side).
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

DETAIL ARGS
  <url>                   Full job URL from search results
                          (https://www.ycombinator.com/companies/<company>/jobs/<id>-<slug>).
                          Bare ids cannot be resolved (the URL requires the company slug).

CREDENTIALS
  FIRECRAWL_API_KEY       Required. The board renders client-side; every call is a
                          billed Firecrawl scrape. Export before running.

EXAMPLES
  bun run src/cli.ts search -q "software engineer" --remote --format table
  bun run src/cli.ts search -q "product manager" --jobage 14 --limit 15
  bun run src/cli.ts search -q "designer" --location "San Francisco"
  bun run src/cli.ts detail "https://www.ycombinator.com/companies/feather-2/jobs/OGlm8aX-backend-ai-engineer" --format plain

Personal use only — keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "remote", "location", "jobage", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      writeError(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
      return 1
    }
  }

  const parseIntFlag = (name: string, raw: string): number | null => {
    const val = parseInt(raw, 10)
    if (isNaN(val)) {
      writeError(`--${name} must be a number, got "${raw}"`, "BAD_ARG")
      return null
    }
    return val
  }

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      writeError('the --query/-q flag is required (e.g. -q "software engineer"); see --help for the role taxonomy', "NO_QUERY")
      return 1
    }
    if (flags.remote && flags.location) {
      writeError("--remote and --location cannot be combined (YC's role URLs support only one suffix filter)", "CONFLICTING_FLAGS")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      writeError(`--format must be json, table, or plain, got "${fmt}"`, "BAD_ARG")
      return 1
    }

    let jobage: number | undefined
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage as string)
      if (v === null) return 1
      jobage = v
    }
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit as string)
      if (v === null) return 1
      limit = v
    }

    const opts: SearchOpts = {
      query,
      remote: flags.remote === true,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      writeError(
        "detail requires the full job URL from search results (bare ids cannot be resolved: the URL requires the company slug)",
        "NO_ID",
      )
      return 1
    }
    if (!id.startsWith("https://")) {
      writeError(
        "detail requires the full job URL from search results — bare ids cannot be resolved because the URL requires the company slug",
        "BAD_ID",
      )
      return 1
    }
    const fmt = (flags.format as string) || "json"
    if (!["json", "plain"].includes(fmt)) {
      writeError(`--format must be json or plain, got "${fmt}"`, "BAD_ARG")
      return 1
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  writeError(`Unknown command "${cmd}"`, "BAD_CMD")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
