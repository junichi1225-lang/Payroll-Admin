// computePayroll と所得税モジュールの結線テスト。
// 課税ベース = 総支給 − 非課税手当 − 社会保険料 で新モジュールに渡ることと、
// 乙欄・105,000円以上で taxError が返る（throw ではなく）ことを検証する。
import { describe, expect, it } from "vitest";
import { computePayroll } from "./index";
import { calculateIncomeTax } from "./incomeTax";

const base = {
  targetYearMonth: "2026-07",
  prefecture: "東京都",
};

describe("computePayroll × incomeTax 結線", () => {
  it("非課税手当が課税ベースから除外される（社保対象外・甲欄）", () => {
    const withNonTaxable = computePayroll({
      ...base,
      gross: 300_000,
      nonTaxableAllowanceTotal: 15_000,
      employee: { isSocialInsurance: false },
    });
    const expected = calculateIncomeTax({
      taxableAllowanceTotal: 300_000,
      nonTaxableCommutingAllowance: 15_000,
      socialInsuranceDeduction: withNonTaxable.deductions.socialInsuranceTotal,
      taxTableColumn: "kou",
      hasSpouseDeduction: false,
      dependentCount: 0,
      taxYear: 2026,
    });
    expect(withNonTaxable.deductions.incomeTax).toBe(expected.incomeTax);
    expect(withNonTaxable.taxError).toBeUndefined();
    expect(withNonTaxable.taxMeta.taxCategory).toBe("甲欄");

    // 非課税手当なしより税額が下がる（課税ベースが減るため）
    const withoutNonTaxable = computePayroll({
      ...base,
      gross: 300_000,
      nonTaxableAllowanceTotal: 0,
      employee: { isSocialInsurance: false },
    });
    expect(withNonTaxable.deductions.incomeTax).toBeLessThan(
      withoutNonTaxable.deductions.incomeTax,
    );
  });

  it("乙欄・課税ベース105,000円以上は taxError（incomeTax=0）", () => {
    const r = computePayroll({
      ...base,
      gross: 200_000,
      nonTaxableAllowanceTotal: 0,
      employee: { isSocialInsurance: false, taxCategory: "乙欄" },
    });
    expect(r.taxError).toBeTruthy();
    expect(r.deductions.incomeTax).toBe(0);
    expect(r.taxMeta.taxCategory).toBe("乙欄");
  });

  it("乙欄・課税ベース105,000円未満は3.063%切り捨てで計算される", () => {
    const r = computePayroll({
      ...base,
      gross: 100_000,
      nonTaxableAllowanceTotal: 0,
      employee: { isSocialInsurance: false, taxCategory: "乙欄" },
    });
    const baseAmount = 100_000 - r.deductions.socialInsuranceTotal;
    expect(r.taxError).toBeUndefined();
    expect(r.deductions.incomeTax).toBe(Math.floor(baseAmount * 0.03063));
  });
});
