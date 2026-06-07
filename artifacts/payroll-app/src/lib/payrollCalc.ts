// 給与確定タブ向けのサマリー計算。
//
// PayrollTab（所得税シミュレーター）と数値を一致させるため、計算本体は
// payrollInputs.loadEmployeeMonthComputation に委譲する。こちらは確定
// スナップショット (PayrollResult) 用の薄いラッパーと ID/年月ヘルパーを提供する。

import { AllowanceItem, EmployeeMaster, SalaryType, WorkplaceDef } from "./dummy-data";
import { DeductionBreakdown } from "./payroll-core";
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
  };
}

export function buildPayrollResultId(employeeId: string, year: number, month: number): string {
  const yyyymm = `${year}-${String(month).padStart(2, "0")}`;
  return `pr_${employeeId}_${yyyymm}`;
}

export function toYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
