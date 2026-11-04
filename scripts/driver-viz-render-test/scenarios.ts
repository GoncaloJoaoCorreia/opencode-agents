// Fixed fixtures for the driver-viz render snapshot tests. Everything here is
// deterministic: fixed timestamps (run.ts freezes Date.now to FIXED_NOW), fixed
// mtimes, and run dirs created OUTSIDE any git repo so the +A/-D effect resolves
// to null instead of running git diff against whatever branch is checked out.
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { RunInfo } from "../../plugins/driver-viz/lib/state.ts"

export const FIXED_NOW = Date.parse("2026-11-03T12:00:00.000Z")
// started_at values are offsets from FIXED_NOW so the ⏱/Total lines are stable
const at = (minAgo: number) => new Date(FIXED_NOW - minAgo * 60_000).toISOString()

export interface Scenario {
  name: string
  /** create the run dir(s) under `dir`; return the runs to render */
  setup: (dir: string) => RunInfo[]
  animate?: boolean
  sessionID?: string | null
  theme?: Record<string, unknown>
  sessionRecord?: unknown
}

function run(dir: string, slug: string, mtimeMs: number, state: unknown, extra?: (d: string) => void): RunInfo {
  const d = join(dir, slug)
  mkdirSync(d, { recursive: true })
  extra?.(d)
  return { slug, statePath: join(d, "state.json"), mtimeMs, state: state as RunInfo["state"] }
}

