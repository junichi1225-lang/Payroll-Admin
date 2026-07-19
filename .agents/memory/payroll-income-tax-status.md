---
name: Income tax (源泉徴収) — 令和8年分 module
description: How monthly withholding is computed (payroll-core/incomeTax.ts, 電算機特例 + 乙欄 partial) and the invariants to preserve.
---

# Income tax — 令和8年分 (payroll-core/incomeTax.ts)

Monthly withholding lives in `src/lib/payroll-core/incomeTax.ts` (user-verified module).
`calculateIncomeTax(IncomeTaxInput)` takes taxableAllowanceTotal (=gross), nonTaxableCommutingAllowance,
socialInsuranceDeduction, taxTableColumn ("kou"|"otsu"), hasSpouseDeduction, dependentCount, taxYear.
It computes A = gross − 非課税 − 社保 internally and does its own rounding:
- 甲欄: 財務省告示 電算機計算の特例 (第1表 給与所得控除 ceil / 第2表 配偶者・扶養 31,667 each /
  第3表 基礎控除 / 第4表 速算 ×1.021, **10円未満四捨五入**).
- 乙欄: A < 105,000 → A×3.063% floor; A ≥ 105,000 → **throws** (月額表・乙欄 3,000円刻みテーブル未投入、別タスク).

`computePayroll` wraps the call in try/catch → returns `taxError` (incomeTax=0) instead of crashing;
both tabs block 確定 (lock) and show the error when taxError is set. Lock snapshots persist
`taxSnapshot` (taxMeta: taxYear/taxCategory/dependentCount). V1 always uses dependents 0, spouse false.

**Do not re-round in computePayroll** (no floorYen double-apply). Do not reintroduce 88,000 floor
or annual proration. 社保 side must stay unchanged by income-tax work.

**Source of truth (never guess legal figures):** 国税庁 令和8年分 税額表 + 電算機特例告示 PDFs.

Bonus (賞与) withholding + PayrollTab previous-month reference display still use the OLD
`taxCalculator.ts` intentionally (out of scope / rough reference only).

Tests: `pnpm run test` (vitest; `vitest.config.ts` is separate because vite.config requires PORT and
must define the `@` alias). Legacy `scripts/acceptance.mjs` §B reflects the old engine — treat as stale.
