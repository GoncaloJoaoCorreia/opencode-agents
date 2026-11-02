// Mirror of the phase registry in agents/driver.md (section 6, "Spawn phases (registry order)").
// scripts/validate.sh fails the build if this list drifts from that registry — keep them in sync.
export const PHASES = [
  { id: "preplan", label: "Preplan" },
  { id: "plan", label: "Plan" },
  { id: "implement", label: "Implement" },
  { id: "spec-audit", label: "Audit" },
  { id: "code-review", label: "Review" },
  { id: "quality-gate", label: "QA" },
  { id: "write-history", label: "History" },
  { id: "pr", label: "PR" },
] as const

export type PhaseId = (typeof PHASES)[number]["id"]
export const PHASE_IDS: string[] = PHASES.map((p) => p.id)
