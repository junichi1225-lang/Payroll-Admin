// 賞与タブ向けの計算アダプタ。
//
// 賞与専用エンティティ（BonusRun / BonusResult）と月次給与の入力（前月給与）を
// localStorage から橋渡しし、純粋関数 computeBonus（payroll-core）に渡す。
// 月次の構造（PayrollResult / timecard）には書き込まない（読み取りのみ）。
//
// 前月給与の解決順（ユーザー確認済みの方針）:
//   1. 前月分の確定済み（locked）PayrollResult があればその確定値を使う。
//   2. なければ現在のマスタ・打刻から月次計算をその場で再計算（暫定・要警告）。
//   3. 前月給与が 0（新入社員等）なら「前月給与なし」＝特例1。
// 特例2 で前月の源泉税額が要るため、月次計算（loadEmployeeMonthComputation）の
// deductions.incomeTax / socialInsuranceTotal をそのまま利用する。

import {
  AllowanceItem,
  BonusResult,
  BonusRun,
  EmployeeMaster,
  PayrollResult,
  WorkplaceDef,
  normalizeAllowance,
} from "./dummy-data";
import { BonusComputation, computeBonus } from "./payroll-core";
import { loadEmployeeMonthComputation } from "./payrollInputs";
import { DEFAULT_WP_KEY } from "./timeEngine";

/**
 * 非課税手当の合計（社保控除後給与＝課税ベースから除く）。
 * `taxable` 未設定の旧スナップショットは normalizeAllowance で種類から既定値を補完し、
 * 月次（loadEmployeeMonthComputation）と同一の課税ベース算定に揃える。
 */
function nonTaxableTotal(allowances?: AllowanceItem[]): number {
  return (allowances ?? [])
    .map((a) => normalizeAllowance(a))
    .reduce((s, a) => s + (a.taxable ? 0 : a.amount || 0), 0);
}

/**
 * 社会保険料率を引き当てる都道府県。月次（loadEmployeeMonthComputation）と整合させ、
 * 既定事業所→先頭事業所の順で決定する（Object.values の挿入順依存を避ける）。
 */
function resolveBonusPrefecture(workplaces: Record<string, WorkplaceDef>): string {
  const wp = workplaces[DEFAULT_WP_KEY] ?? Object.values(workplaces)[0];
  return wp?.prefecture ?? "東京都";
}

/** "YYYY-MM-DD" の前月を {year, month, ym} で返す。 */
function prevMonthOf(paymentDate: string): { year: number; month: number; ym: string } {
  const [y, m] = paymentDate.split("-").map((v) => parseInt(v, 10));
  let py = y;
  let pm = m - 1;
  if (pm < 1) {
    pm = 12;
    py = y - 1;
  }
  return { year: py, month: pm, ym: `${py}-${String(pm).padStart(2, "0")}` };
}

/** 社会保険の年度（4/1〜3/31）。1〜3月は前年の年度に属する。 */
export function fiscalYearOf(paymentDate: string): number {
  const [y, m] = paymentDate.split("-").map((v) => parseInt(v, 10));
  return m >= 4 ? y : y - 1;
}

export interface PrevMonthSalaryInfo {
  /** 前月の総支給額（0 なら前月給与なし＝特例1） */
  grossSalary: number;
  /** 前月の社会保険料等控除後の給与等の金額（率引き／特例2） */
  salaryAfterSocialInsurance: number;
  /** 前月給与に対する源泉徴収税額（特例2） */
  incomeTax: number;
  /** 前月分が未ロックで現マスタから再計算した暫定値か */
  provisional: boolean;
  /** 解決元（locked=確定値 / recomputed=現マスタ再計算 / none=前月給与なし） */
  source: "locked" | "recomputed" | "none";
  /** 参照した前月 "YYYY-MM" */
  yearMonth: string;
}

/**
 * 賞与支給日の前月給与情報を解決する。
 * locked な PayrollResult があれば確定値を使い、なければ現マスタから再計算する。
 */
export function resolvePrevMonthSalary(
  employeeId: string,
  paymentDate: string,
  employeeDB: Record<string, EmployeeMaster>,
  workplaces: Record<string, WorkplaceDef>,
  payrollResultDB: PayrollResult[],
): PrevMonthSalaryInfo {
  const prev = prevMonthOf(paymentDate);

  const locked = payrollResultDB.find(
    (r) => r.employeeId === employeeId && r.targetYearMonth === prev.ym && r.status === "locked",
  );

  if (locked && locked.deductions) {
    const after = Math.max(
      0,
      locked.totalPayment - nonTaxableTotal(locked.allowances) - locked.deductions.socialInsuranceTotal,
    );
    return {
      grossSalary: locked.totalPayment,
      salaryAfterSocialInsurance: after,
      incomeTax: locked.deductions.incomeTax,
      provisional: false,
      source: locked.totalPayment > 0 ? "locked" : "none",
      yearMonth: prev.ym,
    };
  }

  // 未ロック → 現マスタ・打刻から再計算（暫定）
  const comp = loadEmployeeMonthComputation(
    employeeId,
    prev.year,
    prev.month,
    workplaces,
    employeeDB[employeeId],
  );
  const after = Math.max(
    0,
    comp.totalPayment - nonTaxableTotal(comp.allowances) - comp.deductions.socialInsuranceTotal,
  );
  const hasSalary = comp.totalPayment > 0;
  return {
    grossSalary: comp.totalPayment,
    salaryAfterSocialInsurance: after,
    incomeTax: comp.deductions.incomeTax,
    provisional: hasSalary,
    source: hasSalary ? "recomputed" : "none",
    yearMonth: prev.ym,
  };
}

