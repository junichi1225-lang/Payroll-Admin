/**
 * 給与計算コア（純粋関数）
 *
 * PayrollTab（シミュレーター）と PayrollFinalizationTab（給与確定）の双方が
 * この `computePayroll` を共用し、同一入力に対して必ず同一の控除内訳・差引支給を返す。
 *
 * 【設計方針】
 * - 副作用なし: localStorage 等の I/O は一切持たない。整形済みデータのみ受け取る。
 * - 料率は `resolveRates(prefecture, targetYearMonth)` から取得した束のみ参照。
 * - 端数処理を本モジュールに集約:
 *     - 社会保険（健康・介護・厚年・支援金）と雇用保険の被保険者負担は
 *       労使折半後に「50銭ルール」（端数50銭以下=切り捨て / 50銭超=切り上げ）。
 *     - 所得税は円未満切り捨て。
 *
 * 【負担ベース】
 * - 健康・介護・厚年・子ども子育て支援金: 標準報酬月額ベース（料率は労使合計→×0.5）。
 * - 雇用保険: 総支給額ベース（料率は労働者負担そのもの＝折半不要）。
 * - 所得税の課税ベース: 総支給 − 非課税手当 − 社会保険料（被保険者負担合計）。
 */

import { resolveRates } from "@/lib/constants/rates";
import { isNursingCareInsuranceTarget } from "@/lib/insurance";
import { calculateIncomeTax } from "@/lib/taxCalculator";

// ───────────────────────────────────────────────────────────
// 端数処理
// ───────────────────────────────────────────────────────────

/**
 * 50銭ルールによる丸め。
 * 端数が50銭以下なら切り捨て、50銭を超えるなら切り上げ。
 * （給与から控除する被保険者負担額の慣行的な端数処理）
 */
export function round50sen(value: number): number {
  if (value <= 0) return 0;
  const floor = Math.floor(value);
  const frac = value - floor;
  // 浮動小数の誤差を吸収するため微小マージンを加味
  return frac <= 0.5 + 1e-9 ? floor : floor + 1;
}

/** 円未満切り捨て（所得税など）。 */
export function floorYen(value: number): number {
  return value > 0 ? Math.floor(value) : 0;
}

// ───────────────────────────────────────────────────────────
// 入出力型
// ───────────────────────────────────────────────────────────

/** 計算対象の従業員マスタ部分集合（コアが必要とするフィールドのみ）。 */
export interface PayrollEmployeeInput {
  /** 社会保険加入フラグ */
  isSocialInsurance: boolean;
  /** 標準報酬月額（円） */
  standardRemuneration: number;
  /** 生年月日 "YYYY-MM-DD"（介護第2号判定に使用） */
  birthDate: string;
  /** 住民税（決定通知書の月額・円） */
  residentTax: number;
}

export interface ComputePayrollInput {
  /** 対象年月 "YYYY-MM" */
  targetYearMonth: string;
  /** 料率引き当てに使う都道府県 */
  prefecture: string;
  /** 総支給額（基本給＋手当・社会保険料控除前） */
  gross: number;
  /** 非課税手当の合計（通勤手当など）。所得税の課税ベースから控除する。 */
  nonTaxableAllowanceTotal: number;
  /** 従業員マスタ（未設定なら社会保険控除は 0） */
  employee?: PayrollEmployeeInput;
}

export interface DeductionBreakdown {
  /** 健康保険料（労使折半後の従業員負担） */
  health: number;
  /** 介護保険料（40歳以上の従業員負担） */
  nursingCare: number;
  /** 子ども子育て支援金（従業員負担） */
  childcare: number;
  /** 厚生年金保険料（従業員負担） */
  pension: number;
  /** 雇用保険料（従業員負担） */
  labor: number;
  /** 所得税（源泉徴収） */
  incomeTax: number;
  /** 住民税 */
  residentTax: number;
  /** 社会保険料（健康・介護・厚年・支援金・雇用）の被保険者負担合計 */
  socialInsuranceTotal: number;
  /** 控除合計 */
  total: number;
  /** 介護保険第2号被保険者該当か */
  isNursingCareTarget: boolean;
}

export interface PayrollComputation {
  gross: number;
  deductions: DeductionBreakdown;
  netPay: number;
}

const EMPTY_DEDUCTIONS: DeductionBreakdown = {
  health: 0, nursingCare: 0, childcare: 0, pension: 0, labor: 0,
  incomeTax: 0, residentTax: 0, socialInsuranceTotal: 0, total: 0,
  isNursingCareTarget: false,
};

// ───────────────────────────────────────────────────────────
// コア計算
// ───────────────────────────────────────────────────────────

/**
 * 給与の控除内訳と差引支給を算出する純粋関数。
 * 入力 `gross` は呼び出し側（アダプタ）が算出済みの総支給額を渡す。
 */
export function computePayroll(input: ComputePayrollInput): PayrollComputation {
  const { targetYearMonth, prefecture, gross, nonTaxableAllowanceTotal, employee } = input;

  if (gross <= 0) {
    return { gross: Math.max(0, gross), deductions: { ...EMPTY_DEDUCTIONS }, netPay: Math.max(0, gross) };
  }

  const rates = resolveRates(prefecture, targetYearMonth);

  const enrolled = !!employee?.isSocialInsurance && (employee?.standardRemuneration ?? 0) > 0;
  const standardRem = enrolled ? employee!.standardRemuneration : 0;
  const isNursingCareTarget = enrolled && employee
    ? isNursingCareInsuranceTarget(employee.birthDate, targetYearMonth)
    : false;

  // 標準報酬ベース・労使折半（×0.5）後に50銭ルール
  const health = enrolled ? round50sen(standardRem * rates.healthInsuranceRate * 0.5) : 0;
  const nursingCare = isNursingCareTarget ? round50sen(standardRem * rates.nursingCareInsuranceRate * 0.5) : 0;
  const pension = enrolled ? round50sen(standardRem * rates.pensionInsuranceRate * 0.5) : 0;
  const childcare = enrolled ? round50sen(standardRem * rates.childcareSupportRate * 0.5) : 0;

  // 雇用保険は総支給ベース・労働者負担率（折半不要）→ 50銭ルール
  const labor = round50sen(gross * rates.employmentInsuranceEmployeeRate);

  const socialInsuranceTotal = health + nursingCare + pension + childcare + labor;

  // 所得税: 課税ベース = 総支給 − 非課税手当 − 社会保険料（被保険者負担）
  const taxableBase = Math.max(0, gross - Math.max(0, nonTaxableAllowanceTotal) - socialInsuranceTotal);
  const incomeTax = floorYen(calculateIncomeTax(taxableBase));

  // 住民税: マスタの決定額をそのまま引き当て
  const residentTax = employee?.residentTax ?? 0;

  const total = socialInsuranceTotal + incomeTax + residentTax;

  return {
    gross,
    deductions: {
      health, nursingCare, childcare, pension, labor,
      incomeTax, residentTax, socialInsuranceTotal, total, isNursingCareTarget,
    },
    netPay: Math.max(0, gross - total),
  };
}

// ───────────────────────────────────────────────────────────
// 賞与計算（第2エントリポイント）の再エクスポート
// ───────────────────────────────────────────────────────────
export {
  computeBonus,
  HEALTH_STANDARD_BONUS_ANNUAL_CAP,
  PENSION_STANDARD_BONUS_PER_TIME_CAP,
  type ComputeBonusInput,
  type ComputeBonusPrevMonth,
  type BonusComputation,
  type BonusDeductionBreakdown,
} from "./bonus";
