---
name: Japanese bonus (賞与) payroll
description: How bonus payroll is modeled as an independent entity, plus the non-obvious calc/data constraints that diverge from monthly payroll.
---

# 賞与 (bonus) payroll — independent entity

賞与 is a fully separate entity from monthly payroll: its own DB keys
(`mock_bonusRunDB` / `mock_bonusResultDB`), its own pure calc entrypoint
(`computeBonus`), and its own tab/screen. It must never be folded into the
monthly payroll data structures or `computeEmployeeMonth`. It still *reuses*
the shared monthly building blocks (resolveRates, 50-sen rounding, 介護
judgment, 月額表 income-tax fn, PDF/share infra).

## 賞与回 participant snapshot
**Rule:** `BonusRun.employeeIds` is snapshotted at run creation; the "all
confirmed" status and the displayed rows are computed against that snapshot,
not the live employee roster.
**Why:** if status/rows read the live roster, adding or removing an employee
after a run is locked would silently flip a finalized run's status. A bonus
回 has a fixed participant set, like a real payroll run.
**How to apply:** when iterating bonus rows or computing run status, resolve
participants from `run.employeeIds` (fall back to live employees only when the
snapshot is missing/empty for legacy data), and skip ids no longer present.

## 賞与算出率表 source of truth
**Rule:** the 賞与に対する源泉徴収税額の算出率の表 (令和8, 甲, 扶養0) was
transcribed directly from the official NTA PDF (告示第115号別表第三, 122号改正).
**Why:** both AI/web summaries of the bracket values were WRONG. Only the
primary NTA source is trustworthy for these brackets (千円 units, contiguous).
**How to apply:** never "fix" these brackets from a web summary — verify
against the NTA PDF.

## 賞与源泉所得税 special methods
- 原則: 前月の社保控除後給与 → 算出率表 → 率 → ×(賞与の社保控除後額), 円未満切捨て.
- 特例1 (前月給与なし / 賞与が前月給与の使えるケースに該当しない): 賞与社保控除後 ÷6 →
  月額表(甲) → ×6.
- 特例2 (賞与が前月給与の10倍超): (賞与社保控除後 ÷6 + 前月課税給与) → 月額表 −
  前月の税額 → ×6.
- No 住民税 on bonus (住民税 is annual, levied via monthly special collection).

## Caps & fiscal accumulation
- 標準賞与額 = floor to 1,000円.
- 健保系 cap: 573万円/年度 (April–March) cumulative; 厚年系 cap: 150万円/回.
- 雇用保険 is on raw grossBonus (no standard-bonus flooring).
- **Accumulation gotcha:** the 573万 fiscal cumulative must sum each prior
  result's `healthBaseStandardBonus` (the cap-applied health standard bonus),
  NOT the raw `standardBonusAmount`. Summing raw amounts over-counts when a
  prior period was health-insurance-exempt.

## Known prototype limitations (intentional drift)
- No SPEC.md exists for this project; verification is typecheck + hand-checked
  acceptance numbers + architect review + e2e. Do not invent a SPEC.md or bloat
  replit.md.
