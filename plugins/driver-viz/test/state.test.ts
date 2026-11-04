// Logic tests for driver-viz's data layer. Run: node --test test/state.test.ts
// (node >= 22.18 strips types by default; bun test works too).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  effectiveStatuses,
  filterRunsBySession,
  findRepoRoot,
  formatElapsed,
  nextPendingIndex,
  parseISODate,
  phaseStatus,
  pickRun,
  planFilePath,
  reportFilePath,
  runCompleted,
  runDuration,
  runningIndex,
  runStartedAt,
  scanRuns,
  SLUG_RE,
  taskCounts,
  taskIndicators,
  type DriverState,
  type RunInfo,
  type TaskEntry,
} from "../lib/state.ts"
import { PHASE_IDS, PHASES } from "../lib/phases.ts"
import { palette } from "../lib/theme.ts"

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "driver-viz-test-"))
}

test("slug regex accepts issue keys, rejects traversal and lowercase", () => {
  assert.ok(SLUG_RE.test("ABC-123"))
  assert.ok(SLUG_RE.test("ENG-1"))
  assert.ok(SLUG_RE.test("G-17")) // single-letter Linear team key
  assert.ok(!SLUG_RE.test("../evil"))
  assert.ok(!SLUG_RE.test("abc-123"))
  assert.ok(!SLUG_RE.test("ABC-123/../../etc"))
  assert.ok(!SLUG_RE.test(""))
})

test("phase registry mirrors the 7 driver phases in order", () => {
  assert.deepEqual(PHASE_IDS, [
    "preplan",
    "plan",
    "implement",
    "spec-audit",
    "code-review",
    "quality-gate",
    "pr",
  ])
  assert.equal(PHASES.length, 7)
})

