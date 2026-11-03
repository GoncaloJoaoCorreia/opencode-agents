// Data layer for driver-viz: locate the repo, scan .plan/<slug>/state.json, and derive
// what the flow chart renders. Pure (fs functions take explicit paths) so node --test can
// exercise it — this file must NOT import @opentui/* or solid-js.
//
// Slug rule (same as the driver): validate against the regex BEFORE any path use.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { PHASES } from "./phases.ts"

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
  session_id?: string | null // OpenCode session that started the run (null on older OpenCode)
  created_at?: string // may be a literal "$(date ...)" placeholder on older drivers — parse defensively
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

/**
 * Session-scoped run filtering: when `sessionID` is a non-empty string, return only the runs
 * whose `state.session_id === sessionID`. When that yields an empty list (no run of this
 * session yet, or all runs have `session_id` null/missing — e.g. written by an older
 * driver), or when `sessionID` is null/undefined, return the input unchanged (graceful
 * fallback to the most-recent-run behavior). Pure — never throws.
 */
export function filterRunsBySession(
  runs: RunInfo[],
  sessionID: string | null | undefined,
): RunInfo[] {
  if (!sessionID) return runs
  const matching = runs.filter((r) => r.state?.session_id === sessionID)
  return matching.length > 0 ? matching : runs
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

/**
 * Parse an ISO-ish date-time string. Returns null for anything that is not a real
 * date-time — e.g. the literal "$(date -u +%Y-%m-%dT%H:%M:%SZ)" placeholder an older
 * driver writes into created_at.
 */
export function parseISODate(s: string | null | undefined): Date | null {
  if (!s || typeof s !== "string") return null
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s.trim())) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * When the run started: the earliest `phases.*.started_at` across the registry phases.
 * Falls back to `created_at` only when it parses as an ISO date-time (today it is often
 * a literal placeholder string). Null when unknown — never throws.
 */
export function runStartedAt(state: DriverState | null): Date | null {
  let earliest: Date | null = null
  for (const p of PHASES) {
    const d = parseISODate(state?.phases?.[p.id]?.started_at)
    if (d && (!earliest || d.getTime() < earliest.getTime())) earliest = d
  }
  if (earliest) return earliest
  return parseISODate(state?.created_at)
}

/** Format a duration as `45s` / `12m34s` / `1h02m03s`. Negative clamps to `0s`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const ss = String(s).padStart(2, "0")
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${ss}s`
  if (m > 0) return `${m}m${ss}s`
  return `${s}s`
}

/**
 * Total run time in ms: latest `phases.*.completed_at` minus `runStartedAt`.
 * Null when either end is unknown (run still going, unreadable state).
 */
export function runDuration(state: DriverState | null): number | null {
  const start = runStartedAt(state)
  if (!start) return null
  let last: Date | null = null
  for (const p of PHASES) {
    const d = parseISODate(state?.phases?.[p.id]?.completed_at)
    if (d && (!last || d.getTime() > last.getTime())) last = d
  }
  if (!last) return null
  return Math.max(0, last.getTime() - start.getTime())
}

/**
 * Single-running rule: with multiple running phases only the FIRST stays running and
 * later ones are demoted to pending, so at most one phase renders as in progress —
 * spec-audit only shows running for run-scoped (cycle) audit runs, not while an
 * Implement subtask holds the "running" slot.
 */
export function effectiveStatuses(statuses: PhaseStatus[]): PhaseStatus[] {
  let seenRunning = false
  return statuses.map((s) => {
    if (s === "running") {
      if (seenRunning) return "pending"
      seenRunning = true
    }
    return s
  })
}

export type TaskKind = "done" | "failed" | "skipped" | "running" | "pending"

export interface TaskIndicator {
  id: string
  kind: TaskKind
}

/**
 * Per-task display state for the Implement subtask dots: done (failed when a gate
 * verdict is fail), skipped, pending — and while Implement itself runs, the first
 * pending task is the in-progress one (`running`).
 */
export function taskIndicators(
  tasks: TaskEntry[] | undefined,
  implementRunning: boolean,
): TaskIndicator[] {
  const list = tasks ?? []
  let runningAssigned = false
  return list.map((t) => {
    let kind: TaskKind
    if (t.status === "done") {
      kind = t.audit === "fail" || t.qa === "fail" ? "failed" : "done"
    } else if (t.status === "skipped") {
      kind = "skipped"
    } else if (implementRunning && !runningAssigned) {
      kind = "running"
      runningAssigned = true
    } else {
      kind = "pending"
    }
    return { id: t.id, kind }
  })
}

/** `.plan/<slug>/plan.md` — sibling of the run's state.json. */
export function planFilePath(run: RunInfo): string {
  return join(dirname(run.statePath), "plan.md")
}

/** `.plan/<slug>/report.md` — written by the driver at cycle end (driver §7). */
export function reportFilePath(run: RunInfo): string {
  return join(dirname(run.statePath), "report.md")
}

/** True when every registry phase is done/skipped — the run completed successfully. */
export function runCompleted(statuses: PhaseStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s === "done" || s === "skipped")
}
