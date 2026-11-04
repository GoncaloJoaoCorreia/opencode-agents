## 2026-11-04 — G-24 — Store QA command per repo
- What changed: `commands/driver.md` and `commands/phases/preplan.md` / `commands/phases/quality-gate.md` mirror the new `driver.qa` cache semantics (preplan step 3 precedence chain, quality-gate cache fallback) from the corresponding `agents/driver/*` prompts.
- Commits: `cfdd073268a2fda37f09c1cf5bdb248d5b3641bb`
- Plan: `.plan/G-24/plan.md`

## 2026-11-04 — G-30 — Subtask audit and QA steps - conditional skip
- What changed: `commands/driver.md` and `commands/phases/{implement,spec-audit,quality-gate}.md` mirror the single-task-manifest conditional skip from the corresponding `agents/driver/*` prompts.
- Commits: `2461233175a0735a0094e0d41f8e7a5ef81fce7b`
- Plan: `.plan/G-30/plan.md`
