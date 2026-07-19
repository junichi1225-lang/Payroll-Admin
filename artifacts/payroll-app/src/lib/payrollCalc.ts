// 給与確定タブ向けのサマリー計算。
//
// PayrollTab（所得税シミュレーター）と数値を一致させるため、計算本体は
// payrollInputs.loadEmployeeMonthComputation に委譲する。こちらは確定
// スナップショット (PayrollResult) 用の薄いラッパーと ID/年月ヘルパーを提供する。

import { AllowanceItem, EmployeeMaster, SalaryType, WorkplaceDef } from "./dummy-data";
import { AppliedRateSnapshot, DeductionBreakdown, PayrollTaxMeta } from "./payroll-core";
import { loadEmployeeMonthComputation } from "./payrollInputs";

export interface PayrollSummary {
  appliedSalaryType: SalaryType;
  appliedBaseSalary: number;
  totalWorkingHours: number;
  totalPayment: number;
  totalDeduction: number;
  netPay: number;
  /** 控除内訳（確定スナップショット / 帳票出力用） */
  deductions: DeductionBreakdown;
  /** 当月の手当（給与明細の支給項目内訳用） */
  allowances: AllowanceItem[];
  /** 源泉所得税の計算前提（確定スナップショット用） */
  taxMeta: PayrollTaxMeta;
  /** 計算に適用した料率（確定スナップショット用） */
  appliedRates: AppliedRateSnapshot;
  /** 社会保険料（被保険者負担）控除後の給与額 */
  socialInsuranceDeductedSalary: number;
  /** 当月の源泉徴収税額 */
  withheldIncomeTax: number;
  /** 適用した標準報酬月額（社保未加入・該当なしは 0） */
  appliedStandardRemuneration: number;
  /** 適用した標準報酬月額の履歴レコードID（該当なしは null） */
  appliedStdRemHistoryId: string | null;
  /** 所得税が計算できなかった場合のエラー（設定時は確定不可） */
  taxError?: string;
}

/**
 * 月次給与サマリーを計算する。
 *
 * PayrollTab が localStorage に永続化した入力（給与形態・月給・職場別時給/日給・
 * 打刻・手当）を payrollInputs 経由で読み出し、同一の timeEngine / computePayroll で
 * 総支給・控除を再計算する。これによりシミュレーターと給与確定タブの数値が一致する。
 */
export function computeMonthSummary(
  employeeId: string,
  year: number,
  month: number,
  employeeDB: Record<string, EmployeeMaster>,
  workplaces: Record<string, WorkplaceDef>,
): PayrollSummary {
  const comp = loadEmployeeMonthComputation(
    employeeId,
    year,
    month,
    workplaces,
    employeeDB[employeeId],
  );
  return {
    appliedSalaryType: comp.appliedSalaryType,
    appliedBaseSalary: comp.appliedBaseSalary,
    totalWorkingHours: comp.totalWorkingHours,
    totalPayment: comp.totalPayment,
    totalDeduction: comp.totalDeduction,
    netPay: comp.netPay,
    deductions: comp.deductions,
    allowances: comp.allowances,
    taxMeta: comp.taxMeta,
    appliedRates: comp.appliedRates,
    socialInsuranceDeductedSalary: comp.socialInsuranceDeductedSalary,
    withheldIncomeTax: comp.withheldIncomeTax,
    appliedStandardRemuneration: comp.appliedStandardRemuneration,
    appliedStdRemHistoryId: comp.appliedStdRemHistoryId,
    ...(comp.taxError ? { taxError: comp.taxError } : {}),
  };
}

export function buildPayrollResultId(employeeId: string, year: number, month: number): string {
  const yyyymm = `${year}-${String(month).padStart(2, "0")}`;
  return `pr_${employeeId}_${yyyymm}`;
}

export function toYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
