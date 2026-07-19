// ───────────────────────────────────────────────────────────
// 給与計算時必須バリデーション（3区分バリデーションの「給与計算時必須」）
//
// マスタ保存時は空を許容するが、給与計算（確定）実行時に未設定なら
// エラーを出して計算をブロックする。エラーは「どの従業員の・どの項目が
// 未設定か」を一覧でまとめて返す。
// ───────────────────────────────────────────────────────────
import type {
  EmployeeMaster,
  ContractMaster,
  StandardRemunerationHistory,
} from "@/lib/dummy-data";
import { getActiveContract } from "@/lib/payroll-core";

export interface PayrollRequirementIssue {
  employeeId: string;
  employeeName: string;
  /** 未設定の項目名（画面表示用ラベル） */
  missingItems: string[];
}

/**
 * 対象月 "YYYY-MM" の給与計算に必要なマスタ項目が揃っているか検査する。
 * 不足がある従業員だけを一覧で返す（空配列 = 全員計算可能）。
 */
export function validatePayrollRequirements(params: {
  targetYearMonth: string;
  employees: { id: string; name: string }[];
  employeeDB: Record<string, EmployeeMaster>;
  contractDB: ContractMaster[];
  stdRemHistoryDB: StandardRemunerationHistory[];
}): PayrollRequirementIssue[] {
  const { targetYearMonth, employees, employeeDB, contractDB, stdRemHistoryDB } = params;
  // 契約・標準報酬の有効判定は対象月の月初日で行う
  const targetDate = `${targetYearMonth}-01`;
  const issues: PayrollRequirementIssue[] = [];

  for (const emp of employees) {
    const master = employeeDB[emp.id];
    const missing: string[] = [];

    if (!master) {
      missing.push("社員マスタ（未登録）");
    } else {
      if (master.taxCategory == null) missing.push("所得税区分（甲欄/乙欄）");
      if (master.dependentsCount == null) missing.push("扶養親族数");
      if (master.isSocialInsurance == null) missing.push("社会保険 加入/非加入");
      if (master.isEmploymentInsurance == null) missing.push("雇用保険 加入/非加入");
    }

    const contract = getActiveContract(contractDB, emp.id, targetDate);
    if (!contract || contract.wageAmount <= 0) {
      missing.push("有効な契約（賃金形態・単価）");
    }

    if (master?.isSocialInsurance === true) {
      const hasStdRem = stdRemHistoryDB.some(
        (h) =>
          h.employeeId === emp.id &&
          h.amount > 0 &&
          h.effectiveFrom <= targetYearMonth &&
          (h.effectiveTo == null || targetYearMonth <= h.effectiveTo),
      );
      if (!hasStdRem) missing.push("標準報酬月額（対象月に有効な履歴）");
    }

    if (missing.length > 0) {
      issues.push({ employeeId: emp.id, employeeName: emp.name, missingItems: missing });
    }
  }
  return issues;
}
