/**
 * 所得税（源泉徴収）計算モジュール — 令和8年分 検証テスト
 *
 * 元モジュール（ユーザー検証済み incomeTax.ts）に同梱されていた
 * 自己テスト5件を Vitest に移植したもの。期待値は国税庁公表の
 * 計算例および検討過程で確認済みの値に基づく。
 */
import { describe, expect, it } from "vitest";
import { calculateIncomeTax, type IncomeTaxInput } from "./incomeTax";

function input(partial: Partial<IncomeTaxInput>): IncomeTaxInput {
  return {
    taxableAllowanceTotal: 0,
    nonTaxableCommutingAllowance: 0,
    socialInsuranceDeduction: 0,
    taxTableColumn: "kou",
    hasSpouseDeduction: false,
    dependentCount: 0,
    taxYear: 2026,
    ...partial,
  };
}

describe("calculateIncomeTax（令和8年分・電算機特例）", () => {
  it("国税庁計算例1: A=175,000円・配偶者あり・扶養1人 → 210円", () => {
    const r = calculateIncomeTax(
      input({ taxableAllowanceTotal: 175_000, hasSpouseDeduction: true, dependentCount: 1 }),
    );
    expect(r.incomeTax).toBe(210);
    expect(r.method).toBe("kou_denshi_tokurei");
  });

  it("国税庁計算例2: A=446,000円・配偶者あり・扶養7人 → 940円", () => {
    const r = calculateIncomeTax(
      input({ taxableAllowanceTotal: 446_000, hasSpouseDeduction: true, dependentCount: 7 }),
    );
    expect(r.incomeTax).toBe(940);
  });

  it("国税庁計算例3: A=775,200円・配偶者あり・扶養2人 → 59,470円", () => {
    const r = calculateIncomeTax(
      input({ taxableAllowanceTotal: 775_200, hasSpouseDeduction: true, dependentCount: 2 }),
    );
    expect(r.incomeTax).toBe(59_470);
  });

  it("V1想定例: 甲欄・A=300,000円・扶養0人 → 7,910円", () => {
    const r = calculateIncomeTax(input({ taxableAllowanceTotal: 300_000 }));
    expect(r.incomeTax).toBe(7_910);
  });

  it("乙欄・105,000円未満の帯: A=80,750円 → 2,473円", () => {
    const r = calculateIncomeTax(
      input({ taxableAllowanceTotal: 80_750, taxTableColumn: "otsu" }),
    );
    expect(r.incomeTax).toBe(2_473);
    expect(r.method).toBe("otsu_table_lookup_partial");
  });

  it("乙欄・105,000円以上は未実装として例外を投げる（サイレント失敗させない）", () => {
    expect(() =>
      calculateIncomeTax(input({ taxableAllowanceTotal: 200_000, taxTableColumn: "otsu" })),
    ).toThrow(/乙欄の105,000円以上/);
  });

  it("非課税通勤手当と社会保険料は課税ベースから控除される", () => {
    // A = 320,000 − 10,000 − 10,000 = 300,000 → 例4と同額
    const r = calculateIncomeTax(
      input({
        taxableAllowanceTotal: 320_000,
        nonTaxableCommutingAllowance: 10_000,
        socialInsuranceDeduction: 10_000,
      }),
    );
    expect(r.amountAfterSocialInsurance).toBe(300_000);
    expect(r.incomeTax).toBe(7_910);
  });
});
