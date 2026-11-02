// driver-viz — TUI-only plugin for opencode-agents.
//
// Adds a "DRIVER" section to the TUI sidebar (slot: sidebar.content) with an animated flow
// chart of the current driver run, read live from .plan/<slug>/state.json at the repo root
// of the session's location (so --worktree runs show up too: the driver moves the session
// into the worktree). Hidden entirely when the repo has no .plan/ directory.
//
// - Most recently modified run is shown; `/driver-viz` (palette: "Driver: show next run")
//   cycles through concurrent runs in the same repo.
// - Options (cli.json plugins object form): { "animate": false } disables the spinner and
//   the pulsing connector.
import { watch, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { DriverSection } from "./lib/FlowChart.tsx"
import { findRepoRoot, pickRun, scanRuns, type RunInfo } from "./lib/state.ts"

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
      render: () => (
        <DriverSection
          context={context}
          runs={runs}
          activeSlug={activeSlug}
          tick={tick}
          animate={animate}
        />
      ),
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
          enabled: () => runs().length > 1,
          run: () => {
            const list = runs()
            if (list.length < 2) return
            const cur = activeSlug() ?? pickRun(list, null)?.slug ?? null
            const idx = list.findIndex((r) => r.slug === cur)
            const next = list[(idx + 1) % list.length]
            setActiveSlug(next.slug)
            context.ui.toast.show({ message: `Driver run ${next.slug}`, variant: "info", duration: 1500 })
          },
        },
      ],
      bindings: ["driver-viz.cycle-run"],
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
