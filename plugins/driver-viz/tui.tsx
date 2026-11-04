// driver-viz — TUI-only plugin for opencode-agents.
//
// Adds a "DRIVER" section to the TUI sidebar (slot: sidebar.content) with an animated flow
// chart of the current driver run, read live from .plan/<slug>/state.json at the repo root
// of the session's location (so --worktree runs show up too: the driver moves the session
// into the worktree). Hidden entirely when the repo has no .plan/ directory.
//
// - Session-scoped run selection: only runs whose state.json `session_id` matches the
//   current session's ID are shown (the sidebar.content slot render input carries
//   `sessionID`; fallback `ui.router.current()` when it is { type: "session", sessionID }).
//   A newly started run of this session is switched to immediately; `/driver-viz`
//   (palette: "Driver: show next run") cycles only this session's runs. The filter is
//   strict (G-32) — no fallback: when no run matches (e.g. all runs have `session_id:
//   null` from an older driver) or the session ID is unknown, the list stays empty and
//   the sidebar section is hidden.
// - Palette fallbacks for the clickable sidebar actions: "Driver: open plan" (enabled once
//   the plan phase is done) and "Driver: open report" (enabled when .plan/<slug>/report.md
//   exists) open the file with the system default app (open/xdg-open via node:child_process).
// - Options (cli.json plugins object form): { "animate": false } disables the spinner and
//   the pulsing connector.
import { execFile } from "node:child_process"
import { watch, type FSWatcher } from "node:fs"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createEffect, createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { DriverSection } from "./lib/FlowChart.tsx"
import {
  filterRunsBySession,
  findRepoRoot,
  phaseStatus,
  pickRun,
  planFilePath,
  reportFilePath,
  scanRuns,
  type RunInfo,
} from "./lib/state.ts"

const POLL_MS = 1000 // state re-scan; also re-reads the location, so session_move into a worktree is picked up
const TICK_MS = 120 // animation frame
const DEBOUNCE_MS = 150 // fs.watch event debounce

