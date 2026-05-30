---
name: Hourly payroll gross & rate model
description: How the hourly payroll simulator computes gross, the SI deduction base, the snapshot 単価, and the prefecture used for insurance rates.
---

# Hourly payroll calculation model (payroll-app PayrollTab)

## Gross / deduction base
- Hourly `grossAmount` = `hourlyGross + allowancesTotal`, where `hourlyGross = Σ(workplaceRate_i × netHours_i)` over all workplaces.
- `calcDeductions` (社会保険/所得税/雇用保険/住民税) is always based on this summed gross.
- **Why:** an employee can work at multiple workplaces, each with its own hourly rate. Computing the whole total from one "primary" workplace rate × all hours is wrong. There must be NO single-rate path that produces the gross/deduction base.

## Snapshot 単価 (appliedBaseSalary, hourly)
- Use a **weighted-average blended rate** = `totalHours>0 ? round(hourlyGross/totalHours) : 0` (`effectiveHourlyRate`), NOT a single workplace's rate.
- **Why:** the lock snapshot's `appliedBaseSalary` is rendered in PayrollFinalizationTab under a "単価" (per-hour rate) column that expects one scalar per row. For multi-workplace hourly there is no single true rate; the blended rate is the honest representative and collapses to the workplace rate when there's only one workplace. Storing a total there would mis-render as a huge "単価".
- **How to apply:** keep `effectiveHourlyRate` for display/snapshot only — never feed it into gross/deduction/net math.

## Prefecture for social-insurance rate lookup (V1)
- `primaryPrefecture` = prefecture of the workplace with the **most net hours**, derived from the same `hoursByWorkplace` map that feeds `hourlyGross`. Fallback: top-hours workplace → `DEFAULT_WP_KEY` → first workplace → "東京都".
- **Why:** insurance-rate workplace selection must agree with the gross-calc workplace basis; a separate raw-time recomputation can disagree (e.g. ignores edited/error rows).

## standardRemuneration / SI guard
- SI is only computed when `isSocialInsurance && standardRemuneration > 0` (intentional: unknown grade → cannot compute, shows 0).
- All seeded employee masters (e1–e5 in dummy-data.ts) have non-zero standardRemuneration, so the SI=0 case only arises from blank user input, not the seed data.
