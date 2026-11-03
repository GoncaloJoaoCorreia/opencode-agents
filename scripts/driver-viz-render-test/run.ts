// Render snapshot runner for the driver-viz plugin.
//
//   bun run test                      # assert frames match snapshots/*.snap
//   UPDATE_SNAPSHOTS=1 bun run test   # regenerate snapshots (see AGENTS.md: only after
//                                     # INTENTIONAL UI changes in the plugin — review the
//                                     # .snap diff before committing)
//
// Each scenario mounts the real DriverSection (compiled from
// plugins/driver-viz/lib/FlowChart.tsx by the preload transform) into an OpenTUI
// test renderer under bun, waits for visual idle, and captures the char frame.
// A render throw (e.g. an invalid child type) fails the scenario — that is how the
// nested-<text> crash was caught. Run dirs are created in the OS temp dir (outside
// any git repo) so the +A/-D effect deterministically resolves to null.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { DriverSection } from "../../plugins/driver-viz/lib/FlowChart.tsx"
import type { RunInfo } from "../../plugins/driver-viz/lib/state.ts"
import { FIXED_NOW, prepareScenarioDir, scenarios } from "./scenarios.ts"

// Freeze time so the ⏱ elapsed line is deterministic.
Date.now = () => FIXED_NOW

const WIDTH = 64
const HEIGHT = 26
const SNAP_DIR = join(import.meta.dir, "snapshots")
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1"

function normalizeFrame(frame: string): string {
  return frame
    .split(/\r?\n/)
    .map((row) => row.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/\n+$/u, "")
}

async function renderScenario(
  name: string,
  setup: (dir: string) => RunInfo[],
  opts: { animate?: boolean; sessionID?: string | null; theme?: Record<string, unknown>; sessionRecord?: unknown },
): Promise<string> {
  const base = mkdtempSync(join(tmpdir(), "drv-render-"))
  const dir = prepareScenarioDir(base, name)
  const runs = setup(dir)
  const [runsSig] = createSignal(runs)
  const [activeSlug] = createSignal<string | null>(null)
  const [tick] = createSignal(0) // fixed tick → stable spinner glyph
  const context = {
    theme: opts.theme ?? {},
    data: { session: { get: () => opts.sessionRecord ?? null } },
  }
  const test = await testRender(
    () =>
      DriverSection({
        context,
        runs: runsSig,
        activeSlug,
        tick,
        animate: opts.animate ?? true,
        sessionID: () => opts.sessionID ?? "ses_test",
        onOpenPath: () => {},
      }),
    { width: WIDTH, height: HEIGHT },
  )
  try {
    await test.waitForVisualIdle()
    return normalizeFrame(test.captureCharFrame())
  } finally {
    await test.dispose()
  }
}

let failures = 0
mkdirSync(SNAP_DIR, { recursive: true })

for (const s of scenarios) {
  const snapPath = join(SNAP_DIR, `${s.name}.snap`)
  try {
    const frame = await renderScenario(s.name, s.setup, s)
    if (UPDATE) {
      writeFileSync(snapPath, `# scenario: ${s.name} (${WIDTH}x${HEIGHT} char frame)\n${frame}\n`)
      console.log(`updated ${s.name}.snap`)
      continue
    }
    let expected: string
    try {
      // strip the leading "# scenario: ..." header comment before normalizing
      const raw = readFileSync(snapPath, "utf8")
      expected = normalizeFrame(raw.replace(/^#.*\n/u, ""))
    } catch {
      console.log(`FAIL ${s.name}: missing snapshot ${snapPath} (run with UPDATE_SNAPSHOTS=1)`)
      failures++
      continue
    }
    if (frame !== expected) {
      failures++
      console.log(`FAIL ${s.name}: frame differs from ${s.name}.snap`)
      const exp = expected.split("\n")
      const got = frame.split("\n")
      for (let i = 0; i < Math.max(exp.length, got.length); i++) {
        if (exp[i] !== got[i]) console.log(`  line ${i + 1}: expected ${JSON.stringify(exp[i])} got ${JSON.stringify(got[i])}`)
      }
      console.log(`  (regenerate with UPDATE_SNAPSHOTS=1 only if this change is intentional — see AGENTS.md)`)
    } else {
      console.log(`ok   ${s.name}`)
    }
  } catch (e) {
    failures++
    console.log(`FAIL ${s.name}: render threw: ${(e as Error).message}`)
  }
}

if (UPDATE) {
  console.log(`updated ${scenarios.length} snapshots`)
} else if (failures > 0) {
  console.log(`${failures}/${scenarios.length} scenarios failed`)
  process.exit(1)
} else {
  console.log(`all ${scenarios.length} render snapshots match`)
}
