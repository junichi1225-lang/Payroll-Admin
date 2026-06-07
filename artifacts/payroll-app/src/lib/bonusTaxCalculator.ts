/**
 * 賞与に対する源泉徴収税額の計算（令和8年分・甲欄・扶養親族等0人）
 *
 * 出典: 国税庁「令和8年分 賞与に対する源泉徴収税額の算出率の表」
 *   ＝ 平成24年3月31日財務省告示第115号別表第三（令和7年4月30日財務省告示第122号改正）
 *   https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/15-16.pdf
 *   （一次情報のPDFから甲欄・扶養親族等0人列を直接転記。0%〜45.945%）
 *
 * 【計算手順（SPEC §賞与）】
 *  原則（算出率表）:
 *    1. 前月の社会保険料等控除後の給与等の金額 A_prev で算出率表の行を引く。
 *    2. 率（％・復興特別所得税2.1%込）を取得し、再度 ×1.021 はしない。
 *    3. 源泉徴収税額 = (賞与額 − 賞与の社会保険料) × 率。円未満切捨て。
 *  特例1（前月に通常の給与がない場合）:
 *    (賞与 − 賞与社保) ÷ 6 を月額表(甲欄)に当てはめ、税額 × 6。
 *  特例2（賞与の社保控除後額が前月の社保控除後給与の10倍超）:
 *    (賞与 − 賞与社保) ÷ 6 ＋ 前月の社保控除後給与 を月額表(甲欄)に当てはめ、
 *    その税額 − 前月給与に対する源泉徴収税額、を × 6。
 *  ※ いずれも賞与計算期間は既定6か月（÷6・×6）。6か月超の÷12・×12は未対応（TODO）。
 *
 * 【スコープ】甲欄・扶養親族等0人で固定（月次の所得税計算と同じ前提）。
 */

import { calculateIncomeTax } from "./taxCalculator";

/**
 * 賞与の金額に乗ずべき率の表（甲欄・扶養親族等0人・令和8年分）。
 * 各要素は `[前月の社会保険料等控除後給与の下限(以上・円), 率(%)]`。
 * 区分は `[下限, 次要素の下限)` の「以上〜未満」。最終区分は上限なし。
 * 率は復興特別所得税(2.1%)込み。3桁の小数をそのまま保持する。
 * （国税庁 15-16.pdf の甲欄・扶養0人列をそのまま転記。千円単位を円に換算済み）
 */
const BONUS_RATE_TABLE_KOU_0: ReadonlyArray<readonly [number, number]> = [
  [0, 0.0],
  [82_000, 2.042],
  [94_000, 4.084],
  [260_000, 6.126],
  [309_000, 8.168],
  [342_000, 10.21],
  [372_000, 12.252],
  [402_000, 14.294],
  [433_000, 16.336],
  [520_000, 18.378],
  [605_000, 20.42],
  [684_000, 22.462],
  [715_000, 24.504],
  [752_000, 26.546],
  [795_000, 28.588],
  [854_000, 30.63],
  [922_000, 32.672],
  [1_318_000, 35.735],
  [1_521_000, 38.798],
  [2_621_000, 41.861],
  [3_495_000, 45.945],
];

/**
 * 前月の社会保険料等控除後の給与等の金額から「賞与の金額に乗ずべき率(%)」を求める。
 * @param prevSalaryAfterSocialInsurance 前月の社保控除後給与（円）
 * @returns 率（%）。例: 20.42
 */
export function bonusTaxRate(prevSalaryAfterSocialInsurance: number): number {
  const a = Math.floor(Math.max(0, prevSalaryAfterSocialInsurance));
  let rate = 0;
  for (const [lower, r] of BONUS_RATE_TABLE_KOU_0) {
    if (a >= lower) rate = r;
    else break;
  }
  return rate;
}

/** 賞与源泉所得税の計算方式。 */
export type BonusTaxMethod = "rate-table" | "special-no-prev-salary" | "special-over-10x";

export interface BonusIncomeTaxInput {
  /** 賞与の社会保険料控除後の金額（賞与総額 − 賞与の社会保険料・被保険者負担合計） */
  bonusAfterSocialInsurance: number;
  /** 前月の総支給額（0 なら「前月給与なし」＝特例1） */
  prevMonthGrossSalary: number;
  /** 前月の社会保険料等控除後の給与等の金額（率の引き当て／特例2に使用） */
  prevMonthSalaryAfterSocialInsurance: number;
  /** 前月給与に対する源泉徴収税額（特例2に使用） */
  prevMonthIncomeTax: number;
}

export interface BonusIncomeTaxResult {
  /** 源泉徴収税額（円・整数） */
  incomeTax: number;
  /** 適用した計算方式 */
  method: BonusTaxMethod;
  /** 算出率表を使った場合の率(%)。特例の場合は null。 */
  appliedRate: number | null;
}

/** 賞与計算期間の既定月数（÷6・×6）。6か月超の÷12は未対応（TODO）。 */
const BONUS_PERIOD_MONTHS = 6;

/**
 * 賞与に対する源泉徴収税額を求める（甲欄・扶養0人・令和8年分）。
 * 原則は算出率表、前月給与の有無・10倍超で2つの特例に分岐する。
 */
export function calcBonusIncomeTax(input: BonusIncomeTaxInput): BonusIncomeTaxResult {
  const bonusAfterSI = Math.max(0, Math.floor(input.bonusAfterSocialInsurance));
  const prevAfterSI = Math.max(0, Math.floor(input.prevMonthSalaryAfterSocialInsurance));

  // 特例1: 前月に通常の給与がない場合
  if (input.prevMonthGrossSalary <= 0) {
    const monthly = calculateIncomeTax(Math.floor(bonusAfterSI / BONUS_PERIOD_MONTHS));
    return { incomeTax: monthly * BONUS_PERIOD_MONTHS, method: "special-no-prev-salary", appliedRate: null };
  }

  // 特例2: 賞与の社保控除後額が、前月の社保控除後給与の10倍を超える場合
  if (bonusAfterSI > prevAfterSI * 10) {
    const base = Math.floor(bonusAfterSI / BONUS_PERIOD_MONTHS) + prevAfterSI;
    const perMonth = Math.max(0, calculateIncomeTax(base) - Math.max(0, Math.floor(input.prevMonthIncomeTax)));
    return { incomeTax: perMonth * BONUS_PERIOD_MONTHS, method: "special-over-10x", appliedRate: null };
  }

  // 原則: 算出率表
  const rate = bonusTaxRate(prevAfterSI);
  const incomeTax = Math.floor(bonusAfterSI * (rate / 100)); // 円未満切捨て
  return { incomeTax, method: "rate-table", appliedRate: rate };
}