/**
 * 同一年度の既往の標準賞与額累計（健保系573万円判定）。
 * 当該賞与回（excludeBonusRunId）と異なり、同じ年度・同じ従業員の確定/下書きを合算する。
 */
export function priorCumulativeStandardBonus(
  employeeId: string,
  paymentDate: string,
  excludeBonusRunId: string,
  bonusRunDB: BonusRun[],
  bonusResultDB: BonusResult[],
): number {
  const fy = fiscalYearOf(paymentDate);
  const runById = new Map(bonusRunDB.map((r) => [r.id, r] as const));
  // 573万円判定は「健保系の標準賞与額（上限適用後）」の年度累計。raw な標準賞与額ではなく
  // healthBaseStandardBonus を合算する（健保非該当期間が混じる場合に過大計上を避ける）。
  return bonusResultDB
    .filter((res) => {
      if (res.employeeId !== employeeId) return false;
      if (res.bonusRunId === excludeBonusRunId) return false;
      const run = runById.get(res.bonusRunId);
      if (!run) return false;
      return fiscalYearOf(run.paymentDate) === fy;
    })
    .reduce((s, res) => s + (res.healthBaseStandardBonus || 0), 0);
}

export interface BonusEmployeeComputation {
  computation: BonusComputation;
  prevMonth: PrevMonthSalaryInfo;
  priorCumulative: number;
}

/**
 * 1従業員×賞与回の賞与計算を行う。前月給与の解決・年度累計の集計を内包し、
 * 純粋関数 computeBonus に必要な入力を組み立てて呼び出す。
 */
export function computeBonusForEmployee(
  employeeId: string,
  bonusRun: BonusRun,
  grossBonus: number,
  employeeDB: Record<string, EmployeeMaster>,
  workplaces: Record<string, WorkplaceDef>,
  payrollResultDB: PayrollResult[],
  bonusRunDB: BonusRun[],
  bonusResultDB: BonusResult[],
): BonusEmployeeComputation {
  const employee = employeeDB[employeeId];
  const prevMonth = resolvePrevMonthSalary(
    employeeId,
    bonusRun.paymentDate,
    employeeDB,
    workplaces,
    payrollResultDB,
  );
  const priorCumulative = priorCumulativeStandardBonus(
    employeeId,
    bonusRun.paymentDate,
    bonusRun.id,
    bonusRunDB,
    bonusResultDB,
  );

  const prefecture = resolveBonusPrefecture(workplaces);

  const computation = computeBonus({
    paymentDate: bonusRun.paymentDate,
    prefecture,
    grossBonus,
    employee: employee
      ? {
          isSocialInsurance: employee.isSocialInsurance,
          standardRemuneration: employee.standardRemuneration,
          birthDate: employee.birthDate,
          residentTax: employee.residentTax,
        }
      : undefined,
    priorCumulativeStandardBonus: priorCumulative,
    prevMonth: {
      grossSalary: prevMonth.grossSalary,
      salaryAfterSocialInsurance: prevMonth.salaryAfterSocialInsurance,
      incomeTax: prevMonth.incomeTax,
      provisional: prevMonth.provisional,
    },
  });

  return { computation, prevMonth, priorCumulative };
}

/** 賞与確定スナップショット（BonusResult）を計算結果から構築する。 */
export function buildBonusResult(
  tenantId: string,
  bonusRun: BonusRun,
  employeeId: string,
  grossBonus: number,
  result: BonusEmployeeComputation,
  status: BonusResult["status"],
): BonusResult {
  const { computation, prevMonth } = result;
  const d = computation.deductions;
  return {
    tenantId,
    id: buildBonusResultId(bonusRun.id, employeeId),
    bonusRunId: bonusRun.id,
    employeeId,
    status,
    grossBonus,
    standardBonusAmount: computation.standardBonusAmount,
    healthBaseStandardBonus: computation.healthBaseStandardBonus,
    pensionBaseStandardBonus: computation.pensionBaseStandardBonus,
    healthInsurance: d.health,
    nursingCare: d.nursingCare,
    childSupport: d.childSupport,
    pension: d.pension,
    employmentInsurance: d.employment,
    incomeTax: d.incomeTax,
    socialInsuranceTotal: d.socialInsuranceTotal,
    totalDeduction: d.total,
    netBonus: computation.netBonus,
    lockedAt: status === "locked" ? new Date().toISOString() : null,
    appliedRates: {
      prefecture: computation.appliedRates.prefecture,
      targetYearMonth: computation.appliedRates.targetYearMonth,
      healthInsuranceRate: computation.appliedRates.healthInsuranceRate,
      nursingCareInsuranceRate: computation.appliedRates.nursingCareInsuranceRate,
      pensionInsuranceRate: computation.appliedRates.pensionInsuranceRate,
      childcareSupportRate: computation.appliedRates.childcareSupportRate,
      employmentInsuranceEmployeeRate: computation.appliedRates.employmentInsuranceEmployeeRate,
      taxMethod: computation.taxMethod,
      bonusTaxRate: computation.appliedTaxRate,
      prevMonthSalaryAfterSocialInsurance: prevMonth.salaryAfterSocialInsurance,
      prevMonthProvisional: prevMonth.provisional,
    },
  };
}

export function buildBonusRunId(paymentDate: string): string {
  const compact = paymentDate.replace(/-/g, "");
  return `br_${compact}_${Date.now().toString(36)}`;
}

export function buildBonusResultId(bonusRunId: string, employeeId: string): string {
  return `bres_${bonusRunId}_${employeeId}`;
}
