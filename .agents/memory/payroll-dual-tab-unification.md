---
name: Payroll dual-tab calc unification
description: Why/how PayrollTab (simulator) and PayrollFinalizationTab must stay numerically identical, and the single-source-of-truth invariants that enforce it.
---

# Payroll dual-tab calc unification

The simulator (`PayrollTab`) and finalization (`PayrollFinalizationTab`) tabs must always
produce identical gross/deductions/net for the same employee-month. They used to diverge
(finalization had its own simplified path), which was the core bug behind the unification work.

## Invariants (do not break)
- **One deduction core**: only `computePayroll(input)` in `lib/payroll-core` computes deductions.
  Both tabs call it. PayrollTab calls it directly; finalization goes
  PayrollFinalizationTab → `computeMonthSummary` (payrollCalc) → `loadEmployeeMonthComputation`
  (payrollInputs) → `computePayroll`.
- **One gross/time engine**: gross + per-workplace time aggregation live only in `lib/timeEngine`.
  The finalization adapter (`payrollInputs.ts`) must reconstruct gross with the SAME timeEngine
  helpers and the SAME localStorage keys PayrollTab persists
  (`payType_`, `monthlySalary_`, `hourlyRates_`, `dailyRates_`, `timecard_`, `allowances_`).
- **One rate master**: `resolveRates(prefecture, ym)` in `constants/rates.ts` is the only rate
  source (effective-dated). `computePayroll` reads only that bundle.
- **One seeding path**: when `timecard_` localStorage is empty, both tabs must seed identically —
  hence `entryToRow`/`seedTimecardRows`/`DEFAULT_WP_KEY` live in `timeEngine` and are shared.

**Why:** any second implementation of gross, rounding, rate lookup, or seeding will silently
re-introduce tab divergence. If you add an input that affects gross or deductions, wire it into
BOTH the PayrollTab memos AND `payrollInputs.loadEmployeeMonthComputation`.

## Rounding (centralized in payroll-core)
- Social (health/nursing/pension/childcare, on standard remuneration ×0.5) and employment
  insurance (on gross) → `round50sen` (≤0.5 floor, >0.5 ceil).
- Income tax → `floorYen`. Tax base = `gross − nonTaxableAllowances − socialInsuranceTotal`.

## Acceptance harness
`scripts/acceptance.mjs` bundles the TS via esbuild's JS API (with a `@/` alias plugin) and
asserts the spec case: 300k / 東京 / 40-64 / R8(2026-04) / 甲 / 扶養0 →
health 14775, nursing 2430, pension 27450, childcare 345, labor 1500, social 46500, taxBase 253500.
Run: `node scripts/acceptance.mjs` from the payroll-app dir.

## Allowance taxable flag
`AllowanceItem.taxable` (通勤=非課税). `normalizeAllowance` runs every render and MUST preserve
`taxableTouched`, else a user's manual 課税/非課税 toggle gets overwritten by the type-based
default on the next type edit.
