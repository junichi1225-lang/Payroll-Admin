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
 *     - 所得税は令和8年分モジュール（incomeTax.ts）内で丸め（甲欄=10円未満四捨五入、
 *       乙欄<105,000円=円未満切り捨て）まで実施済みの値を用いる。本モジュールでは
 *       追加の丸めを行わない（floorYen の二重適用禁止）。
 *
 * 【負担ベース】
 * - 健康・介護・厚年・子ども子育て支援金: 標準報酬月額ベース（料率は労使合計→×0.5）。
 * - 雇用保険: 総支給額ベース（料率は労働者負担そのもの＝折半不要）。
 * - 所得税の課税ベース: 総支給 − 非課税手当 − 社会保険料（被保険者負担合計）。
 */

import { resolveRates } from "@/lib/constants/rates";
import { isNursingCareInsuranceTarget } from "@/lib/insurance";
import { calculateIncomeTax } from "./incomeTax";

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

/** 源泉所得税の税額表 欄区分（従業員マスタの自己申告に準ずる）。 */
export type PayrollTaxCategory = "甲欄" | "乙欄";

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
  /** 税額表の欄区分（未指定は甲欄扱い） */
  taxCategory?: PayrollTaxCategory;
  /**
   * 育休・産休中フラグ。true の場合、健康保険料・介護保険料・厚生年金保険料・
   * 子ども子育て支援金の控除を 0 にする（雇用保険・所得税・住民税は通常通り）。
   */
  onParentalLeave?: boolean;
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

/** 源泉所得税の計算前提（確定スナップショット保存用）。 */
export interface PayrollTaxMeta {
  /** 適用した税額表の年分（2026 = 令和8年分） */
  taxYear: number;
  /** 適用した欄区分 */
  taxCategory: PayrollTaxCategory;
  /** 計算に使用した源泉控除対象親族の数（V1 は常に 0） */
  dependentCount: number;
}

/** 確定スナップショット用: 計算に適用した各料率。 */
export interface AppliedRateSnapshot {
  /** 健康保険料率（労使合計） */
  healthInsuranceRate: number;
  /** 介護保険料率（労使合計） */
  nursingCareInsuranceRate: number;
  /** 厚生年金保険料率（労使合計） */
  pensionInsuranceRate: number;
  /** 子ども子育て支援金率（労使合計） */
  childcareSupportRate: number;
  /** 雇用保険・労働者負担率 */
  employmentInsuranceEmployeeRate: number;
}

export interface PayrollComputation {
  gross: number;
  deductions: DeductionBreakdown;
  netPay: number;
  /** 源泉所得税の計算前提 */
  taxMeta: PayrollTaxMeta;
  /** 計算に適用した料率（確定スナップショット保存用） */
  appliedRates: AppliedRateSnapshot;
  /** 社会保険料（被保険者負担）控除後の給与額。賞与計算が前月実績として参照する */
  socialInsuranceDeductedSalary: number;
  /** 当月の源泉徴収税額（= deductions.incomeTax）。賞与計算が前月実績として参照する */
  withheldIncomeTax: number;
  /**
   * 所得税が計算できなかった場合のエラーメッセージ（例: 乙欄・105,000円以上は未実装）。
   * 設定されている場合、incomeTax は 0 のままであり、この計算結果で給与を
   * 確定（ロック）してはならない。UI は必ずエラーを表示すること。
   */
  taxError?: string;
}

// ───────────────────────────────────────────────────────────
// 標準報酬月額 履歴引き当て
// ───────────────────────────────────────────────────────────

/** 標準報酬月額の履歴レコード（コアが必要とするフィールドのみ）。 */
export interface StandardRemunerationHistoryInput {
  id: string;
  employeeId: string;
  amount: number;
  /** 効力開始年月 "YYYY-MM" */
  effectiveFrom: string;
  /** 効力終了年月 "YYYY-MM"。null = 現在有効 */
  effectiveTo: string | null;
}

