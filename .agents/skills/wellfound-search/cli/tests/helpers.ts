// Test utilities: run the CLI as a subprocess and parse its JSON output.
// Mirrors the contract used by the other portal-skill tests (jobindex-search).

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function runCLI(args: string[], env?: Record<string, string | undefined>): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

export function parseJSON<T = unknown>(raw: string): T {
  return JSON.parse(raw) as T
}
