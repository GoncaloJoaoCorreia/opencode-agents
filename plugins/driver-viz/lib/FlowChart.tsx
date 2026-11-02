// The sidebar flow chart. Renders one vertical stepper per driver run:
//   ◆ DRIVER ABC-123  feat/ABC-123  PR #42  1/2
//   ✓ Preplan
//   ┃ Plan            <- connector pulses while the phase above runs
//   ⠋ Implement  3/7
//     ●●●○○○          <- per-task dots while implement runs
//   ○ Audit
//   ...
// Statuses come straight from .plan/<slug>/state.json (phases.<id>.status).
import { For, Show, type Accessor } from "solid-js"
import { PHASES } from "./phases.ts"
import {
  nextPendingIndex,
  phaseStatus,
  pickRun,
  runningIndex,
  taskCounts,
  type DriverState,
  type PhaseStatus,
  type RunInfo,
} from "./state.ts"
import { palette, type Palette } from "./theme.ts"

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const MAX_TASK_DOTS = 16

// Plugin context is typed by the host; keep it loose so the plugin never crashes on
// minor API drift between OpenCode releases.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

function taskDots(state: DriverState | null): string {
  const tasks = state?.plan?.tasks ?? []
  const glyphs = tasks.slice(0, MAX_TASK_DOTS).map((t) => {
    if (t.status === "done") return t.audit === "fail" || t.qa === "fail" ? "✗" : "●"
    if (t.status === "skipped") return "⊘"
    return "○"
  })
  return glyphs.join("") + (tasks.length > MAX_TASK_DOTS ? "…" : "")
}

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

export function DriverSection(props: {
  context: Ctx
  runs: Accessor<RunInfo[]>
  activeSlug: Accessor<string | null>
  tick: Accessor<number>
  animate: boolean
}) {
  const c = (): Palette => palette((props.context.theme ?? {}) as Record<string, unknown>)
  const run = () => pickRun(props.runs(), props.activeSlug())
  const statuses = (): PhaseStatus[] => {
    const r = run()
    return PHASES.map((p) => phaseStatus(r?.state ?? null, p.id))
  }
  const running = () => runningIndex(statuses())
  const nextPending = () => nextPendingIndex(statuses())
  const position = () => {
    const list = props.runs()
    const r = run()
    const idx = r ? list.findIndex((x) => x.slug === r.slug) : -1
    return { idx, total: list.length }
  }

  return (
    <Show when={run()} fallback={null}>
      {(r) => (
        <box flexDirection="column" marginTop={1}>
          <text>
            <span style={{ fg: c().accent, bold: true }}>{"◆ DRIVER "}</span>
            <span style={{ fg: c().base }}>{r().slug}</span>
            <Show when={r().state?.branch}>
              <span style={{ fg: c().muted }}>{"  "}{r().state?.branch}</span>
            </Show>
            <Show when={r().state?.pr?.url}>
              <span style={{ fg: c().success }}>
                {"  PR #"}
                {String(r().state?.pr?.number ?? "")}
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
                    return c().accent
                  default:
                    return isNext() && props.animate ? c().accent : c().muted
                }
              }
              const labelFg = () => (status() === "pending" || status() === "skipped" ? c().muted : c().base)
              const tasks = () => r().state?.plan?.tasks
              const counts = () => taskCounts(tasks())
              // connector leaving the running phase pulses ┃/│ on the animation tick
              const leavingRunning = () => running() === i() - 1
              return (
                <>
                  <Show when={i() > 0}>
                    <text>
                      <span
                        style={{
                          fg: leavingRunning() && props.animate ? c().accent : c().border,
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
                  <text>
                    <span style={{ fg: glyphFg(), bold: status() === "running" }}>{glyph()}{" "}</span>
                    <span style={{ fg: labelFg(), bold: status() === "running" }}>{phase.label}</span>
                    <Show when={phase.id === "implement" && counts().total > 0}>
                      <span style={{ fg: c().muted }}>
                        {"  "}
                        {counts().done}/{counts().total}
                      </span>
                    </Show>
                  </text>
                  <Show
                    when={
                      phase.id === "implement" &&
                      (status() === "running" || status() === "failed") &&
                      counts().total > 0
                    }
                  >
                    <text>
                      <span style={{ fg: counts().gateFailed > 0 ? c().error : c().muted }}>
                        {"  "}
                        {taskDots(r().state)}
                      </span>
                    </text>
                  </Show>
                </>
              )
            }}
          </For>
        </box>
      )}
    </Show>
  )
}
