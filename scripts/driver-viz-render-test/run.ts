// Render snapshot runner for the driver-viz plugin.
//
//   bun run test                      # assert frames match snapshots/*.snap
//   UPDATE_SNAPSHOTS=1 bun run test   # regenerate snapshots (see AGENTS.md: only after
//                                     # INTENTIONAL UI changes in the plugin — review the
//                                     # .snap diff before committing)
//   PREVIEW=1 bun run test            # print each scenario as ANSI to the terminal
//                                     # (see the real styling, e.g. the link underline)
//
// Each scenario mounts the real DriverSection (compiled from
// plugins/driver-viz/lib/FlowChart.tsx by the preload transform) into an OpenTUI
// test renderer under bun, waits for visual idle, and captures the STYLED frame via
// captureSpans() — text AND fg/bg/attributes — so the snapshots cover the entire
// render, not just the characters. A render throw (e.g. an invalid child type)
// fails the scenario — that is how the nested-<text> crash was caught. Run dirs
// are created in the OS temp dir (outside any git repo) so the +A/-D effect
// deterministically resolves to null.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { TextAttributes, rgbToHex, type CapturedFrame, type CapturedSpan } from "@opentui/core"
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
const PREVIEW = process.env.PREVIEW === "1"

const ATTR_BITS: Array<[number, string]> = [
  [TextAttributes.BOLD, "b"],
  [TextAttributes.DIM, "dim"],
  [TextAttributes.ITALIC, "i"],
  [TextAttributes.UNDERLINE, "u"],
  [TextAttributes.BLINK, "blink"],
  [TextAttributes.INVERSE, "inv"],
  [TextAttributes.HIDDEN, "hidden"],
  [TextAttributes.STRIKETHROUGH, "s"],
]

function styleOf(s: CapturedSpan): string {
  const fg = s.fg ? rgbToHex(s.fg) : "-"
  const bg = s.bg ? rgbToHex(s.bg) : "-"
  const attrs = ATTR_BITS.filter(([bit]) => (s.attributes & bit) !== 0)
    .map(([, name]) => name)
    .join(",")
  return `fg=${fg};bg=${bg}${attrs ? `;${attrs}` : ""}`
}

/** Merge adjacent same-style spans, drop trailing whitespace, serialize as styled text. */
function serializeFrame(frame: CapturedFrame): string {
  const rows: string[] = []
  for (const line of frame.lines) {
    const spans = line.spans.filter((s) => s.text.length > 0)
    while (spans.length > 0 && /^\s+$/u.test(spans[spans.length - 1].text)) spans.pop()
    if (spans.length === 0) {
      rows.push("")
      continue
    }
    const merged: CapturedSpan[] = []
    for (const s of spans) {
      const last = merged[merged.length - 1]
      if (last && styleOf(last) === styleOf(s) && last.text.slice(-1) !== "\n") merged[merged.length - 1] = { ...last, text: last.text + s.text }
      else merged.push(s)
    }
    rows.push(merged.map((s) => `<${styleOf(s)}>${s.text}</>`).join(""))
  }
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop()
  return rows.join("\n")
}

/** Render a captured frame as ANSI escape codes for terminal preview. */
function frameToAnsi(frame: CapturedFrame): string {
  const out: string[] = []
  for (const line of frame.lines) {
    for (const s of line.spans) {
      if (s.text.length === 0) continue
      const codes: string[] = []
      if (s.fg) {
        const [r, g, b] = s.fg.toInts()
        codes.push(`38;2;${r};${g};${b}`)
      }
      if (s.bg) {
        const [, , , , bgr, bgg, bgb] = [0, 0, 0, 0, ...s.bg.toInts()]
        codes.push(`48;2;${bgr};${bgg};${bgb}`)
      }
      if (s.attributes & TextAttributes.BOLD) codes.push("1")
      if (s.attributes & TextAttributes.DIM) codes.push("2")
      if (s.attributes & TextAttributes.ITALIC) codes.push("3")
      if (s.attributes & TextAttributes.UNDERLINE) codes.push("4")
      if (s.attributes & TextAttributes.STRIKETHROUGH) codes.push("9")
      out.push(codes.length > 0 ? `\x1b[${codes.join(";")}m${s.text}\x1b[0m` : s.text)
    }
    out.push("\n")
  }
  return out.join("")
}

async function renderScenario(
  name: string,
  setup: (dir: string) => RunInfo[],
  opts: { animate?: boolean; sessionID?: string | null; theme?: Record<string, unknown>; sessionRecord?: unknown },
): Promise<CapturedFrame> {
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
    return test.captureSpans()
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
    if (PREVIEW) {
      console.log(`\n\x1b[1m=== ${s.name} (${WIDTH}x${HEIGHT}, ANSI preview) ===\x1b[0m`)
      process.stdout.write(frameToAnsi(frame))
      continue
    }
    const serialized = serializeFrame(frame)
    if (UPDATE) {
      writeFileSync(snapPath, `# scenario: ${s.name} (${WIDTH}x${HEIGHT} styled frame: <fg=..;bg=..;attrs>text</>)\n${serialized}\n`)
      console.log(`updated ${s.name}.snap`)
      continue
    }
    let expected: string
    try {
      // strip the leading "# scenario: ..." header comment before comparing
      expected = readFileSync(snapPath, "utf8").replace(/^#.*\n/u, "").replace(/\n+$/u, "")
    } catch {
      console.log(`FAIL ${s.name}: missing snapshot ${snapPath} (run with UPDATE_SNAPSHOTS=1)`)
      failures++
      continue
    }
    if (serialized !== expected) {
      failures++
      console.log(`FAIL ${s.name}: frame differs from ${s.name}.snap`)
      const exp = expected.split("\n")
      const got = serialized.split("\n")
      for (let i = 0; i < Math.max(exp.length, got.length); i++) {
        if (exp[i] !== got[i]) console.log(`  line ${i + 1}:\n    expected ${JSON.stringify(exp[i])}\n    got      ${JSON.stringify(got[i])}`)
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

if (PREVIEW) {
  console.log(`\npreviewed ${scenarios.length} scenarios (PREVIEW=1 — no snapshot comparison)`)
} else if (UPDATE) {
  console.log(`updated ${scenarios.length} snapshots`)
} else if (failures > 0) {
  console.log(`${failures}/${scenarios.length} scenarios failed`)
  process.exit(1)
} else {
  console.log(`all ${scenarios.length} render snapshots match`)
}
