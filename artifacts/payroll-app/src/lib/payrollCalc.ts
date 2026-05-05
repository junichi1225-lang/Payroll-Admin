// 給与確定タブ向けの軽量サマリー計算。
// PayrollTab の精緻な5区分計算とは独立した「実働時間 × 単価」ベースの簡易ロジック。
// 確定スナップショット (PayrollResult) 用の参照値を生成する目的。

import {
  ContractMaster,
  DEFAULT_TENANT_ID,
  EmployeeMaster,
  SalaryType,
  TimecardEntry,
  getTimecardEntries,
} from "./dummy-data";
import { calculateHealthInsurance } from "./insurance";
import { calculateIncomeTax } from "./taxCalculator";

const DEFAULT_BREAK_MINUTES = 60;

interface StoredRow {
  ocrStatus?: string;
  ocrStart?: string;
  ocrEnd?: string;
  stdStart?: string;
  stdEnd?: string;
  editStart?: string;
  editEnd?: string;
  breakMinutes?: number;
}

function toMin(t: string | undefined): number {
  if (!t || t === "--:--") return -1;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

function calcHours(start: string | undefined, end: string | undefined): number {
  const s = toMin(start);
  let e = toMin(end);
  if (s < 0 || e < 0) return 0;
  if (e <= s) e += 1440;
  return (e - s) / 60;
}

function loadRows(employeeId: string, year: number, month: number): StoredRow[] {
  const key = `timecard_${DEFAULT_TENANT_ID}_${employeeId}_${year}_${month}`;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as StoredRow[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* fall through to seed data */
  }
  // フォールバック: シードのダミー打刻
  const entries: TimecardEntry[] = getTimecardEntries(employeeId, year, month);
  return entries.map((e) => ({
    ocrStatus: e.ocrStatus,
    ocrStart: e.ocrStart,
    ocrEnd: e.ocrEnd,
    stdStart: e.stdStart,
    stdEnd: e.stdEnd,
    editStart: "",
    editEnd: "",
    breakMinutes: DEFAULT_BREAK_MINUTES,
  }));
}

export function calcTotalWorkingHours(
  employeeId: string,
  year: number,
  month: number,
): number {
  const rows = loadRows(employeeId, year, month);
  return rows.reduce((sum, r) => {
    const start = r.editStart || r.stdStart;
    const end = r.editEnd || r.stdEnd;
    const gross = calcHours(start, end);
    if (gross <= 0) return sum;
    const breakHours = (r.breakMinutes ?? DEFAULT_BREAK_MINUTES) / 60;
    return sum + Math.max(0, gross - breakHours);
  }, 0);
}

export interface PayrollSummary {
  appliedSalaryType: SalaryType;
  appliedBaseSalary: number;
  totalWorkingHours: number;
  totalPayment: number;
  totalDeduction: number;
  netPay: number;
}

/**
 * 月次給与サマリーを計算する（簡易版）。
 *
 * - 時給制: baseSalary × 実働時間
 * - 日給制: baseSalary × 出勤日数（実働>0の日）
 * - 月給制: baseSalary（固定）
 *
 * 控除は健康保険(労使折半)＋所得税(月額表電算機特例)の合算。
 * 雇用保険・厚生年金・住民税はモックでは未計上。
 */
export function computeMonthSummary(
  employeeId: string,
  year: number,
  month: number,
  employeeDB: Record<string, EmployeeMaster>,
  contractDB: ContractMaster[],
): PayrollSummary {
  const contract = contractDB.find(
    (c) => c.employeeId === employeeId && c.workplaceId === "default",
  );
  const master = employeeDB[employeeId];

  const appliedSalaryType: SalaryType = contract?.salaryType ?? "月給";
  const appliedBaseSalary = contract?.baseSalary ?? 0;

  const totalHours = calcTotalWorkingHours(employeeId, year, month);

  let totalPayment = 0;
  if (appliedSalaryType === "時給") {
    totalPayment = Math.round(appliedBaseSalary * totalHours);
  } else if (appliedSalaryType === "日給") {
    const rows = loadRows(employeeId, year, month);
    const workedDays = rows.filter((r) => {
      const gross = calcHours(r.editStart || r.stdStart, r.editEnd || r.stdEnd);
      return gross > 0;
    }).length;
    totalPayment = appliedBaseSalary * workedDays;
  } else {
    totalPayment = appliedBaseSalary;
  }

  // 控除: 所得税 + 健康保険 (簡易)
  const incomeTax = calculateIncomeTax(totalPayment);
  const yyyymm = `${year}-${String(month).padStart(2, "0")}`;
  const health = master
    ? calculateHealthInsurance({
        standardRemuneration: master.standardRemuneration,
        isSocialInsurance: master.isSocialInsurance,
        birthDate: master.birthDate,
        targetYearMonth: yyyymm,
      })
    : { employeePremium: 0 };
  const totalDeduction = incomeTax + health.employeePremium;

  const netPay = totalPayment - totalDeduction;

  return {
    appliedSalaryType,
    appliedBaseSalary,
    totalWorkingHours: Math.round(totalHours * 100) / 100,
    totalPayment,
    totalDeduction,
    netPay,
  };
}

export function buildPayrollResultId(employeeId: string, year: number, month: number): string {
  const yyyymm = `${year}-${String(month).padStart(2, "0")}`;
  return `pr_${employeeId}_${yyyymm}`;
}

export function toYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
