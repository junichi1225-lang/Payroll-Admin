/**
 * 賞与計算コア（純粋関数）— calc-core の第2エントリポイント。
 *
 * 月次給与（computePayroll）とは独立した賞与専用の計算。社会保険料・標準賞与額の
 * 上限・源泉所得税（算出率表＋特例）を一括で算出する。副作用なし（localStorage 等の
 * I/O は持たない）。料率は `resolveRates` から、源泉税は `calcBonusIncomeTax` から取得。
 *
 * 【賞与の社会保険料の特徴（月次との差異）】
 * - 標準賞与額 = 賞与総額の 1,000円未満切捨て。
 * - 健保系（健康・介護・支援金）: 年度（4/1〜3/31）累計 573万円が上限。
 * - 厚年系（厚生年金）: 1回あたり 150万円が上限。
 * - 雇用保険: 賞与総額ベース（標準賞与額ではなく総額・1,000円未満切捨てなし）。
 * - 端数は月次と同じ「50銭ルール」。源泉所得税は円未満切捨て。
 * - 住民税は賞与にはかからない（月次のみ）。
 */

import { resolveRates } from "@/lib/constants/rates";
import { isNursingCareInsuranceTarget } from "@/lib/insurance";
import {
  calcBonusIncomeTax,
  type BonusTaxMethod,
} from "@/lib/bonusTaxCalculator";
import { round50sen, type PayrollEmployeeInput } from "./index";

/** 健保系（健康・介護・支援金）標準賞与額の年度累計上限（円）。 */
export const HEALTH_STANDARD_BONUS_ANNUAL_CAP = 5_730_000;
/** 厚年系標準賞与額の1回あたり上限（円）。 */
export const PENSION_STANDARD_BONUS_PER_TIME_CAP = 1_500_000;

export interface ComputeBonusPrevMonth {
  /** 前月の総支給額（0 なら「前月給与なし」＝特例1） */
  grossSalary: number;
  /** 前月の社会保険料等控除後の給与等の金額（率の引き当て／特例2） */
  salaryAfterSocialInsurance: number;
  /** 前月給与に対する源泉徴収税額（特例2） */
  incomeTax: number;
  /** 前月分が未ロックで現マスタから再計算した暫定値か */
  provisional: boolean;
}

export interface ComputeBonusInput {
  /** 賞与支給日 "YYYY-MM-DD"（料率引き当ての年月＝この月で確定） */
  paymentDate: string;
  /** 料率引き当てに使う都道府県 */
  prefecture: string;
  /** 賞与総支給額（社会保険料控除前） */
  grossBonus: number;
  /** 従業員マスタ部分集合（未設定なら社会保険控除は 0） */
  employee?: PayrollEmployeeInput;
  /** 同一年度の既往の標準賞与額累計（健保系 573万円判定に使用） */
  priorCumulativeStandardBonus: number;
  /** 前月給与情報（源泉所得税の率引き当て・特例判定） */
  prevMonth: ComputeBonusPrevMonth;
}

export interface BonusDeductionBreakdown {
  health: number;
  nursingCare: number;
  childSupport: number;
  pension: number;
  employment: number;
  incomeTax: number;
  socialInsuranceTotal: number;
  total: number;
  isNursingCareTarget: boolean;
}

export interface BonusComputation {
  grossBonus: number;
  /** 標準賞与額（1,000円未満切捨て） */
  standardBonusAmount: number;
  /** 健保系の標準賞与額（年度573万円累計でカット後） */
  healthBaseStandardBonus: number;
  /** 厚年系の標準賞与額（1回150万円でカット後） */
  pensionBaseStandardBonus: number;
  deductions: BonusDeductionBreakdown;
  netBonus: number;
  /** 健保系が年度上限に達したか */
  healthCapReached: boolean;
  /** 厚年系が1回上限に達したか */
  pensionCapReached: boolean;
  /** 源泉所得税の計算方式 */
  taxMethod: BonusTaxMethod;
  /** 算出率表を使った場合の率(%)。特例は null。 */
  appliedTaxRate: number | null;
  /** 引き当てた料率・前提のスナップショット */
  appliedRates: {
    prefecture: string;
    targetYearMonth: string;
    healthInsuranceRate: number;
    nursingCareInsuranceRate: number;
    pensionInsuranceRate: number;
    childcareSupportRate: number;
    employmentInsuranceEmployeeRate: number;
  };
}

/** "YYYY-MM-DD" → "YYYY-MM"。 */
function yearMonthOf(paymentDate: string): string {
  return paymentDate.slice(0, 7);
}

const EMPTY_BREAKDOWN: BonusDeductionBreakdown = {
  health: 0, nursingCare: 0, childSupport: 0, pension: 0, employment: 0,
  incomeTax: 0, socialInsuranceTotal: 0, total: 0, isNursingCareTarget: false,
};

