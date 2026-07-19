import { useMemo, useState } from "react";
import {
  Lock,
  Unlock,
  ShieldCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Send,
  FileText,
  Files,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  EmployeeMaster,
  EmployeeRecord,
  PayrollResult,
  WorkplaceDef,
  allowanceTotal,
  normalizeAllowance,
} from "@/lib/dummy-data";
import {
  buildPayrollResultId,
  computeMonthSummary,
  toYearMonth,
} from "@/lib/payrollCalc";
import { loadEmployeeMonthComputation } from "@/lib/payrollInputs";
import type { DeductionBreakdown } from "@/lib/payroll-core";
import {
  generatePayslipPDF,
  type PayslipEmployeeData,
} from "@/lib/generatePayslipPDF";
import {
  generatePayrollSummaryPDF,
  type PayrollSummaryRow,
} from "@/lib/generatePayrollSummaryPDF";
import { usePersistedState } from "@/lib/usePersistedState";
import { cn } from "@/lib/utils";

const SHARE_EMAIL_KEY = "shareRecipientEmail";

interface PayrollFinalizationTabProps {
  currentDate: Date;
  employees: EmployeeRecord[];
  employeeDB: Record<string, EmployeeMaster>;
  workplaces: Record<string, WorkplaceDef>;
  payrollResultDB: PayrollResult[];
  onLockOne: (result: PayrollResult) => void;
  onUnlockOne: (employeeId: string, targetYearMonth: string) => void;
  onLockAll: (results: PayrollResult[]) => void;
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

export function PayrollFinalizationTab({
  currentDate,
  employees,
  employeeDB,
  workplaces,
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
          p != null &&
          p.employeeId === emp.id &&
          p.targetYearMonth === yyyymm &&
          p.status === "locked",
      );
      if (locked) {
        return { emp, isLocked: true as const, snapshot: locked };
      }
      const live = computeMonthSummary(emp.id, year, month, employeeDB, workplaces);
      return { emp, isLocked: false as const, live };
    });
  }, [employees, employeeDB, workplaces, payrollResultDB, year, month, yyyymm]);

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
    const live = computeMonthSummary(emp.id, year, month, employeeDB, workplaces);
    if (live.taxError) {
      toast.error(`${emp.name} の所得税を計算できないため確定できません`, {
        description: live.taxError,
      });
      return;
    }
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
      deductions: live.deductions,
      allowances: live.allowances,
      taxSnapshot: live.taxMeta,
    };
    onLockOne(result);
  };

  const handleLockAll = () => {
    const computed = draftRows.map((r) => ({
      r,
      live: computeMonthSummary(r.emp.id, year, month, employeeDB, workplaces),
    }));
    const blocked = computed.filter((c) => c.live.taxError);
    if (blocked.length > 0) {
      toast.error("所得税を計算できない従業員がいるため一括確定できません", {
        description: blocked.map((c) => `${c.r.emp.name}: ${c.live.taxError}`).join(" / "),
      });
      return;
    }
    const newResults: PayrollResult[] = computed.map(({ r, live }) => {
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
        deductions: live.deductions,
        allowances: live.allowances,
        taxSnapshot: live.taxMeta,
      };
    });
    if (newResults.length > 0) onLockAll(newResults);
  };

  // ── 共有（会計士へのPDF送付） ──
  // 全従業員がロック済みのときのみ表示する。
  const allLocked = rows.length > 0 && draftRows.length === 0;
  const [recipientEmail, setRecipientEmail] = usePersistedState<string>(SHARE_EMAIL_KEY, "");
  const [sharing, setSharing] = useState(false);

  /**
   * ロック済みスナップショットから控除内訳・手当を取り出す。
   * 旧バージョンで確定したレコード（deductions 未保存）は、同一の計算経路で再計算して補完する。
   */
  const resolveLockedDetail = (
    snapshot: PayrollResult,
  ): { deductions: DeductionBreakdown; allowances: { type: string; amount: number }[] } => {
    if (snapshot.deductions) {
      return {
        deductions: snapshot.deductions,
        allowances: (snapshot.allowances ?? []).map((a) => ({
          type: a.type,
          amount: allowanceTotal(normalizeAllowance(a)),
        })),
      };
    }
    const comp = loadEmployeeMonthComputation(
      snapshot.employeeId,
      year,
      month,
      workplaces,
      employeeDB[snapshot.employeeId],
    );
    return {
      deductions: comp.deductions,
      allowances: comp.allowances.map((a) => ({
        type: a.type,
        amount: allowanceTotal(normalizeAllowance(a)),
      })),
    };
  };

  const openMailer = () => {
    const [y, m] = yyyymm.split("-");
    const subject = `【${y}年${m}月】給与明細`;
    const body = `${y}年${m}月分の給与明細をお送りします。`;
    const href = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    toast.success("メーラーを起動しました", {
      description: "ダウンロードしたPDFを添付して送信してください。",
    });
  };

  const handleSharePayslips = async () => {
    if (!recipientEmail.trim()) {
      window.alert("送付先メールアドレスを設定してください。");
      return;
    }
    if (!window.confirm(`${recipientEmail} 宛に全従業員の給与明細を送付します。よろしいですか？`))
      return;
    setSharing(true);
    try {
      const employeesData: PayslipEmployeeData[] = rows
        .filter((r) => r.isLocked)
        .map((r) => {
          const snap = r.snapshot;
          const { deductions, allowances } = resolveLockedDetail(snap);
          return {
            employeeNumber: r.emp.employeeNumber,
            employeeName: r.emp.name,
            salaryType: snap.appliedSalaryType,
            baseSalary: snap.appliedBaseSalary,
            allowances,
            totalPayment: snap.totalPayment,
            deductions,
            netPay: snap.netPay,
          };
        });
      await generatePayslipPDF({
        companyName: DEFAULT_TENANT_NAME,
        yearMonth: yyyymm,
        employees: employeesData,
      });
      openMailer();
    } catch (err) {
      console.error("[handleSharePayslips]", err);
      toast.error("給与明細PDFの生成に失敗しました");
    } finally {
      setSharing(false);
    }
  };

  const handleShareSummary = async () => {
    if (!recipientEmail.trim()) {
      window.alert("送付先メールアドレスを設定してください。");
      return;
    }
    if (!window.confirm(`${recipientEmail} 宛に給与支給一覧を送付します。よろしいですか？`)) return;
    setSharing(true);
    try {
      const summaryRows: PayrollSummaryRow[] = rows
        .filter((r) => r.isLocked)
        .map((r) => {
          const snap = r.snapshot;
          const { deductions } = resolveLockedDetail(snap);
          return {
            employeeNumber: r.emp.employeeNumber,
            name: r.emp.name,
            totalPayment: snap.totalPayment,
            health: deductions.health,
            nursingCare: deductions.nursingCare,
            pension: deductions.pension,
            labor: deductions.labor,
            incomeTax: deductions.incomeTax,
            residentTax: deductions.residentTax,
            netPay: snap.netPay,
          };
        });
      await generatePayrollSummaryPDF({
        companyName: DEFAULT_TENANT_NAME,
        yearMonth: yyyymm,
        rows: summaryRows,
      });
      openMailer();
    } catch (err) {
      console.error("[handleShareSummary]", err);
      toast.error("給与一覧PDFの生成に失敗しました");
    } finally {
      setSharing(false);
    }
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

      {/* 全員確定バナー */}
      {allLocked && (
        <div
          className="flex items-center gap-2 text-sm font-semibold text-green-800 bg-green-50 border border-green-200 rounded-xl p-3"
          data-testid="all-locked-banner"
        >
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-green-600" />
          <p>
            全{employees.length}名の給与が確定済みです。会計士・社労士へPDFを共有できます。
          </p>
        </div>
      )}

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
                    row.isLocked ? "bg-gray-100" : "hover:bg-muted/20",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            row.isLocked ? "text-gray-400" : "text-foreground",
                          )}
                        >
                          {row.emp.name}
                        </span>
                        {row.isLocked && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] font-bold text-green-700 bg-green-100 border border-green-300 rounded-full px-1.5 py-0.5"
                            data-testid={`badge-locked-${row.emp.id}`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            確定済み
                          </span>
                        )}
                      </span>
                      <span className={cn("text-[10px]", row.isLocked ? "text-gray-400" : "text-muted-foreground")}>
                        {row.emp.employeeNumber} · {row.emp.department}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-col">
                      <span className={cn("text-xs", row.isLocked ? "text-gray-400" : "text-muted-foreground")}>{data.salaryType}</span>
                      <span className={cn("text-xs font-semibold tabular-nums", row.isLocked ? "text-gray-400" : "text-foreground")}>
                        {yen(data.baseSalary)}
                      </span>
                    </div>
                  </td>
                  <td className={cn("px-2 py-2.5 text-right tabular-nums text-xs", row.isLocked ? "text-gray-400" : "text-foreground")}>
                    <span className="inline-flex items-center gap-1 justify-end">
                      <Clock className={cn("w-3 h-3", row.isLocked ? "text-gray-300" : "text-muted-foreground/60")} />
                      {data.hours.toFixed(1)}
                    </span>
                  </td>
                  <td className={cn("px-2 py-2.5 text-right tabular-nums text-xs font-semibold", row.isLocked ? "text-gray-400" : "text-foreground")}>
                    {yen(data.payment)}
                  </td>
                  <td className={cn("px-2 py-2.5 text-right tabular-nums text-xs", row.isLocked ? "text-gray-400" : "text-rose-700")}>
                    -{yen(data.deduction)}
                  </td>
                  <td
                    className={cn("px-2 py-2.5 text-right tabular-nums text-sm font-bold", row.isLocked ? "text-gray-400" : "text-primary")}
                    data-testid={`netpay-${row.emp.id}`}
                  >
                    {yen(data.net)}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    {row.isLocked ? (
                      <div className="flex flex-col items-center gap-1.5">
                        <button
                          disabled
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-200 text-gray-400 text-xs font-semibold cursor-not-allowed"
                          aria-label={`${row.emp.name}は確定済み`}
                        >
                          <Lock className="w-3 h-3" />
                          確定
                        </button>
                        <button
                          onClick={() => onUnlockOne(row.emp.id, yyyymm)}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={`${row.emp.name}の確定を解除`}
                        >
                          <Unlock className="w-3 h-3" />
                          確定解除
                        </button>
                      </div>
                    ) : row.live.taxError ? (
                      <div className="flex flex-col items-center gap-1">
                        <button
                          disabled
                          title={row.live.taxError}
                          data-testid={`tax-error-${row.emp.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 text-xs font-semibold cursor-not-allowed"
                          aria-label={`${row.emp.name}は所得税を計算できないため確定不可`}
                        >
                          <Lock className="w-3 h-3" />
                          確定不可
                        </button>
                        <span className="text-[9px] text-rose-600 leading-tight">所得税計算エラー</span>
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

      {/* 共有（会計士・社労士へのPDF送付） — 全員確定時のみ表示 */}
      {allLocked && (
        <div
          className="rounded-xl border border-border bg-card p-4 space-y-4"
          data-testid="share-section"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Send className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">会計士・社労士へPDFを共有</p>
              <p className="text-xs text-muted-foreground">
                確定済みの給与データをPDF化し、メールで送付します。
              </p>
            </div>
          </div>

          {/* 送付先メールアドレス */}
          <div className="space-y-1.5">
            <label
              htmlFor="share-recipient-email"
              className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
            >
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              送付先メールアドレス
            </label>
            <input
              id="share-recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="例：accountant@example.com"
              data-testid="share-email-input"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all placeholder:text-muted-foreground/40"
            />
          </div>

          {/* 送付ボタン */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              onClick={handleSharePayslips}
              disabled={sharing}
              data-testid="share-payslips-btn"
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm",
                sharing
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              <FileText className="w-4 h-4" />
              個人別 給与明細を送付
            </button>
            <button
              onClick={handleShareSummary}
              disabled={sharing}
              data-testid="share-summary-btn"
              className={cn(
                "flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors border",
                sharing
                  ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                  : "bg-secondary text-foreground border-border hover:bg-secondary/70",
              )}
            >
              <Files className="w-4 h-4" />
              全従業員一覧を送付
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            ※ メール添付はお使いのメールソフトで行います。ボタンを押すとPDFがダウンロードされ、メーラーが起動します。ダウンロードしたPDFを添付して送信してください。
          </p>
        </div>
      )}
    </div>
  );
}