/**
 * 対象年月に有効な標準報酬月額履歴を1件引き当てる純粋関数。
 * "YYYY-MM" 文字列は辞書順比較で年月比較と一致する。
 * 該当なしの場合は null（呼び出し側で 0 円扱い＝社保未加入相当）。
 * 複数該当（期間重複）の場合は effectiveFrom が最新のものを採用する。
 */
export function getStandardRemuneration(
  histories: StandardRemunerationHistoryInput[],
  employeeId: string,
  targetYearMonth: string,
): StandardRemunerationHistoryInput | null {
  const matches = histories.filter(
    (h) =>
      h.employeeId === employeeId &&
      h.effectiveFrom <= targetYearMonth &&
      (h.effectiveTo == null || targetYearMonth <= h.effectiveTo),
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a));
}

// ───────────────────────────────────────────────────────────
// 住民税 履歴引き当て（年度2値: 6月分 / 7月以降）
// ───────────────────────────────────────────────────────────

/** 住民税の履歴レコード（コアが必要とするフィールドのみ）。 */
export interface ResidentTaxHistoryInput {
  id: string;
  employeeId: string;
  /** 年度（6月開始）。例: 2026 = 2026年6月〜2027年5月 */
  fiscalYear: number;
  /** 6月（初月）の月額 */
  juneAmount: number;
  /** 7月〜翌5月の月額 */
  regularAmount: number;
}

/** 対象年月 "YYYY-MM" が属する住民税の年度（6月開始）。1〜5月は前年の年度。 */
export function residentTaxFiscalYearOf(targetYearMonth: string): number {
  const [y, m] = targetYearMonth.split("-").map((v) => parseInt(v, 10));
  return m >= 6 ? y : y - 1;
}

/**
 * 対象年月の住民税控除額を引き当てる純粋関数。
 * - 対象月が6月 → juneAmount、7月〜翌5月 → regularAmount
 * - 該当年度のレコードがなければ、それ以前で最も新しい年度のレコードに
 *   フォールバックする（旧・単一値からの移行データで過去月の計算結果を
 *   変えないための措置）。それも無ければ最も古いレコード。
 * - レコードが1件もなければ null。
 */
export function getResidentTax(
  histories: ResidentTaxHistoryInput[],
  employeeId: string,
  targetYearMonth: string,
): { amount: number; record: ResidentTaxHistoryInput } | null {
  const own = histories.filter((h) => h.employeeId === employeeId);
  if (own.length === 0) return null;
  const fy = residentTaxFiscalYearOf(targetYearMonth);
  const exact = own.filter((h) => h.fiscalYear === fy);
  const earlier = own.filter((h) => h.fiscalYear < fy);
  const record =
    exact.length > 0
      ? exact.reduce((a, b) => (b.fiscalYear > a.fiscalYear ? b : a))
      : earlier.length > 0
        ? earlier.reduce((a, b) => (b.fiscalYear > a.fiscalYear ? b : a))
        : own.reduce((a, b) => (b.fiscalYear < a.fiscalYear ? b : a));
  const month = parseInt(targetYearMonth.split("-")[1], 10);
  const amount = month === 6 ? record.juneAmount : record.regularAmount;
  return { amount, record };
}

// ───────────────────────────────────────────────────────────
// 契約・単価 履歴引き当て
// ───────────────────────────────────────────────────────────

/** 契約履歴レコード（コアが必要とするフィールドのみ）。 */
export interface ContractHistoryInput {
  id: string;
  employeeId: string;
  /** null = 派遣先を特定しない基本契約 */
  workplaceId: string | null;
  wageType: "monthly" | "daily" | "hourly";
  wageAmount: number;
  /** 効力開始日 "YYYY-MM-DD" */
  effectiveFrom: string;
  /** 効力終了日 "YYYY-MM-DD"。null = 現在有効 */
  effectiveTo: string | null;
}

