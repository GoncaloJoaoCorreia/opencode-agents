// Registers OpenTUI's solid transform exactly like OpenCode does when it loads a
// .tsx TUI plugin: babel-preset-solid (moduleName "@opentui/solid", generate
// "universal") for .tsx sources, plus the solid-js server.js -> solid.js remap so
// every module shares ONE solid-js client instance (two instances = "No renderer
// found" from createElement). Run with: bun --preload ./preload.ts run.ts
//
// resolvePath: the plugin sources live in ../../plugins/driver-viz/, which has no
// node_modules of its own — bare imports there would resolve elsewhere (bun global
// cache) and create duplicate module instances. Rewrite them to absolute paths in
// THIS harness's node_modules. "solid-js" maps to the server.js path on purpose:
// the plugin's onLoad remap serves the client build's content at that path, which
// is the same module @opentui/solid's internal bare import resolves to.
import { join } from "node:path"
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const here = import.meta.dir
const nm = (p: string) => join(here, "node_modules", p)

const resolvePath = (specifier: string): string | undefined => {
  if (specifier === "solid-js") return nm("solid-js/dist/server.js")
  if (specifier === "@opentui/solid") return nm("@opentui/solid/index.bun.js")
  return undefined
}

ensureSolidTransformPlugin({ moduleName: "@opentui/solid", resolvePath })