export const scenarios: Scenario[] = [
  {
    name: "mid-run",
    // plan done → "[Open Plan]" visible (the nested-<text> crash regression),
    // implement running with done/pending/skipped/gate-failed tasks, 2 runs → "1/2"
    setup: (dir) => [
      run(dir, "TEST-1", 2000, {
        session_id: "ses_test",
        branch: "feat/TEST-1",
        created_at: at(30),
        phases: {
          preplan: { status: "done", started_at: at(30), completed_at: at(28) },
          plan: { status: "done", started_at: at(28), completed_at: at(25) },
          implement: { status: "running", started_at: at(25) },
        },
        plan: {
          tasks: [
            { id: "t1", status: "done" },
            { id: "t2", status: "pending" },
            { id: "t3", status: "skipped" },
            { id: "t4", status: "done", audit: "fail" },
          ],
        },
      }),
      // parseable same-session state so the two-run "1/2" position counter stays covered
      // (a state-null run would now be filtered out by the strict session filter)
      run(dir, "TEST-2", 1000, { session_id: "ses_test" }),
    ],
  },
  {
    name: "completed",
    // all phases done → completion block: separator, Total, Tokens, [Open report]
    setup: (dir) => [
      run(
        dir,
        "TEST-1",
        2000,
        {
          session_id: "ses_test",
          branch: "feat/TEST-1",
          created_at: at(60),
          phases: Object.fromEntries(
            ["preplan", "plan", "implement", "spec-audit", "code-review", "quality-gate", "pr"].map(
              (p, i) => [p, { status: "done", started_at: at(60 - i * 5), completed_at: at(55 - i * 5) }],
            ),
          ),
          plan: { tasks: [{ id: "t1", status: "done" }, { id: "t2", status: "done" }] },
          pr: { number: 42, url: "https://example.com/pr/42" },
        },
        (d) => writeFileSync(join(d, "report.md"), "# report\n"),
      ),
    ],
    sessionRecord: { tokens: { total: 128_431 } },
  },
  {
    name: "unreadable-state",
    // state.json missing/unparseable (state null) -> no session_id -> strict filter drops
    // the run -> empty frame (section hidden until the file parses)
    setup: (dir) => [run(dir, "TEST-1", 1000, null)],
  },
  {
    name: "no-matching-run",
    // G-32: runs belong to another session (ses_other) while the scenario session is
    // ses_test -> strict filter yields no runs -> empty frame (section hidden)
    setup: (dir) => [
      run(dir, "TEST-1", 1000, {
        session_id: "ses_other",
        branch: "feat/TEST-1",
        phases: { preplan: { status: "running", started_at: at(3) } },
      }),
    ],
  },
  {
    name: "skipped-and-failed",
    // params.skip phases render ⊘, pr failed renders ✗, no branch
    setup: (dir) => [
      run(dir, "TEST-1", 1000, {
        session_id: "ses_test",
        params: { skip: ["code-review", "quality-gate"] },
        phases: {
          preplan: { status: "done", started_at: at(10), completed_at: at(9) },
          plan: { status: "done", started_at: at(9), completed_at: at(8) },
          implement: { status: "done", started_at: at(8), completed_at: at(5) },
          "spec-audit": { status: "done", started_at: at(5), completed_at: at(4) },
          pr: { status: "failed", started_at: at(4), completed_at: at(2) },
        },
        plan: { tasks: [{ id: "t1", status: "done", qa: "fail" }] },
      }),
    ],
  },
  {
    name: "task-overflow",
    // 20 pending tasks → 16 dots + "…"
    setup: (dir) => [
      run(dir, "TEST-1", 1000, {
        session_id: "ses_test",
        phases: {
          preplan: { status: "done", started_at: at(10), completed_at: at(9) },
          plan: { status: "done", started_at: at(9), completed_at: at(8) },
          implement: { status: "running", started_at: at(8) },
        },
        plan: { tasks: Array.from({ length: 20 }, (_, i) => ({ id: `t${i + 1}`, status: "pending" })) },
      }),
    ],
  },
  {
    name: "single-task",
    // exactly one plan task → no dots row and no done/total counter (subtaskRowVisible),
    // in every implement status; implement running here, phase glyph stays braille ⠋ at tick 0
    setup: (dir) => [
      run(dir, "TEST-1", 1000, {
        session_id: "ses_test",
        phases: {
          preplan: { status: "done", started_at: at(10), completed_at: at(9) },
          plan: { status: "done", started_at: at(9), completed_at: at(8) },
          implement: { status: "running", started_at: at(8) },
        },
        plan: { tasks: [{ id: "t1", status: "pending" }] },
      }),
    ],
  },
  {
    name: "partial-theme",
    // custom theme missing feedback tokens — the historical palette crash; must not throw
    theme: { text: { base: "#e6edf3", muted: "#8b949e" } },
    setup: (dir) => [
      run(dir, "TEST-1", 1000, {
        session_id: "ses_test",
        branch: "feat/TEST-1",
        phases: { preplan: { status: "running", started_at: at(3) } },
      }),
    ],
  },
  {
    name: "animate-off",
    animate: false, // running phase renders ◐ instead of the spinner
    setup: (dir) => [
      run(dir, "TEST-1", 1000, {
        session_id: "ses_test",
        phases: { preplan: { status: "running", started_at: at(3) } },
      }),
    ],
  },
  {
    name: "fix-round",
    // G-27: cycle-scope fix round in progress — spec-audit cycle round 1 failed and
    // the fix-mode implement spawn pushed its marker (implement.runs[] entry with
    // commit: null). No registry phase is running, so the Audit phase is promoted to
    // running (spinner + ⏱ header) and a plugin-only "⠋ Fix r1" row renders under it.
    setup: (dir) => [
      run(dir, "TEST-1", 1000, {
        session_id: "ses_test",
        branch: "feat/TEST-1",
        created_at: at(20),
        phases: {
          preplan: { status: "done", started_at: at(20), completed_at: at(19) },
          plan: { status: "done", started_at: at(19), completed_at: at(18) },
          implement: { status: "done", started_at: at(18), completed_at: at(10) },
          "spec-audit": { status: "done", started_at: at(10), completed_at: at(8) },
        },
        plan: { tasks: [{ id: "t1", status: "done" }] },
        implement: {
          runs: [
            { mode: "task", task_id: "t1", commit: "aaaaaaa1111", at: at(10) },
            { mode: "fix", scope: "cycle", fix_target: "audit", round: 1, commit: null, at: at(2) },
          ],
        },
        audit: { rounds: [{ scope: "cycle", round: 1, verdict: "fail" }] },
      }),
    ],
  },
]

export function prepareScenarioDir(base: string, name: string): string {
  const dir = join(base, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}
