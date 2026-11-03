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

/** Non-white fallback used when the theme accent itself is white/near-white. */
export const SPINNER_FALLBACK = "#58a6ff"

/** True for hex colors whose every channel is >= 0xf0 (#fff, #ffffff, #fefefe, #f8f8f8…). */
export function isNearWhite(v: unknown): boolean {
  if (typeof v !== "string") return false
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return false
  let hex = m[1].toLowerCase()
  if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("")
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return r >= 0xf0 && g >= 0xf0 && b >= 0xf0
}

export function palette(theme: ThemeLike) {
  const accent = color(theme, ["text.action.primary.base", "text.action.primary.default", "accent", "primary"], SPINNER_FALLBACK)
  return {
    base: color(theme, ["text.base", "text.default"], "#e6edf3"),
    muted: color(theme, ["text.muted", "text.subdued", "text.faint"], "#8b949e"),
    accent,
    // spinner must stay visible on light themes: white/near-white accents fall back
    // to a guaranteed non-white color
    spinner: isNearWhite(accent) ? SPINNER_FALLBACK : accent,
    success: color(theme, ["text.feedback.success.base", "text.feedback.success.default", "success"], "#3fb950"),
    warning: color(theme, ["text.feedback.warning.base", "text.feedback.warning.default", "warning"], "#d29922"),
    error: color(theme, ["text.feedback.error.base", "text.feedback.error.default", "error"], "#f85149"),
    border: color(theme, ["border.base", "border"], "#30363d"),
  }
}

export type Palette = ReturnType<typeof palette>
