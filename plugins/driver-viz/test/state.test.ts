// Logic tests for driver-viz's data layer. Run: node --test test/state.test.ts
// (node >= 22.18 strips types by default; bun test works too).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  findRepoRoot,
  nextPendingIndex,
  phaseStatus,
  pickRun,
  runningIndex,
  scanRuns,
  SLUG_RE,
  taskCounts,
  type DriverState,
} from "../lib/state.ts"
import { PHASE_IDS, PHASES } from "../lib/phases.ts"

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "driver-viz-test-"))
}

test("slug regex accepts issue keys, rejects traversal and lowercase", () => {
  assert.ok(SLUG_RE.test("ABC-123"))
  assert.ok(SLUG_RE.test("ENG-1"))
  assert.ok(!SLUG_RE.test("../evil"))
  assert.ok(!SLUG_RE.test("abc-123"))
  assert.ok(!SLUG_RE.test("ABC-123/../../etc"))
  assert.ok(!SLUG_RE.test(""))
})

test("phase registry mirrors the 8 driver phases in order", () => {
  assert.deepEqual(PHASE_IDS, [
    "preplan",
    "plan",
    "implement",
    "spec-audit",
    "code-review",
    "quality-gate",
    "write-history",
    "pr",
  ])
  assert.equal(PHASES.length, 8)
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
    mkdirSync(join(plan, "not-a-slug"), { recursive: true }) // ignored
    mkdirSync(join(plan, "low-1"), { recursive: true }) // ignored (lowercase)
    writeFileSync(join(plan, "ABC-123", "state.json"), JSON.stringify({ issue_id: "ABC-123" }))
    writeFileSync(join(plan, "XYZ-9", "state.json"), "{ not json")
    // make ABC-123 older than XYZ-9
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(plan, "ABC-123", "state.json"), old, old)

    const runs = scanRuns(plan)
    assert.equal(runs.length, 2)
    assert.deepEqual(runs.map((r) => r.slug), ["XYZ-9", "ABC-123"]) // most recent first
    assert.equal(runs[0].state, null) // broken json -> null, not a throw
    assert.equal(runs[1].state?.issue_id, "ABC-123")
    assert.equal(scanRuns(join(root, ".plan-missing")).length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("phaseStatus reads state, falls back to params.skip, then pending", () => {
  const state: DriverState = {
    phases: { preplan: { status: "done" }, plan: { status: "running" }, pr: { status: "failed" } },
    params: { skip: ["write-history"] },
  }
  assert.equal(phaseStatus(state, "preplan"), "done")
  assert.equal(phaseStatus(state, "plan"), "running")
  assert.equal(phaseStatus(state, "pr"), "failed")
  assert.equal(phaseStatus(state, "write-history"), "skipped") // via params.skip
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
