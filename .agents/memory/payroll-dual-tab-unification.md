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
- Income tax: rounding is done INSIDE `payroll-core/incomeTax.ts` (甲欄 10円未満四捨五入 etc.);
  `computePayroll` must not re-round. Tax base = `gross − nonTaxableAllowances − socialInsuranceTotal`.

## Acceptance harness
`scripts/acceptance.mjs` bundles the TS via esbuild's JS API (with a `@/` alias plugin) and
asserts the spec case: 300k / 東京 / 40-64 / R8(2026-04) / 甲 / 扶養0 →
health 14775, nursing 2430, pension 27450, childcare 345, labor 1500, social 46500, taxBase 253500.
Run: `node scripts/acceptance.mjs` from the payroll-app dir.

## Allowance model
`AllowanceItem` is `{id, type, taxableAmount, nonTaxableAmount}` (two ¥ inputs in the UI; the old
`{amount, taxable}` flag model is gone). `normalizeAllowance` migrates legacy records (taxable flag,
else 通勤-name heuristic — migration only). Use `allowancesSum` / `nonTaxableAllowancesSum` /
`allowanceTotal` helpers; never sum `.amount` directly.

## Locked-month display is snapshot-only
Once a month is locked, ALL confirmed views (simulator ResultCard, finalization rows,
payslip PDF fields incl. resident-tax row visibility) must read from the stored
`PayrollResult` snapshot, never from live recomputation — otherwise post-lock master/rate
changes silently change confirmed numbers. New snapshot fields (appliedRates,
socialInsuranceDeductedSalary, withheldIncomeTax, appliedStandardRemuneration/HistoryId,
paidLeave 0/0/0 placeholders) are optional on `PayrollResult` for legacy data; when adding
computation outputs, propagate through PayrollComputation → MonthComputation (payrollInputs)
→ PayrollSummary (payrollCalc) → all 3 lock sites, or finalization silently drops them.