/**
 * 賞与の控除内訳・差引支給を算出する純粋関数。
 * @see calcBonusIncomeTax 源泉所得税（算出率表＋特例）
 */
export function computeBonus(input: ComputeBonusInput): BonusComputation {
  const { paymentDate, prefecture, grossBonus, employee, priorCumulativeStandardBonus, prevMonth } = input;
  const targetYearMonth = yearMonthOf(paymentDate);
  const rates = resolveRates(prefecture, targetYearMonth);

  const appliedRates = {
    prefecture,
    targetYearMonth,
    healthInsuranceRate: rates.healthInsuranceRate,
    nursingCareInsuranceRate: rates.nursingCareInsuranceRate,
    pensionInsuranceRate: rates.pensionInsuranceRate,
    childcareSupportRate: rates.childcareSupportRate,
    employmentInsuranceEmployeeRate: rates.employmentInsuranceEmployeeRate,
  };

  if (grossBonus <= 0) {
    return {
      grossBonus: Math.max(0, grossBonus),
      standardBonusAmount: 0,
      healthBaseStandardBonus: 0,
      pensionBaseStandardBonus: 0,
      deductions: { ...EMPTY_BREAKDOWN },
      netBonus: Math.max(0, grossBonus),
      healthCapReached: false,
      pensionCapReached: false,
      taxMethod: "rate-table",
      appliedTaxRate: 0,
      appliedRates,
    };
  }

  // 標準賞与額: 1,000円未満切捨て
  const standardBonusAmount = Math.floor(grossBonus / 1000) * 1000;

  const enrolled = !!employee?.isSocialInsurance;
  const isNursingCareTarget = enrolled && employee
    ? isNursingCareInsuranceTarget(employee.birthDate, targetYearMonth)
    : false;

  // 健保系（健康・介護・支援金）標準賞与額: 年度累計573万円が上限
  const remainingHealthCap = Math.max(0, HEALTH_STANDARD_BONUS_ANNUAL_CAP - Math.max(0, priorCumulativeStandardBonus));
  const healthBaseStandardBonus = enrolled ? Math.min(standardBonusAmount, remainingHealthCap) : 0;
  const healthCapReached = enrolled && healthBaseStandardBonus < standardBonusAmount;

  // 厚年系標準賞与額: 1回150万円が上限
  const pensionBaseStandardBonus = enrolled ? Math.min(standardBonusAmount, PENSION_STANDARD_BONUS_PER_TIME_CAP) : 0;
  const pensionCapReached = enrolled && standardBonusAmount > PENSION_STANDARD_BONUS_PER_TIME_CAP;

  // 社会保険料（被保険者負担）: 折半後（×0.5）に50銭ルール
  const health = enrolled ? round50sen(healthBaseStandardBonus * rates.healthInsuranceRate * 0.5) : 0;
  const nursingCare = isNursingCareTarget ? round50sen(healthBaseStandardBonus * rates.nursingCareInsuranceRate * 0.5) : 0;
  const childSupport = enrolled ? round50sen(healthBaseStandardBonus * rates.childcareSupportRate * 0.5) : 0;
  const pension = enrolled ? round50sen(pensionBaseStandardBonus * rates.pensionInsuranceRate * 0.5) : 0;
  // 雇用保険: 賞与総額ベース・労働者負担率（折半不要・標準賞与額ではない）
  const employment = round50sen(grossBonus * rates.employmentInsuranceEmployeeRate);

  const socialInsuranceTotal = health + nursingCare + childSupport + pension + employment;

  // 源泉所得税: 賞与の社保控除後額に算出率表（または特例）を適用
  const bonusAfterSI = Math.max(0, grossBonus - socialInsuranceTotal);
  const tax = calcBonusIncomeTax({
    bonusAfterSocialInsurance: bonusAfterSI,
    prevMonthGrossSalary: prevMonth.grossSalary,
    prevMonthSalaryAfterSocialInsurance: prevMonth.salaryAfterSocialInsurance,
    prevMonthIncomeTax: prevMonth.incomeTax,
  });

  const total = socialInsuranceTotal + tax.incomeTax;

  return {
    grossBonus,
    standardBonusAmount,
    healthBaseStandardBonus,
    pensionBaseStandardBonus,
    deductions: {
      health, nursingCare, childSupport, pension, employment,
      incomeTax: tax.incomeTax, socialInsuranceTotal, total, isNursingCareTarget,
    },
    netBonus: Math.max(0, grossBonus - total),
    healthCapReached,
    pensionCapReached,
    taxMethod: tax.method,
    appliedTaxRate: tax.appliedRate,
    appliedRates,
  };
}