test("findRepoRoot walks up to the nearest .git", () => {
  const root = tmp()
  try {
    mkdirSync(join(root, ".git"))
    mkdirSync(join(root, "a/b"), { recursive: true })
    assert.equal(findRepoRoot(join(root, "a/b")), root)
    assert.equal(findRepoRoot(root), root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const noGit = tmp()
  try {
    assert.equal(findRepoRoot(join(noGit, "sub")), null) // no .git anywhere above tmpdir
  } finally {
    rmSync(noGit, { recursive: true, force: true })
  }
})

test("scanRuns keeps only slug dirs, tolerates broken json, sorts by mtime desc", () => {
  const root = tmp()
  try {
    const plan = join(root, ".plan")
    mkdirSync(join(plan, "ABC-123"), { recursive: true })
    mkdirSync(join(plan, "XYZ-9"), { recursive: true })
    mkdirSync(join(plan, "G-17"), { recursive: true }) // single-letter team key — accepted
    mkdirSync(join(plan, "not-a-slug"), { recursive: true }) // ignored
    mkdirSync(join(plan, "low-1"), { recursive: true }) // ignored (lowercase)
    writeFileSync(join(plan, "ABC-123", "state.json"), JSON.stringify({ issue_id: "ABC-123" }))
    writeFileSync(join(plan, "XYZ-9", "state.json"), "{ not json")
    writeFileSync(join(plan, "G-17", "state.json"), JSON.stringify({ issue_id: "G-17" }))
    // make ABC-123 older than XYZ-9
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(plan, "ABC-123", "state.json"), old, old)

    const runs = scanRuns(plan)
    assert.equal(runs.length, 3)
    assert.deepEqual(runs.map((r) => r.slug), ["G-17", "XYZ-9", "ABC-123"]) // most recent first
    assert.equal(runs[0].state?.issue_id, "G-17")
    assert.equal(runs[1].state, null) // broken json -> null, not a throw
    assert.equal(runs[2].state?.issue_id, "ABC-123")
    assert.equal(scanRuns(join(root, ".plan-missing")).length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("phaseStatus reads state, falls back to params.skip, then pending", () => {
  const state: DriverState = {
    phases: { preplan: { status: "done" }, plan: { status: "running" }, pr: { status: "failed" } },
    params: { skip: ["quality-gate"] },
  }
  assert.equal(phaseStatus(state, "preplan"), "done")
  assert.equal(phaseStatus(state, "plan"), "running")
  assert.equal(phaseStatus(state, "pr"), "failed")
  assert.equal(phaseStatus(state, "quality-gate"), "skipped") // via params.skip
  assert.equal(phaseStatus(state, "implement"), "pending")
  assert.equal(phaseStatus(null, "plan"), "pending") // unreadable state
})

test("runningIndex / nextPendingIndex locate the animated edge", () => {
  assert.equal(runningIndex(["done", "running", "pending"]), 1)
  assert.equal(runningIndex(["done", "done"]), -1)
  assert.equal(nextPendingIndex(["done", "running", "pending"]), 2)
  assert.equal(nextPendingIndex(["done", "skipped", "done"]), -1)
})

test("taskCounts summarises plan tasks incl. gate failures", () => {
  const counts = taskCounts([
    { id: "a", status: "done", audit: "pass", qa: "pass" },
    { id: "b", status: "done", audit: "fail", qa: "pass" },
    { id: "c", status: "pending" },
    { id: "d", status: "skipped" },
  ])
  assert.deepEqual(counts, { done: 2, total: 4, skipped: 1, gateFailed: 1 })
  assert.deepEqual(taskCounts(undefined), { done: 0, total: 0, skipped: 0, gateFailed: 0 })
})

test("pickRun prefers the selected slug, else the most recent, else null", () => {
  const root = tmp()
  try {
    const plan = join(root, ".plan")
    mkdirSync(join(plan, "AAA-1"), { recursive: true })
    mkdirSync(join(plan, "BBB-2"), { recursive: true })
    writeFileSync(join(plan, "AAA-1", "state.json"), "{}")
    writeFileSync(join(plan, "BBB-2", "state.json"), "{}")
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(plan, "AAA-1", "state.json"), old, old)
    const runs = scanRuns(plan)

    assert.equal(pickRun(runs, null)?.slug, "BBB-2") // most recent
    assert.equal(pickRun(runs, "AAA-1")?.slug, "AAA-1") // explicit selection wins
    assert.equal(pickRun(runs, "GONE-1")?.slug, "BBB-2") // stale selection falls back
    assert.equal(pickRun([], null), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function run(slug: string, session_id: string | null | undefined, mtimeMs = 0): RunInfo {
  return { slug, statePath: `/x/.plan/${slug}/state.json`, mtimeMs, state: { issue_id: slug, session_id } }
}

test("filterRunsBySession returns only the runs of the given session", () => {
  const runs = [run("AAA-1", "ses_A", 3), run("BBB-2", "ses_B", 2), run("CCC-3", "ses_A", 1)]
  const out = filterRunsBySession(runs, "ses_A")
  assert.deepEqual(out.map((r) => r.slug), ["AAA-1", "CCC-3"])
})

test("filterRunsBySession: no match -> input unchanged (graceful fallback)", () => {
  const runs = [run("AAA-1", "ses_A"), run("BBB-2", "ses_B")]
  assert.equal(filterRunsBySession(runs, "ses_Z"), runs)
})

test("filterRunsBySession: all runs session_id null -> input unchanged", () => {
  const runs = [run("AAA-1", null), run("BBB-2", null)]
  assert.equal(filterRunsBySession(runs, "ses_A"), runs)
})

test("filterRunsBySession: null/undefined/empty sessionID -> input unchanged", () => {
  const runs = [run("AAA-1", "ses_A"), run("BBB-2", "ses_B")]
  assert.equal(filterRunsBySession(runs, null), runs)
  assert.equal(filterRunsBySession(runs, undefined), runs)
  assert.equal(filterRunsBySession(runs, ""), runs)
})

test("filterRunsBySession: empty runs -> empty", () => {
  assert.deepEqual(filterRunsBySession([], "ses_A"), [])
})

test("filterRunsBySession: mid-write run (state null) does not match until it parses", () => {
  const midWrite: RunInfo = { slug: "NEW-1", statePath: "/x/.plan/NEW-1/state.json", mtimeMs: 9, state: null }
  const runs = [midWrite, run("AAA-1", "ses_A")]
  assert.equal(filterRunsBySession(runs, "ses_A").length, 1)
  midWrite.state = { issue_id: "NEW-1", session_id: "ses_A" }
  assert.deepEqual(filterRunsBySession(runs, "ses_A").map((r) => r.slug), ["NEW-1", "AAA-1"])
})

test("scan + filter integration: two slug dirs with different session_ids", () => {
  const root = tmp()
  try {
    const plan = join(root, ".plan")
    mkdirSync(join(plan, "AAA-1"), { recursive: true })
    mkdirSync(join(plan, "BBB-2"), { recursive: true })
    writeFileSync(join(plan, "AAA-1", "state.json"), JSON.stringify({ issue_id: "AAA-1", session_id: "ses_A" }))
    writeFileSync(join(plan, "BBB-2", "state.json"), JSON.stringify({ issue_id: "BBB-2", session_id: "ses_B" }))
    const runs = scanRuns(plan)
    assert.equal(runs.length, 2)
    assert.deepEqual(filterRunsBySession(runs, "ses_A").map((r) => r.slug), ["AAA-1"])
    assert.deepEqual(filterRunsBySession(runs, "ses_B").map((r) => r.slug), ["BBB-2"])
    assert.equal(filterRunsBySession(runs, null), runs) // null sessionID -> both
    assert.equal(filterRunsBySession(runs, "ses_Z"), runs) // no match -> both (fallback)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("effectiveStatuses keeps only the first running phase, demotes later ones to pending", () => {
  assert.deepEqual(effectiveStatuses(["done", "running", "running", "pending"]), [
    "done",
    "running",
    "pending",
    "pending",
  ])
  assert.deepEqual(effectiveStatuses(["running", "running"]), ["running", "pending"])
  assert.deepEqual(effectiveStatuses(["done", "running", "done"]), ["done", "running", "done"])
  assert.deepEqual(effectiveStatuses(["done", "pending", "failed"]), ["done", "pending", "failed"])
  // Audit fix: while implement runs, a second running phase (spec-audit) shows pending
  const implFirst = effectiveStatuses(["done", "done", "running", "running", "pending", "pending", "pending"])
  assert.equal(implFirst[2], "running")
  assert.equal(implFirst[3], "pending")
})

test("parseISODate accepts ISO date-times, rejects placeholders", () => {
  assert.equal(parseISODate("2026-11-03T09:30:00Z")?.toISOString(), "2026-11-03T09:30:00.000Z")
  assert.equal(parseISODate("2026-11-03 09:30:00")?.getTime(), new Date("2026-11-03 09:30:00").getTime())
  assert.equal(parseISODate("$(date -u +%Y-%m-%dT%H:%M:%SZ)"), null) // literal placeholder
  assert.equal(parseISODate("not a date"), null)
  assert.equal(parseISODate(""), null)
  assert.equal(parseISODate(null), null)
  assert.equal(parseISODate(undefined), null)
})

test("runStartedAt: earliest phases.*.started_at, ISO created_at fallback, placeholder ignored", () => {
  const state: DriverState = {
    created_at: "$(date -u +%Y-%m-%dT%H:%M:%SZ)", // literal placeholder on older drivers
    phases: {
      preplan: { status: "done", started_at: "2026-11-03T10:00:00Z" },
      plan: { status: "done", started_at: "2026-11-03T09:30:00Z" },
    },
  }
  assert.equal(runStartedAt(state)?.toISOString(), "2026-11-03T09:30:00.000Z")
  assert.equal(runStartedAt({ created_at: "2026-11-03T08:00:00Z" })?.toISOString(), "2026-11-03T08:00:00.000Z")
  assert.equal(runStartedAt({ created_at: "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }), null)
  assert.equal(runStartedAt({ phases: { preplan: { status: "running", started_at: "garbage" } } }), null)
  assert.equal(runStartedAt(null), null)
  assert.equal(runStartedAt({}), null)
})

test("formatElapsed renders 45s / 12m34s / 1h02m03s", () => {
  assert.equal(formatElapsed(45_000), "45s")
  assert.equal(formatElapsed(59_999), "59s")
  assert.equal(formatElapsed(60_000), "1m00s")
  assert.equal(formatElapsed(754_000), "12m34s")
  assert.equal(formatElapsed(3_723_000), "1h02m03s")
  assert.equal(formatElapsed(0), "0s")
  assert.equal(formatElapsed(-5_000), "0s") // clamped
})

test("runDuration = latest completed_at minus runStartedAt; null while unknown", () => {
  const state: DriverState = {
    phases: {
      preplan: { status: "done", started_at: "2026-11-03T10:00:00Z", completed_at: "2026-11-03T10:05:00Z" },
      pr: { status: "done", started_at: "2026-11-03T11:00:00Z", completed_at: "2026-11-03T11:12:34Z" },
    },
  }
  assert.equal(runDuration(state), 4_354_000) // 10:00:00 -> 11:12:34 = 1h12m34s
  assert.equal(runDuration({ phases: { preplan: { status: "running", started_at: "2026-11-03T10:00:00Z" } } }), null)
  assert.equal(runDuration(null), null)
})

test("taskIndicators: done/failed/skipped/pending plus the in-progress task while implement runs", () => {
  const tasks: TaskEntry[] = [
    { id: "a", status: "done", audit: "pass", qa: "pass" },
    { id: "b", status: "done", audit: "fail", qa: "pass" },
    { id: "c", status: "pending" },
    { id: "d", status: "pending" },
    { id: "e", status: "skipped" },
  ]
  assert.deepEqual(taskIndicators(tasks, true), [
    { id: "a", kind: "done" },
    { id: "b", kind: "failed" },
    { id: "c", kind: "running" }, // first pending task while implement runs
    { id: "d", kind: "pending" },
    { id: "e", kind: "skipped" },
  ])
  assert.deepEqual(taskIndicators(tasks, false).map((t) => t.kind), [
    "done",
    "failed",
    "pending",
    "pending",
    "skipped",
  ])
  assert.deepEqual(taskIndicators([{ id: "x", status: "done", qa: "fail" }], true), [
    { id: "x", kind: "failed" },
  ])
  assert.deepEqual(taskIndicators(undefined, true), [])
})

test("planFilePath / reportFilePath are siblings of the run's state.json", () => {
  const r: RunInfo = { slug: "G-21", statePath: "/repo/.plan/G-21/state.json", mtimeMs: 0, state: null }
  assert.equal(planFilePath(r), "/repo/.plan/G-21/plan.md")
  assert.equal(reportFilePath(r), "/repo/.plan/G-21/report.md")
})

test("runCompleted only when every phase is done/skipped", () => {
  assert.equal(runCompleted(["done", "skipped", "done", "done", "done", "done", "done"]), true)
  assert.equal(runCompleted(["done", "running", "done", "done", "done", "done", "done"]), false)
  assert.equal(runCompleted(["done", "pending", "done", "done", "done", "done", "done"]), false)
  assert.equal(runCompleted(["done", "failed", "done", "done", "done", "done", "done"]), false)
  assert.equal(runCompleted([]), false)
})

test("theme spinner is a guaranteed non-white color", () => {
  const white = palette({ text: { action: { primary: { base: "#ffffff" } }, base: "#ffffff" } })
  assert.notEqual(String(white.spinner).toLowerCase(), "#ffffff")
  assert.match(String(white.spinner), /^#[0-9a-f]{6}$/i)
  assert.equal(palette({ text: { action: { primary: { base: "#fff" } } } }).spinner, "#58a6ff")
  assert.equal(palette({ text: { action: { primary: { base: "#F8F8F8" } } } }).spinner, "#58a6ff")
  assert.equal(palette({ text: { action: { primary: { base: "#fefefe" } } } }).spinner, "#58a6ff")
  const normal = palette({ text: { action: { primary: { base: "#ff8800" } } } })
  assert.equal(normal.spinner, "#ff8800") // non-white accent passes through
  assert.equal(palette({}).spinner, "#58a6ff") // default accent is already non-white
})