export default Plugin.define({
  id: "driver-viz",
  setup(context) {
    const options = (context.options ?? {}) as Record<string, unknown>
    const animate = options.animate !== false

    const [runs, setRuns] = createSignal<RunInfo[]>([])
    const [activeSlug, setActiveSlug] = createSignal<string | null>(null)
    const [tick, setTick] = createSignal(0)
    // Current session ID: primary source is the sidebar.content slot render input
    // (SlotMap input `sessionID`, v2.2.5); fallback is ui.router.current().
    const [slotSessionID, setSlotSessionID] = createSignal<string | null>(null)

    function sessionIDFromRouter(): string | null {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cur = (context.ui as any)?.router?.current?.()
        if (cur && typeof cur === "object" && cur.type === "session" && typeof cur.sessionID === "string") {
          return cur.sessionID
        }
      } catch {
        /* host API drift — fall through to null */
      }
      return null
    }

    const sessionID = (): string | null => slotSessionID() ?? sessionIDFromRouter()

    // Runs of the current session only, strict (G-32): an unknown session ID or no
    // matching run yields an empty list and the sidebar section renders nothing
    // (see filterRunsBySession).
    const filteredRuns = (): RunInfo[] => filterRunsBySession(runs(), sessionID())

    // The run currently shown (selection, auto-switch, and palette commands all use it).
    const currentRun = (): RunInfo | null => pickRun(filteredRuns(), activeSlug())

    // Open a path with the system default app (open on darwin, xdg-open on linux);
    // failures surface as an error toast instead of crashing the sidebar.
    function openWithSystemApp(path: string) {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null
      if (!cmd) {
        context.ui.toast.show({
          message: `No system opener on ${process.platform}: ${path}`,
          variant: "error",
        })
        return
      }
      execFile(cmd, [path], (err) => {
        if (err) {
          context.ui.toast.show({
            message: `Could not open ${path}: ${err.message}`,
            variant: "error",
          })
        }
      })
    }

    // Auto-switch: when a newly appeared run of this session shows up in the filtered
    // list (sorted most-recent first), switch to it immediately.
    let prevFilteredSlugs = new Set<string>()
    createEffect(() => {
      const list = filteredRuns()
      const fresh = list.filter((r) => !prevFilteredSlugs.has(r.slug))
      if (fresh.length > 0) setActiveSlug(fresh[0].slug)
      prevFilteredSlugs = new Set(list.map((r) => r.slug))
    })

    let planDir: string | null = null
    let watcher: FSWatcher | undefined
    let debounce: ReturnType<typeof setTimeout> | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    let ticker: ReturnType<typeof setInterval> | undefined

    function currentDirectory(): string | null {
      const loc = (context.location ?? context.data.location.default()) as
        | { directory?: string }
        | undefined
      return loc?.directory ?? null
    }

    function attachWatcher(dir: string | null) {
      if (dir === planDir && watcher) return
      watcher?.close()
      watcher = undefined
      planDir = dir
      if (!dir) return
      try {
        // Recursive watch where the runtime supports it; the 1s poll below is the
        // reliable fallback everywhere else (and covers location changes).
        watcher = watch(dir, { recursive: true }, () => {
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(rescan, DEBOUNCE_MS)
        })
        watcher.on("error", () => {})
      } catch {
        watcher = undefined
      }
    }

    function rescan() {
      const dir = currentDirectory()
      const root = dir ? findRepoRoot(dir) : null
      const pd = root ? join(root, ".plan") : null
      attachWatcher(pd)
      setRuns(pd ? scanRuns(pd) : [])
    }

    rescan()
    poll = setInterval(rescan, POLL_MS)
    if (animate) ticker = setInterval(() => setTick((t) => t + 1), TICK_MS)

    const unregisterSlot = context.ui.slot({
      append: "sidebar.content",
      render: (input) => {
        // SlotMap["sidebar.content"] input carries the current session's ID (v2.2.5).
        const sid = (input as { sessionID?: unknown } | null | undefined)?.sessionID
        if (typeof sid === "string" && sid) setSlotSessionID(sid)
        return (
          <DriverSection
            context={context}
            runs={filteredRuns}
            activeSlug={activeSlug}
            tick={tick}
            animate={animate}
            sessionID={sessionID}
            onOpenPath={openWithSystemApp}
          />
        )
      },
    })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "driver-viz.cycle-run",
          title: "Driver: show next run",
          group: "Driver",
          palette: true,
          slash: { name: "driver-viz", aliases: ["drv"] },
          enabled: () => filteredRuns().length > 1,
          run: () => {
            const list = filteredRuns() // cycle only within the current session's runs
            if (list.length < 2) return
            const cur = list.find((r) => r.slug === activeSlug())?.slug ?? pickRun(list, null)?.slug ?? null
            const idx = list.findIndex((r) => r.slug === cur)
            const next = list[(idx + 1) % list.length]
            setActiveSlug(next.slug)
            context.ui.toast.show({ message: `Driver run ${next.slug}`, variant: "info", duration: 1500 })
          },
        },
        {
          id: "driver-viz.open-plan",
          title: "Driver: open plan",
          group: "Driver",
          palette: true,
          enabled: () => phaseStatus(currentRun()?.state ?? null, "plan") === "done",
          run: () => {
            const r = currentRun()
            if (r && phaseStatus(r.state, "plan") === "done") openWithSystemApp(planFilePath(r))
          },
        },
        {
          id: "driver-viz.open-report",
          title: "Driver: open report",
          group: "Driver",
          palette: true,
          enabled: () => {
            const r = currentRun()
            return !!r && existsSync(reportFilePath(r))
          },
          run: () => {
            const r = currentRun()
            if (r && existsSync(reportFilePath(r))) openWithSystemApp(reportFilePath(r))
          },
        },
      ],
      bindings: ["driver-viz.cycle-run", "driver-viz.open-plan", "driver-viz.open-report"],
    }))

    return () => {
      unregisterSlot()
      if (poll) clearInterval(poll)
      if (ticker) clearInterval(ticker)
      if (debounce) clearTimeout(debounce)
      watcher?.close()
    }
  },
})
