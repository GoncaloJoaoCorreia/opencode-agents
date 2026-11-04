// The sidebar flow chart. Renders one vertical stepper per driver run:
//   ◆ DRIVER ABC-123  ⏱ 12m34s  1/2
//   ✓ Preplan
//   ✓ Plan   [Open Plan]   <- clickable once the plan phase is done
//   ┃ Implement  3/7
//     ●●◐○○○               <- per-task dots, colored by state, animated while running
//   ○ Audit
//   ...
//   ──────────────
//   Total 1h02m03s  Tokens 128k  +412 -37  [Open report]   <- completion block
// Statuses come from .plan/<slug>/state.json (phases.<id>.status); with multiple running
// phases only the first renders as running (effectiveStatuses).
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname } from "node:path"
import { createEffect, createSignal, For, Show, type Accessor } from "solid-js"
import { PHASES } from "./phases.ts"
import {
  effectiveStatuses,
  findRepoRoot,
  formatElapsed,
  nextPendingIndex,
  phaseStatus,
  pickRun,
  planFilePath,
  reportFilePath,
  runCompleted,
  runDuration,
  runStartedAt,
  runningIndex,
  subtaskRowVisible,
  TASK_DOT_SPINNER,
  taskCounts,
  taskIndicators,
  type PhaseStatus,
  type RunInfo,
  type TaskKind,
} from "./state.ts"
import { palette, type Palette } from "./theme.ts"

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const MAX_TASK_DOTS = 16

// Plugin context is typed by the host; keep it loose so the plugin never crashes on
// minor API drift between OpenCode releases.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

function glyphFor(status: PhaseStatus, isNext: boolean, animate: boolean, tick: number): string {
  switch (status) {
    case "done":
      return "✓"
    case "failed":
      return "✗"
    case "skipped":
      return "⊘"
    case "running":
      return animate ? SPINNER[tick % SPINNER.length] : "◐"
    default:
      return isNext && animate ? "▸" : "○"
  }
}

function dotGlyph(kind: TaskKind, animate: boolean, tick: number): string {
  switch (kind) {
    case "done":
      return "●"
    case "failed":
      return "✗"
    case "skipped":
      return "⊘"
    case "running":
      // circular dot spinner (one cell, pairs with ○/●); animate-off = frame 0 ◐
      return animate ? TASK_DOT_SPINNER[tick % TASK_DOT_SPINNER.length] : TASK_DOT_SPINNER[0]
    default:
      return "○"
  }
}

/** Best-effort token total from the session record; null when the host exposes none. */
function tokenTotal(context: Ctx, sessionID: string | null): number | null {
  try {
    if (!sessionID) return null
    const sess = context?.data?.session?.get?.(sessionID)
    const t = sess?.tokens ?? sess?.usage
    if (t && typeof t === "object") {
      const total = Number(t.total ?? (Number(t.input ?? 0) + Number(t.output ?? 0)))
      if (Number.isFinite(total) && total > 0) return total
    }
  } catch {
    /* host API drift — omit the line */
  }
  return null
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

interface LinesChanged {
  added: number
  deleted: number
}

/** Sum `git diff --numstat <merge-base>...HEAD`; null on any git failure. */
function computeLinesChanged(repoRoot: string): Promise<LinesChanged | null> {
  const bases = ["origin/main", "origin/master", "main", "master"]
  const tryBase = (i: number): Promise<LinesChanged | null> => {
    if (i >= bases.length) return Promise.resolve(null)
    return new Promise((resolve) => {
      execFile("git", ["merge-base", bases[i], "HEAD"], { cwd: repoRoot }, (err, out) => {
        if (err) {
          resolve(tryBase(i + 1))
          return
        }
        const base = out.trim().split("\n")[0]
        execFile("git", ["diff", "--numstat", `${base}...HEAD`], { cwd: repoRoot }, (err2, out2) => {
          if (err2) {
            resolve(null)
            return
          }
          let added = 0
          let deleted = 0
          for (const line of out2.split("\n")) {
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 2) {
              added += Number(parts[0]) || 0
              deleted += Number(parts[1]) || 0
            }
          }
          resolve({ added, deleted })
        })
      })
    })
  }
  return tryBase(0)
}

