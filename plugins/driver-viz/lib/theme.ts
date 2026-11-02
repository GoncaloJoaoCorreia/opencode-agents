// Defensive theme-token resolution. The V2 resolved theme exposes text.base / text.muted /
// text.feedback.{success,warning,error,info}, but custom themes may omit entries (a missing
// feedback token has crashed the whole TUI before) and the nesting has shifted across
// releases — so every color is looked up through candidate paths with a hex fallback.
type ThemeLike = Record<string, unknown>

function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

export function color(theme: ThemeLike, paths: string[], fallback: string): unknown {
  for (const p of paths) {
    const v = dig(theme, p)
    if (v != null) return v
  }
  return fallback
}

export function palette(theme: ThemeLike) {
  return {
    base: color(theme, ["text.base", "text.default"], "#e6edf3"),
    muted: color(theme, ["text.muted", "text.subdued", "text.faint"], "#8b949e"),
    accent: color(theme, ["text.action.primary.base", "text.action.primary.default", "accent", "primary"], "#58a6ff"),
    success: color(theme, ["text.feedback.success.base", "text.feedback.success.default", "success"], "#3fb950"),
    warning: color(theme, ["text.feedback.warning.base", "text.feedback.warning.default", "warning"], "#d29922"),
    error: color(theme, ["text.feedback.error.base", "text.feedback.error.default", "error"], "#f85149"),
    border: color(theme, ["border.base", "border"], "#30363d"),
  }
}

export type Palette = ReturnType<typeof palette>
