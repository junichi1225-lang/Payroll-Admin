---
name: Timecard row IDs must be globally unique per workplace
description: Why payroll timecard row ids are namespaced by workplace and regenerated on move, and the cross-mutation bug that happens otherwise.
---

# Timecard row IDs (payroll-app PayrollTab)

## Rule
Every timecard row's `id` must be globally unique across all workplaces.
- Rows generated from a source timecard entry are namespaced as `${workplaceId}:${entry.id}` (done in the single row factory used by both the initial seed and OCR/CSV import).
- Manually added rows use a timestamp-based id (`m_${Date.now()}_${counter}`), NOT a bare counter — the counter resets on reload while rows persist in localStorage.
- When an existing row is edited and its workplace changes, regenerate its id; otherwise it keeps its old-workplace namespace and can collide with a later re-import of that original workplace.

## Why
All row update handlers (edit time / break minutes / toggle manual edit / manual-save edit path) match rows by `id` only (`r.id === id`). If two rows in different workplaces share an id, editing one silently mutates the other. This became reachable once OCR/CSV import was changed to load ALL entries into one chosen workplace while preserving other workplaces' rows (re-using the same source entry.id set across workplaces). Before that change, import replaced every row, so stale duplicates couldn't linger.

## How to apply
`row.id` is opaque UI identity — used only for React keys and handler matching, never parsed back into an entry/workplace id. Keep it that way. Any new code path that creates timecard rows must route through the shared id-generation rules above.
