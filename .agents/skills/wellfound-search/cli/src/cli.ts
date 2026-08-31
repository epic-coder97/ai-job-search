#!/usr/bin/env bun
// CLI for searching startup jobs on Wellfound. Wellfound sits behind Cloudflare
// Turnstile, so every fetch goes through the Firecrawl scrape API — billed per
// call, keyed by the FIRECRAWL_API_KEY environment variable.
//
// Personal use only. Automated access is against Wellfound's Terms of Service;
// keep volume low and do not use it commercially or for bulk data collection.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit", r: "remote" }
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

const HELP = `wellfound-cli — search startup jobs on Wellfound (via Firecrawl; requires FIRECRAWL_API_KEY)

USAGE
  bun run src/cli.ts search --query "<role>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>    Role to search. REQUIRED. Slugged into Wellfound's role URL
                        ("AI Engineer" -> /role/r/ai-engineer). Use role names, not free text.
  --remote, -r <mode>   remote | any (default any). "remote" adds the ?remote=true filter.
  --jobage <days>       Keep results posted within N days (client-side on parsed dates).
  --page <n>            1-indexed page (~30 cards/page).
  --limit, -n <n>       Cap results emitted (client-side).
  --format <fmt>        json (default) | table | plain.

DETAIL ARGS
  <id|url>              Full URL (https://wellfound.com/jobs/<id>-<slug>) or bare numeric id.

CREDENTIALS
  FIRECRAWL_API_KEY     Required. Wellfound is Cloudflare-protected; every fetch is a
                        billed Firecrawl call. Export before running.

EXAMPLES
  bun run src/cli.ts search -q "ai engineer" --remote remote --jobage 14 --format table
  bun run src/cli.ts search -q "machine learning engineer" --page 2 --limit 20
  bun run src/cli.ts search -q "data scientist" --remote remote --limit 10 --format table
  bun run src/cli.ts detail https://wellfound.com/jobs/4574038-ai-engineer --format plain

Personal use only — uses Wellfound's public pages via Firecrawl; keep volume low (Wellfound ToS).
`

// Long-form flag names each command accepts. "help"/"h" pass so `search --help`
// still prints usage. Unknown flags exit 1 — a discarded filter silently changes
// what the search returns.
const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "remote", "jobage", "page", "limit", "format", "help", "h"]),
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
      writeError('the --query/-q flag is required (e.g. -q "ai engineer")', "NO_QUERY")
      return 1
    }
    const remoteRaw = typeof flags.remote === "string" ? flags.remote.toLowerCase() : "any"
    if (remoteRaw !== "remote" && remoteRaw !== "any") {
      writeError(`--remote must be "remote" or "any", got "${flags.remote}"`, "BAD_ARG")
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
    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page as string)
      if (v === null) return 1
      page = Math.max(1, v)
    }
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit as string)
      if (v === null) return 1
      limit = v
    }

    const opts: SearchOpts = {
      query,
      remote: remoteRaw as "remote" | "any",
      jobage,
      page,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      writeError("detail requires an <id|url>", "NO_ID")
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
