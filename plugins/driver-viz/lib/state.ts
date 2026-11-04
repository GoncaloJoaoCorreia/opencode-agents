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

/** One `implement.runs[]` entry (schema allows additionalProperties — stay tolerant). */
export interface ImplementRun {
  mode?: string // "task" | "fix"
  task_id?: string
  scope?: string // fix mode: "task" | "cycle"
  fix_target?: string // fix mode: "audit" | "review" | "qa"
  round?: number
  commit?: string | null // null = fix-mode spawn still in progress (marker pushed at spawn start)
  summary?: string
  at?: string
}

/** One `audit.rounds[]` / `review.rounds[]` entry. */
export interface GateRoundEntry {
  scope?: string
  task_id?: string
  round?: number
  verdict?: string
}

/** One `*.fixes[]` entry (audit / review / qa). */
export interface GateFixEntry {
  scope?: string
  task_id?: string
  round?: number
  commit?: string
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
  implement?: { runs?: ImplementRun[] }
  audit?: { verdict?: string; rounds?: GateRoundEntry[]; fixes?: GateFixEntry[] }
  review?: { verdict?: string; rounds?: GateRoundEntry[]; fixes?: GateFixEntry[] }
  qa?: { verdict?: string; runs?: unknown[]; fixes?: GateFixEntry[] }
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

/**
 * Circular spinner for the in-progress Implement subtask dot: same one-cell silhouette
 * as ○ (pending) / ● (done), no braille codepoints. Frame 0 (◐) doubles as the
 * animate-off fallback. The phase-level running glyph keeps the braille spinner.
 */
export const TASK_DOT_SPINNER = ["◐", "◓", "◑", "◒"]

/**
 * Whether the Implement subtask dots row and the done/total counter render at all:
 * hidden when the plan has zero or one task (single-task runs show neither — the
 * counter would always read 0/1 or 1/1), shown for two or more tasks.
 */
export function subtaskRowVisible(tasks: TaskEntry[] | undefined): boolean {
  return (tasks?.length ?? 0) > 1
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

/** The three gate phases a cycle-scope fix round can belong to. */
export type GateId = "spec-audit" | "code-review" | "quality-gate"

export interface FixRoundInfo {
  gate: GateId
  round: number
  status: "running" | "landed" // running = fix spawn in progress (no commit yet); landed = fix committed, gate re-run pending
}

/** fix_target → owning gate phase (driver-conventions §1 fix lists). */
const FIX_TARGET_GATES: Record<string, GateId> = {
  audit: "spec-audit",
  review: "code-review",
  qa: "quality-gate",
}

/** Fixes of a gate that belong to the cycle scope (task-scope repairs are ignored). */
function cycleFixes(fixes: GateFixEntry[] | undefined): GateFixEntry[] {
  return (fixes ?? []).filter((f) => f?.scope !== "task")
}

function maxRound(entries: { round?: number }[]): number {
  let m = 0
  for (const e of entries) if (typeof e?.round === "number" && e.round > m) m = e.round
  return m
}

/**
 * The cycle-scope fix round currently in progress (G-27), or null. Pure — never throws.
 *
 * Primary signal (explicit marker): the last `implement.runs[]` entry with
 * `mode === "fix"` and `scope === "cycle"` — pushed at fix-spawn start with
 * `commit: null` and filled after the commit. `commit` null/missing → "running",
 * commit present → "landed"; `fix_target` maps to the owning gate phase. A
 * `commit: null` entry is stale once any later `runs[]` entry carries a commit
 * (crashed spawn) — it is skipped and the scan continues backwards.
 *
 * Fallback (legacy states whose driver only appended `runs[]` at the end): for each
 * gate, the latest cycle-scope round with verdict `fail` and no matching `fixes[]`
 * entry yet → "running"; a matching cycle fix for that round but no later round →
 * "landed". Sources: `audit.rounds[]` + `audit.fixes[]`, `review.rounds[]` +
 * `review.fixes[]`, and `state.qa.verdict === "fail"` + `qa.fixes[]` (the cycle-scope
 * qa verdict lives at the top level; qa has no rounds[], so the latest qa round is
 * the highest fixed round — a fix entry implies its round failed — while the
 * verdict still reads fail and no later round is recorded).
 *
 * Suppressed when the state is null/unreadable, when the run is completed, and for
 * task-scope fixes (scope "task" is ignored — during the implement fan-out the
 * Implement phase already shows running and the failed task dot shows ✗).
 */
export function fixRound(state: DriverState | null): FixRoundInfo | null {
  if (!state) return null
  if (runCompleted(PHASES.map((p) => phaseStatus(state, p.id)))) return null

  // Primary: the explicit in-progress marker in implement.runs[].
  const runs = state.implement?.runs ?? []
  for (let i = runs.length - 1; i >= 0; i--) {
    const entry = runs[i]
    if (!entry || entry.mode !== "fix" || entry.scope !== "cycle") continue
    if (entry.commit == null && runs.slice(i + 1).some((r) => r?.commit != null)) continue // stale marker
    const gate = FIX_TARGET_GATES[entry.fix_target ?? ""]
    if (!gate) continue
    const round = typeof entry.round === "number" ? entry.round : 1
    return { gate, round, status: entry.commit == null ? "running" : "landed" }
  }

  // Fallback: derive from the gate round/fix lists (legacy states, no marker).
  const candidates: FixRoundInfo[] = []
  const auditRounds = (state.audit?.rounds ?? []).filter((r) => r?.scope !== "task")
  if (auditRounds.length > 0) {
    const last = auditRounds[auditRounds.length - 1]
    if (last?.verdict === "fail") {
      const round = typeof last.round === "number" ? last.round : auditRounds.length
      const landed = cycleFixes(state.audit?.fixes).some((f) => f?.round === round)
      candidates.push({ gate: "spec-audit", round, status: landed ? "landed" : "running" })
    }
  } else if (state.audit?.verdict === "fail") {
    candidates.push({ gate: "spec-audit", round: maxRound(cycleFixes(state.audit?.fixes)) + 1, status: "running" })
  }
  const reviewRounds = (state.review?.rounds ?? []).filter((r) => r?.scope !== "task")
  if (reviewRounds.length > 0) {
    const last = reviewRounds[reviewRounds.length - 1]
    if (last?.verdict === "fail") {
      const round = typeof last.round === "number" ? last.round : reviewRounds.length
      const landed = cycleFixes(state.review?.fixes).some((f) => f?.round === round)
      candidates.push({ gate: "code-review", round, status: landed ? "landed" : "running" })
    }
  } else if (state.review?.verdict === "fail") {
    candidates.push({ gate: "code-review", round: maxRound(cycleFixes(state.review?.fixes)) + 1, status: "running" })
  }
  if (state.qa?.verdict === "fail") {
    const m = maxRound(cycleFixes(state.qa?.fixes))
    candidates.push(
      m > 0
        ? { gate: "quality-gate", round: m, status: "landed" } // fix committed, gate re-run pending
        : { gate: "quality-gate", round: 1, status: "running" },
    )
  }
  if (candidates.length === 0) return null
  // Highest round wins; ties keep registry order (spec-audit before code-review before qa).
  let best = candidates[0]
  for (const c of candidates.slice(1)) if (c.round > best.round) best = c
  return best
}