export function DriverSection(props: {
  context: Ctx
  runs: Accessor<RunInfo[]>
  activeSlug: Accessor<string | null>
  tick: Accessor<number>
  animate: boolean
  sessionID: Accessor<string | null>
  onOpenPath: (path: string) => void
}) {
  const c = (): Palette => palette((props.context.theme ?? {}) as Record<string, unknown>)
  const run = () => pickRun(props.runs(), props.activeSlug())
  // Single-running rule: at most one phase renders as running (Audit fix — spec-audit
  // only shows running for run-scoped audit runs, not during Implement subtasks).
  const statuses = (): PhaseStatus[] =>
    effectiveStatuses(PHASES.map((p) => phaseStatus(run()?.state ?? null, p.id)))
  const running = () => runningIndex(statuses())
  const nextPending = () => nextPendingIndex(statuses())
  const startedAt = () => runStartedAt(run()?.state ?? null)
  const elapsedMs = (): number | null => {
    const s = startedAt()
    return s ? Date.now() - s.getTime() : null
  }
  const position = () => {
    const list = props.runs()
    const r = run()
    const idx = r ? list.findIndex((x) => x.slug === r.slug) : -1
    return { idx, total: list.length }
  }

  // Lines changed (+A -D), cached per state.json mtime; omitted on git failure.
  const [linesChanged, setLinesChanged] = createSignal<LinesChanged | null>(null)
  const linesCache = new Map<string, LinesChanged | null>()
  createEffect(() => {
    const r = run()
    if (!r || !runCompleted(statuses())) {
      setLinesChanged(null)
      return
    }
    const key = `${r.statePath}:${r.mtimeMs}`
    if (linesCache.has(key)) {
      setLinesChanged(linesCache.get(key) ?? null)
      return
    }
    const root = findRepoRoot(dirname(r.statePath)) ?? dirname(r.statePath)
    computeLinesChanged(root).then((v) => {
      linesCache.set(key, v)
      // only apply when this run/key is still the one on screen
      const cur = run()
      if (cur && `${cur.statePath}:${cur.mtimeMs}` === key) setLinesChanged(v)
    })
  })

  const dotFg = (kind: TaskKind): unknown => {
    switch (kind) {
      case "done":
        return c().success
      case "failed":
        return c().error
      case "running":
        return c().spinner
      default:
        return c().muted
    }
  }

  return (
    <Show when={run()} fallback={null}>
      {(r) => (
        <box flexDirection="column" marginTop={1}>
          <text>
            <span style={{ fg: c().accent, bold: true }}>{"◆ DRIVER "}</span>
            <span style={{ fg: c().muted }}>{r().slug}</span>
            <Show when={running() >= 0 && elapsedMs() != null}>
              <span style={{ fg: c().muted }}>
                {"  ⏱ "}
                {formatElapsed(elapsedMs() ?? 0)}
              </span>
            </Show>
            <Show when={position().total > 1}>
              <span style={{ fg: c().muted }}>
                {"  "}
                {position().idx + 1}/{position().total}
              </span>
            </Show>
          </text>
          <Show when={r().state === null}>
            <text>
              <span style={{ fg: c().warning }}>{"  state.json unreadable"}</span>
            </text>
          </Show>
          <For each={PHASES}>
            {(phase, i) => {
              const status = (): PhaseStatus => statuses()[i()]
              const isNext = () => running() >= 0 && i() === nextPending()
              const glyph = () => glyphFor(status(), isNext(), props.animate, props.tick())
              const glyphFg = () => {
                switch (status()) {
                  case "done":
                    return c().success
                  case "failed":
                    return c().error
                  case "running":
                    return c().spinner
                  default:
                    return isNext() && props.animate ? c().spinner : c().muted
                }
              }
              const labelFg = () => (status() === "pending" || status() === "skipped" ? c().muted : c().base)
              const tasks = () => r().state?.plan?.tasks
              const counts = () => taskCounts(tasks())
              const indicators = () => taskIndicators(tasks(), status() === "running")
              // connector leaving the running phase pulses ┃/│ on the animation tick
              const leavingRunning = () => running() === i() - 1
              return (
                <>
                  <Show when={i() > 0}>
                    <text>
                      <span
                        style={{
                          fg: leavingRunning() && props.animate ? c().spinner : c().border,
                        }}
                      >
                        {leavingRunning() && props.animate
                          ? Math.floor(props.tick() / 4) % 2 === 0
                            ? "┃"
                            : "│"
                          : "│"}
                      </span>
                    </text>
                  </Show>
                  <box flexDirection="row">
                    <text>
                      <span style={{ fg: glyphFg(), bold: status() === "running" }}>{glyph()}{" "}</span>
                      <span style={{ fg: labelFg(), bold: status() === "running" }}>{phase.label}</span>
                      <Show when={phase.id === "implement" && subtaskRowVisible(tasks())}>
                        <span style={{ fg: c().muted }}>
                          {"  "}
                          {counts().done}/{counts().total}
                        </span>
                      </Show>
                    </text>
                    <Show when={phase.id === "plan" && status() === "done"}>
                      {/* Sibling text, not a nested one: a text node is not a valid child
                          of a text node, and a mouse handler on a span is silently dropped
                          by the @opentui/solid reconciler (only href/style are handled on
                          text nodes) — a <text> is a scene Renderable, so the handler
                          attaches and hit-testing reaches it (G-28). Padding stays outside
                          the underlined span so the underline only covers the label. */}
                      <text onMouseDown={() => props.onOpenPath(planFilePath(r()))}>
                        <span style={{ fg: c().muted }}>{"  "}</span>
                        {/* underline only the label — brackets stay plain (nested span
                            inherits fg, ORs attributes) */}
                        <span style={{ fg: c().link }}>
                          {"["}
                          <span style={{ underline: true }}>Open Plan</span>
                          {"]"}
                        </span>
                      </text>
                    </Show>
                  </box>
                  <Show
                    when={
                      phase.id === "implement" &&
                      (status() === "running" || status() === "failed") &&
                      subtaskRowVisible(tasks())
                    }
                  >
                    <text>
                      <span style={{ fg: c().muted }}>{"  "}</span>
                      <For each={indicators().slice(0, MAX_TASK_DOTS)}>
                        {(ind) => (
                          <span style={{ fg: dotFg(ind.kind) }}>
                            {dotGlyph(ind.kind, props.animate, props.tick())}
                          </span>
                        )}
                      </For>
                      <Show when={(tasks()?.length ?? 0) > MAX_TASK_DOTS}>
                        <span style={{ fg: c().muted }}>{"…"}</span>
                      </Show>
                    </text>
                  </Show>
                </>
              )
            }}
          </For>
          <Show when={runCompleted(statuses())}>
            <text>
              <span style={{ fg: c().border }}>{"  ──────────"}</span>
            </text>
            <Show when={runDuration(r().state) != null}>
              <text>
                <span style={{ fg: c().muted }}>
                  {"  Total "}
                  {formatElapsed(runDuration(r().state) ?? 0)}
                </span>
              </text>
            </Show>
            <Show when={tokenTotal(props.context, props.sessionID()) != null}>
              <text>
                <span style={{ fg: c().muted }}>
                  {"  Tokens "}
                  {formatTokens(tokenTotal(props.context, props.sessionID()) ?? 0)}
                </span>
              </text>
            </Show>
            <Show when={linesChanged()}>
              {(lc) => (
                <text>
                  <span style={{ fg: c().muted }}>{"  "}</span>
                  <span style={{ fg: c().success }}>{"+"}{lc().added}</span>
                  <span style={{ fg: c().muted }}>{" "}</span>
                  <span style={{ fg: c().error }}>{"-"}{lc().deleted}</span>
                </text>
              )}
            </Show>
            {/* [Open report] appears when the driver has written .plan/<slug>/report.md (driver §7) */}
            <Show when={existsSync(reportFilePath(r()))}>
              <text onMouseDown={() => props.onOpenPath(reportFilePath(r()))}>
                <span style={{ fg: c().muted }}>{"  "}</span>
                <span style={{ fg: c().link }}>
                  {"["}
                  <span style={{ underline: true }}>Open report</span>
                  {"]"}
                </span>
              </text>
            </Show>
          </Show>
        </box>
      )}
    </Show>
  )
}
