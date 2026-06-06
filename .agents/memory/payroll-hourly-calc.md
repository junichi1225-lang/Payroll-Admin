---
name: Payroll gross / rate / allowance model
description: Durable rules for how the payroll simulator computes gross, the deduction base, the snapshot 単価/基本給, allowances, and the prefecture used for social-insurance rates.
---

# Payroll calculation model (payroll-app PayrollTab)

## Gross / deduction base (all pay types)
- Gross = base + allowances, uniformly across 月給制 / 日給制 / 時給制:
  - 月給制: 月額 + 手当
  - 日給制: Σ(職場別日給 × 出勤日数) + 手当
  - 時給制: Σ(職場別時給 × 正味労働時間) + 手当
- The deduction calc (社会保険/所得税/雇用保険/住民税) is always based on this same gross, so allowances are always part of the deduction base.
- **Why:** the three pay types must stay at feature parity; a missing allowance term in any one of them silently understates both gross and deductions. Multi-workplace hourly/daily must sum per workplace — never one "primary" rate × all hours/days.

## Snapshot 単価 / 基本給 (appliedBaseSalary)
- The confirmation snapshot's appliedBaseSalary is the BASE only, excluding allowances:
  - 月給制 → 月額; 日給制 → 代表日給; 時給制 → weighted-average blended rate (gross/total hours).
- **Why:** the finalization tab renders appliedBaseSalary under a "単価/基本給" column expecting one base scalar per row. Including allowances, or storing a total there, mis-renders the column. For multi-workplace hourly there is no single true rate, so the blended average is the honest representative (collapses to the workplace rate when there's one workplace).
- **How to apply:** keep the blended/representative rate for display & snapshot only — never feed it into gross/deduction/net math.

## Prefecture for social-insurance rate lookup (V1)
- Use the prefecture of the workplace with the most net hours, derived from the same per-workplace net-hours map that feeds the gross calc (fallback: default workplace → first workplace → 東京都).
- **Why:** insurance-rate workplace selection must agree with the gross-calc workplace basis; a separate raw-time recomputation can disagree (e.g. ignores edited/error rows).

## Social-insurance enrollment guard
- SI is computed only when the employee is 社会保険加入 AND has a positive 標準報酬月額 (unknown grade → cannot compute → shows 0). Seeded employees all have positive values, so a 0 only arises from blank user input.
