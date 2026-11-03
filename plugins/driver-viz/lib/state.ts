// Data layer for driver-viz: locate the repo, scan .plan/<slug>/state.json, and derive
// what the flow chart renders. Pure (fs functions take explicit paths) so node --test can
// exercise it — this file must NOT import @opentui/* or solid-js.
//
// Slug rule (same as the driver): validate against the regex BEFORE any path use.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

export const SLUG_RE = /^[A-Z][A-Z0-9]*-[0-9]+$/

export type PhaseStatus = "pending" | "running" | "done" | "failed" | "skipped"

export interface PhaseEntry {
  status?: PhaseStatus
  summary?: string
  started_at?: string
  completed_at?: string
}

export interface TaskEntry {
  id: string
  title?: string
  status?: "pending" | "done" | "skipped"
  commit?: string
  audit?: "pass" | "fail" | "skipped"
  qa?: "pass" | "fail" | "skipped"
}

// Subset of .plan/<slug>/state.json the sidebar renders (schema: skills/driver-conventions/
// references/state.schema.json, which allows additionalProperties — stay tolerant).
export interface DriverState {
  issue_id?: string
  branch?: string
  plan_dir?: string
  params?: { skip?: string[]; phases?: string[] }
  phases?: Record<string, PhaseEntry>
  plan?: { tasks?: TaskEntry[] }
  implement?: { runs?: unknown[] }
  pr?: { number?: number; url?: string; draft?: boolean }
  warnings?: string[]
}

export interface RunInfo {
  slug: string
  statePath: string
  mtimeMs: number
  state: DriverState | null // null = state.json missing or unparseable (mid-write) — never throw
}

/** Walk up from `start` to the nearest directory containing .git. */
export function findRepoRoot(start: string): string | null {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Scan `<planDir>` for slug-shaped run directories and parse each state.json.
 * Returns runs sorted by most-recently-modified first. Never throws.
 */
export function scanRuns(planDir: string): RunInfo[] {
  if (!existsSync(planDir)) return []
  let entries
  try {
    entries = readdirSync(planDir, { withFileTypes: true })
  } catch {
    return []
  }
  const runs: RunInfo[] = []
  for (const e of entries) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue
    const dir = join(planDir, e.name)
    const statePath = join(dir, "state.json")
    let mtimeMs = 0
    let state: DriverState | null = null
    try {
      mtimeMs = statSync(statePath).mtimeMs
    } catch {
      try {
        mtimeMs = statSync(dir).mtimeMs // state.json not written yet — rank by dir mtime
      } catch {
        /* ignore */
      }
    }
    try {
      state = JSON.parse(readFileSync(statePath, "utf8")) as DriverState
    } catch {
      state = null
    }
    runs.push({ slug: e.name, statePath, mtimeMs, state })
  }
  return runs.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** Status of one phase; missing entry falls back to --skip, then "pending". */
export function phaseStatus(state: DriverState | null, id: string): PhaseStatus {
  const s = state?.phases?.[id]?.status
  if (s === "pending" || s === "running" || s === "done" || s === "failed" || s === "skipped") return s
  if (state?.params?.skip?.includes(id)) return "skipped"
  return "pending"
}

/** Index of the first running phase, or -1 (drives the spinner + connector animation). */
export function runningIndex(statuses: PhaseStatus[]): number {
  return statuses.indexOf("running")
}

/** Index of the first pending phase, or -1 (the "next up" marker). */
export function nextPendingIndex(statuses: PhaseStatus[]): number {
  return statuses.indexOf("pending")
}

export function taskCounts(tasks: TaskEntry[] | undefined): {
  done: number
  total: number
  skipped: number
  gateFailed: number
} {
  const list = tasks ?? []
  return {
    done: list.filter((t) => t.status === "done").length,
    total: list.length,
    skipped: list.filter((t) => t.status === "skipped").length,
    gateFailed: list.filter((t) => t.audit === "fail" || t.qa === "fail").length,
  }
}

/** The run to display: the user-selected slug when still present, else the most recent. */
export function pickRun(runs: RunInfo[], activeSlug: string | null): RunInfo | null {
  if (runs.length === 0) return null
  if (activeSlug) {
    const found = runs.find((r) => r.slug === activeSlug)
    if (found) return found
  }
  return runs.reduce((a, b) => (b.mtimeMs >= a.mtimeMs ? b : a))
}
