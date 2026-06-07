---
name: Income tax (源泉徴収) — 令和8年分 implementation
description: How monthly withholding is computed (月額表 transcription + 電算機特例 tail) and the invariants to preserve.
---

# Income tax — 令和8年分 compliant

`taxCalculator.ts` `calculateIncomeTax(A)` takes **A = その月の社会保険料等控除後の給与等の金額**
(総支給 − 非課税手当 − 社会保険料被保険者負担合計) and returns the monthly 源泉徴収税額
(甲欄・扶養親族等0人). It is NOT an annual-proration approximation anymore.

Structure:
- `A < 105,000` → 0.
- `105,000 ≤ A < 740,000` → lookup in `MONTHLY_TAX_TABLE`, the verbatim 国税庁 月額表 (甲・扶養0)
  transcribed as `[下限(以上), 税額]` bands (以上〜未満; last band upper = 740,000).
- `A ≥ 740,000` → 財務省告示「電算機計算の特例」: 給与所得控除(別表第一, ceil) +
  基礎控除月額 48,333 (=580,000/12, 別表第三) → 別表第四 速算表 (率は復興2.1%込 ×1.021,
  10円未満四捨五入).

**Source of truth (do NOT guess legal figures):** 国税庁 令和8年分 源泉徴収税額表
月額表 Excel `01-07.xls`; 電算機特例 別表は告示 `18.pdf`; 基礎控除月額は denshi_01.pdf。

**Why it matters:** the same routine is reused for 賞与 前月特例 (前月給与なし / 前月給与の10倍超)
in Round 2, so correctness propagates.

**Invariants when touching this file:**
- Keep input semantics = 社保控除後 (the core caller passes that base and floors the result).
  Do not reintroduce an 88,000 floor or ×12÷12 annual-proration logic.
- The 社保 side must stay unchanged — income-tax work must not move premium amounts.
- Acceptance lives in `scripts/acceptance.mjs` §B (月額表 points, regime-switch boundaries
  around 105,000 and 740,000, and an 電算機特例 case). Run `node scripts/acceptance.mjs` after edits.

**Known cosmetic gap (not a regression):** the simulator's *previous-month* display fallback
feeds 総支給 into `calculateIncomeTax`, which now expects 社保控除後, so the displayed prior-month
tax reads slightly high. The `PayrollResult` snapshot stores only a combined deduction total
(no standalone income-tax field), so a correct fix is schema-level. The authoritative compute
path is unaffected.
