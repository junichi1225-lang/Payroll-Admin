---
name: Income tax (源泉徴収) implementation status
description: Why the monthly withholding calc is not yet correct and what is needed to fix it.
---

# Income tax status — NOT yet 令和8年分 compliant

`taxCalculator.ts` `calculateIncomeTax(monthlyTaxableBase)` is a self-made **annual-proration
approximation**: 月額×12 → 給与所得控除 → 基礎控除 → 累進税率 → ÷12. This is NOT the
財務省告示「電算機計算の特例」(which applies monthly brackets directly to the
社会保険料控除後 monthly amount), despite the file comment claiming so.

It also uses **令和6年分 (old) deduction amounts**: 給与所得控除 minimum 550,000 and
基礎控除 480,000. The 令和7年度税制改正 (effective for withholding from 令和8年1月以降)
raised these to 給与所得控除 min 650,000 and 基礎控除 580,000.

**Fix is blocked on official data.** Do NOT guess legal tax-table figures. Two acceptable
approaches (user to choose / provide source):
- (a) transcribe 国税庁「令和8年分 月額表」甲欄(扶養0列) → table lookup
- (b) implement 財務省告示「令和8年分 電算機計算の特例」別表 → formula (reused by 賞与 前月特例)

**Why it matters:** the same routine is reused for bonus (賞与) withholding special cases
(前月給与なし / 前月給与の10倍超) in Round 2, so its correctness propagates.

Note: the legacy acceptance value `incomeTax = 6674` for taxBase 253,500 came from the OLD
approximation and will change once B is corrected. The 社保 side (健保14775/介護2430/厚年27450/
支援金345/雇用1500) must stay fixed.