/**
 * 対象日 "YYYY-MM-DD" に有効な契約を1件引き当てる純粋関数。
 * - workplaceId を指定した場合: その職場の契約を優先し、無ければ基本契約
 *   （workplaceId = null）へフォールバックする（ヘルプ出勤対応）。
 * - workplaceId 未指定（null）の場合: 基本契約のみ対象。
 * - 複数該当時は effectiveFrom が最新のものを採用。該当なしは null。
 */
export function getActiveContract(
  contracts: ContractHistoryInput[],
  employeeId: string,
  targetDate: string,
  workplaceId: string | null = null,
): ContractHistoryInput | null {
  const inEffect = (c: ContractHistoryInput) =>
    c.employeeId === employeeId &&
    c.effectiveFrom <= targetDate &&
    (c.effectiveTo == null || targetDate <= c.effectiveTo);
  const pick = (list: ContractHistoryInput[]) =>
    list.length === 0
      ? null
      : list.reduce((a, b) => (b.effectiveFrom > a.effectiveFrom ? b : a));
  if (workplaceId != null) {
    const specific = pick(contracts.filter((c) => inEffect(c) && c.workplaceId === workplaceId));
    if (specific) return specific;
  }
  return pick(contracts.filter((c) => inEffect(c) && c.workplaceId == null));
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

  const taxCategory: PayrollTaxCategory = employee?.taxCategory ?? "甲欄";
  const taxMeta: PayrollTaxMeta = { taxYear: 2026, taxCategory, dependentCount: 0 };

  const rates = resolveRates(prefecture, targetYearMonth);
  const appliedRates: AppliedRateSnapshot = {
    healthInsuranceRate: rates.healthInsuranceRate,
    nursingCareInsuranceRate: rates.nursingCareInsuranceRate,
    pensionInsuranceRate: rates.pensionInsuranceRate,
    childcareSupportRate: rates.childcareSupportRate,
    employmentInsuranceEmployeeRate: rates.employmentInsuranceEmployeeRate,
  };

  if (gross <= 0) {
    return {
      gross: Math.max(0, gross),
      deductions: { ...EMPTY_DEDUCTIONS },
      netPay: Math.max(0, gross),
      taxMeta,
      appliedRates,
      socialInsuranceDeductedSalary: Math.max(0, gross),
      withheldIncomeTax: 0,
    };
  }

  // 育休・産休中は社会保険料（健康・介護・厚年・支援金）の控除を免除する。
  // 雇用保険・所得税・住民税は通常どおり計算する。
  const onLeave = !!employee?.onParentalLeave;
  const enrolled = !onLeave && !!employee?.isSocialInsurance && (employee?.standardRemuneration ?? 0) > 0;
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

  // 所得税: 令和8年分モジュール（甲欄=電算機特例・10円未満四捨五入は内部で実施）。
  // 課税ベース = 総支給 − 非課税手当 − 社会保険料（被保険者負担）を内部で算出する。
  // 乙欄・社保控除後105,000円以上は未実装のため例外が投げられる。サイレントに
  // 握りつぶさず、taxError として呼び出し側（UI）へ伝搬させる。
  let incomeTax = 0;
  let taxError: string | undefined;
  try {
    incomeTax = calculateIncomeTax({
      taxableAllowanceTotal: gross,
      nonTaxableCommutingAllowance: Math.max(0, nonTaxableAllowanceTotal),
      socialInsuranceDeduction: socialInsuranceTotal,
      taxTableColumn: taxCategory === "乙欄" ? "otsu" : "kou",
      hasSpouseDeduction: false, // V1: 配偶者控除は未対応（常に false）
      dependentCount: taxMeta.dependentCount, // V1: 扶養親族は常に 0
      taxYear: 2026,
    }).incomeTax;
  } catch (e) {
    taxError =
      e instanceof Error
        ? e.message
        : "所得税を計算できませんでした（未対応のケースです）。";
  }

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
    taxMeta,
    appliedRates,
    socialInsuranceDeductedSalary: Math.max(0, gross - socialInsuranceTotal),
    withheldIncomeTax: incomeTax,
    ...(taxError ? { taxError } : {}),
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
