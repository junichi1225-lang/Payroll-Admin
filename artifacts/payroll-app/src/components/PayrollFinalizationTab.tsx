import { useMemo } from "react";
import { Lock, Unlock, ShieldCheck, AlertTriangle, Clock } from "lucide-react";
import {
  ContractMaster,
  DEFAULT_TENANT_ID,
  EmployeeMaster,
  EmployeeRecord,
  PayrollResult,
} from "@/lib/dummy-data";
import {
  buildPayrollResultId,
  computeMonthSummary,
  toYearMonth,
} from "@/lib/payrollCalc";
import { cn } from "@/lib/utils";

interface PayrollFinalizationTabProps {
  currentDate: Date;
  employees: EmployeeRecord[];
  employeeDB: Record<string, EmployeeMaster>;
  contractDB: ContractMaster[];
  payrollResultDB: PayrollResult[];
  onLockOne: (result: PayrollResult) => void;
  onUnlockOne: (id: string) => void;
  onLockAll: (results: PayrollResult[]) => void;
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

export function PayrollFinalizationTab({
  currentDate,
  employees,
  employeeDB,
  contractDB,
  payrollResultDB,
  onLockOne,
  onUnlockOne,
  onLockAll,
}: PayrollFinalizationTabProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const yyyymm = toYearMonth(year, month);

  // 各従業員の表示行: ロック済みならスナップショット、未確定なら現時点の計算値
  const rows = useMemo(() => {
    return employees.map((emp) => {
      const locked = payrollResultDB.find(
        (p) =>
          p.employeeId === emp.id &&
          p.targetYearMonth === yyyymm &&
          p.status === "locked",
      );
      if (locked) {
        return { emp, isLocked: true as const, snapshot: locked };
      }
      const live = computeMonthSummary(emp.id, year, month, employeeDB, contractDB);
      return { emp, isLocked: false as const, live };
    });
  }, [employees, employeeDB, contractDB, payrollResultDB, year, month, yyyymm]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        const src = r.isLocked
          ? r.snapshot
          : {
              totalPayment: r.live.totalPayment,
              totalDeduction: r.live.totalDeduction,
              netPay: r.live.netPay,
            };
        acc.payment += src.totalPayment;
        acc.deduction += src.totalDeduction;
        acc.net += src.netPay;
        return acc;
      },
      { payment: 0, deduction: 0, net: 0 },
    );
  }, [rows]);

  const draftRows = rows.filter((r) => !r.isLocked);
  const lockedCount = rows.length - draftRows.length;

  const handleLockRow = (emp: EmployeeRecord) => {
    const live = computeMonthSummary(emp.id, year, month, employeeDB, contractDB);
    const result: PayrollResult = {
      tenantId: DEFAULT_TENANT_ID,
      id: buildPayrollResultId(emp.id, year, month),
      employeeId: emp.id,
      targetYearMonth: yyyymm,
      status: "locked",
      appliedSalaryType: live.appliedSalaryType,
      appliedBaseSalary: live.appliedBaseSalary,
      totalWorkingHours: live.totalWorkingHours,
      totalPayment: live.totalPayment,
      totalDeduction: live.totalDeduction,
      netPay: live.netPay,
      lockedAt: new Date().toISOString(),
    };
    onLockOne(result);
  };

  const handleLockAll = () => {
    const newResults: PayrollResult[] = draftRows.map((r) => {
      const live = computeMonthSummary(r.emp.id, year, month, employeeDB, contractDB);
      return {
        tenantId: DEFAULT_TENANT_ID,
        id: buildPayrollResultId(r.emp.id, year, month),
        employeeId: r.emp.id,
        targetYearMonth: yyyymm,
        status: "locked",
        appliedSalaryType: live.appliedSalaryType,
        appliedBaseSalary: live.appliedBaseSalary,
        totalWorkingHours: live.totalWorkingHours,
        totalPayment: live.totalPayment,
        totalDeduction: live.totalDeduction,
        netPay: live.netPay,
        lockedAt: new Date().toISOString(),
      };
    });
    if (newResults.length > 0) onLockAll(newResults);
  };

  return (
    <div className="space-y-5">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">{yyyymm} 月次給与確定</p>
            <p className="text-xs text-muted-foreground">
              全{employees.length}名 / 確定済 {lockedCount} 名 / 未確定 {draftRows.length} 名
            </p>
          </div>
        </div>
        <button
          onClick={handleLockAll}
          disabled={draftRows.length === 0}
          className={cn(
            "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm",
            draftRows.length === 0
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <Lock className="w-4 h-4" />
          全員確定（{draftRows.length}名）
        </button>
      </div>

      {/* 注記 */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-50/60 border border-amber-200 rounded-xl p-3">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
        <p>
          確定（ロック）された月の給与額は、その時点の単価・労働時間でスナップショット保存されます。
          以降にマスタ（時給等）を変更しても、この画面の確定済み行の金額は変動しません。
        </p>
      </div>

      {/* テーブル */}
      <div className="rounded-xl border border-border overflow-x-auto bg-card">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">従業員</th>
              <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[110px]">単価</th>
              <th className="text-right px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[80px]">労働h</th>
              <th className="text-right px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[110px]">支給</th>
              <th className="text-right px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[110px]">控除</th>
              <th className="text-right px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[120px]">手取</th>
              <th className="text-center px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[140px]">状態 / 操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const data = row.isLocked
                ? {
                    salaryType: row.snapshot.appliedSalaryType,
                    baseSalary: row.snapshot.appliedBaseSalary,
                    hours: row.snapshot.totalWorkingHours,
                    payment: row.snapshot.totalPayment,
                    deduction: row.snapshot.totalDeduction,
                    net: row.snapshot.netPay,
                  }
                : {
                    salaryType: row.live.appliedSalaryType,
                    baseSalary: row.live.appliedBaseSalary,
                    hours: row.live.totalWorkingHours,
                    payment: row.live.totalPayment,
                    deduction: row.live.totalDeduction,
                    net: row.live.netPay,
                  };
              return (
                <tr
                  key={row.emp.id}
                  data-employee-id={row.emp.id}
                  data-locked={row.isLocked ? "true" : "false"}
                  className={cn(
                    "border-b border-border/50 transition-colors",
                    row.isLocked ? "bg-emerald-50/30" : "hover:bg-muted/20",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-foreground">{row.emp.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {row.emp.employeeNumber} · {row.emp.department}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{data.salaryType}</span>
                      <span className="text-xs font-semibold text-foreground tabular-nums">
                        {yen(data.baseSalary)}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-xs text-foreground">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <Clock className="w-3 h-3 text-muted-foreground/60" />
                      {data.hours.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-xs font-semibold text-foreground">
                    {yen(data.payment)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-xs text-rose-700">
                    -{yen(data.deduction)}
                  </td>
                  <td
                    className="px-2 py-2.5 text-right tabular-nums text-sm font-bold text-primary"
                    data-testid={`netpay-${row.emp.id}`}
                  >
                    {yen(data.net)}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    {row.isLocked ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 rounded-full px-2 py-0.5">
                          <Lock className="w-3 h-3" />
                          確定済
                        </span>
                        <button
                          onClick={() => onUnlockOne(row.snapshot.id)}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={`${row.emp.name}の確定を解除`}
                        >
                          <Unlock className="w-3 h-3" />
                          確定解除
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleLockRow(row.emp)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors"
                        aria-label={`${row.emp.name}を確定`}
                      >
                        <Lock className="w-3 h-3" />
                        確定
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/30 border-t-2 border-border">
              <td colSpan={3} className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-right">
                合計
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums text-xs font-bold text-foreground">
                {yen(totals.payment)}
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums text-xs font-bold text-rose-700">
                -{yen(totals.deduction)}
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums text-sm font-bold text-primary">
                {yen(totals.net)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
