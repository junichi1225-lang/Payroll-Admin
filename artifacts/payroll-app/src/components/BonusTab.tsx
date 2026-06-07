import { useMemo, useState } from "react";
import {
  Lock,
  Unlock,
  Gift,
  AlertTriangle,
  CheckCircle2,
  Send,
  FileText,
  Mail,
  Plus,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  BonusRun,
  BonusResult,
  EmployeeMaster,
  EmployeeRecord,
  PayrollResult,
  WorkplaceDef,
} from "@/lib/dummy-data";
import {
  buildBonusResult,
  buildBonusResultId,
  buildBonusRunId,
  computeBonusForEmployee,
} from "@/lib/bonusCalc";
import {
  generateBonusPayslipPDF,
  type BonusPayslipEmployeeData,
} from "@/lib/generateBonusPayslipPDF";
import { usePersistedState } from "@/lib/usePersistedState";
import { cn } from "@/lib/utils";

const SHARE_EMAIL_KEY = "shareRecipientEmail";

interface BonusTabProps {
  employees: EmployeeRecord[];
  employeeDB: Record<string, EmployeeMaster>;
  workplaces: Record<string, WorkplaceDef>;
  payrollResultDB: PayrollResult[];
  bonusRunDB: BonusRun[];
  setBonusRunDB: React.Dispatch<React.SetStateAction<BonusRun[]>>;
  bonusResultDB: BonusResult[];
  setBonusResultDB: React.Dispatch<React.SetStateAction<BonusResult[]>>;
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function methodLabel(method: BonusResult["appliedRates"]["taxMethod"], rate: number | null): string {
  switch (method) {
    case "rate-table":
      return `算出率表 ${rate ?? 0}%`;
    case "special-no-prev-salary":
      return "特例1（前月給与なし）";
    case "special-over-10x":
      return "特例2（前月給与の10倍超）";
  }
}

export function BonusTab({
  employees,
  employeeDB,
  workplaces,
  payrollResultDB,
  bonusRunDB,
  setBonusRunDB,
  bonusResultDB,
  setBonusResultDB,
}: BonusTabProps) {
  const [activeRunId, setActiveRunId] = useState<string | null>(bonusRunDB[0]?.id ?? null);
  const activeRun = useMemo(
    () => bonusRunDB.find((r) => r.id === activeRunId) ?? bonusRunDB[0] ?? null,
    [bonusRunDB, activeRunId],
  );

  // 新規賞与回の作成フォーム
  const [showCreate, setShowCreate] = useState(bonusRunDB.length === 0);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");

  // 賞与総額の下書き入力（賞与回×従業員）。確定前の入力を保持する。
  const [grossInputs, setGrossInputs] = usePersistedState<Record<string, Record<string, string>>>(
    "mock_bonusGrossInputs",
    {},
  );

  const handleCreateRun = () => {
    if (!newName.trim() || !newDate) {
      toast.error("賞与回の名称と支給日を入力してください");
      return;
    }
    const run: BonusRun = {
      tenantId: DEFAULT_TENANT_ID,
      id: buildBonusRunId(newDate),
      name: newName.trim(),
      paymentDate: newDate,
      status: "draft",
      createdAt: new Date().toISOString(),
      employeeIds: employees.map((e) => e.id),
    };
    setBonusRunDB((prev) => [run, ...prev]);
    setActiveRunId(run.id);
    setShowCreate(false);
    setNewName("");
    setNewDate("");
    toast.success("賞与回を作成しました", { description: `${run.name}（支給日 ${run.paymentDate}）` });
  };

  const setGross = (runId: string, employeeId: string, value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    setGrossInputs((prev) => ({
      ...prev,
      [runId]: { ...(prev[runId] ?? {}), [employeeId]: digits },
    }));
  };

  const getGross = (runId: string, employeeId: string): number =>
    parseInt(grossInputs[runId]?.[employeeId] ?? "", 10) || 0;

  // 賞与回の対象従業員（作成時スナップショット）。旧データやスナップショット欠落時は
  // 現在の従業員一覧にフォールバックする。退職等で存在しないIDは表示対象から除外。
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e] as const)), [employees]);
  const participants = useMemo(() => {
    if (!activeRun) return [];
    const ids = activeRun.employeeIds?.length ? activeRun.employeeIds : employees.map((e) => e.id);
    return ids.map((id) => empById.get(id)).filter((e): e is EmployeeRecord => e != null);
  }, [activeRun, employees, empById]);

  // ── 表示行: ロック済みはスナップショット、未確定は現時点の計算値 ──
  const rows = useMemo(() => {
    if (!activeRun) return [];
    return participants.map((emp) => {
      const resultId = buildBonusResultId(activeRun.id, emp.id);
      const locked = bonusResultDB.find((r) => r.id === resultId && r.status === "locked");
      if (locked) {
        return { emp, isLocked: true as const, snapshot: locked };
      }
      const grossBonus = getGross(activeRun.id, emp.id);
      const live = computeBonusForEmployee(
        emp.id,
        activeRun,
        grossBonus,
        employeeDB,
        workplaces,
        payrollResultDB,
        bonusRunDB,
        bonusResultDB,
      );
      return { emp, isLocked: false as const, grossBonus, live };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun, participants, employeeDB, workplaces, payrollResultDB, bonusRunDB, bonusResultDB, grossInputs]);

  const draftRows = rows.filter((r) => !r.isLocked);
  const lockedCount = rows.length - draftRows.length;
  const allLocked = rows.length > 0 && draftRows.length === 0;

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        if (r.isLocked) {
          acc.gross += r.snapshot.grossBonus;
          acc.deduction += r.snapshot.totalDeduction;
          acc.net += r.snapshot.netBonus;
        } else {
          acc.gross += r.grossBonus;
          acc.deduction += r.live.computation.deductions.total;
          acc.net += r.live.computation.netBonus;
        }
        return acc;
      },
      { gross: 0, deduction: 0, net: 0 },
    );
  }, [rows]);

  /** 賞与回の全員ロック状態に応じて run.status を同期する（母集団は作成時スナップショット）。 */
  const syncRunStatus = (runId: string, results: BonusResult[]) => {
    const lockedIds = new Set(
      results.filter((r) => r.bonusRunId === runId && r.status === "locked").map((r) => r.employeeId),
    );
    setBonusRunDB((prev) =>
      prev.map((r) => {
        if (r.id !== runId) return r;
        // 行表示と同じ母集団で判定: スナップショットIDのうち現存する従業員のみを対象にする。
        // （退職等で消えたIDを含めると永久にlockedにならないため除外する）
        const baseIds = r.employeeIds?.length ? r.employeeIds : employees.map((e) => e.id);
        const targetIds = baseIds.filter((id) => empById.has(id));
        const everyone = targetIds.length > 0 && targetIds.every((id) => lockedIds.has(id));
        return { ...r, status: everyone ? "locked" : "draft" };
      }),
    );
  };

  const upsertResults = (newResults: BonusResult[]) => {
    if (!activeRun) return;
    setBonusResultDB((prev) => {
      const byId = new Map(prev.map((r) => [r.id, r] as const));
      for (const nr of newResults) byId.set(nr.id, nr);
      const next = Array.from(byId.values());
      syncRunStatus(activeRun.id, next);
      return next;
    });
  };

  const handleLockRow = (emp: EmployeeRecord) => {
    if (!activeRun) return;
    const grossBonus = getGross(activeRun.id, emp.id);
    const live = computeBonusForEmployee(
      emp.id,
      activeRun,
      grossBonus,
      employeeDB,
      workplaces,
      payrollResultDB,
      bonusRunDB,
      bonusResultDB,
    );
    if (live.prevMonth.provisional) {
      if (
        !window.confirm(
          `${emp.name} は前月（${live.prevMonth.yearMonth}）の給与が未確定のため、現在のマスタから再計算した暫定値で源泉所得税を算出します。確定してよろしいですか？`,
        )
      )
        return;
    }
    const result = buildBonusResult(DEFAULT_TENANT_ID, activeRun, emp.id, grossBonus, live, "locked");
    upsertResults([result]);
    toast.success(`${emp.name} の賞与を確定しました`);
  };

  const handleLockAll = () => {
    if (!activeRun) return;
    const provisional = draftRows.filter((r) => !r.isLocked && r.live.prevMonth.provisional);
    if (provisional.length > 0) {
      if (
        !window.confirm(
          `${provisional.length}名は前月給与が未確定のため、現マスタからの暫定値で算出します。全員を確定してよろしいですか？`,
        )
      )
        return;
    }
    const newResults = draftRows.map((r) =>
      buildBonusResult(DEFAULT_TENANT_ID, activeRun, r.emp.id, (r as { grossBonus: number }).grossBonus, r.live, "locked"),
    );
    if (newResults.length > 0) {
      upsertResults(newResults);
      toast.success(`${newResults.length}名の賞与を確定しました`);
    }
  };

  const handleUnlockRow = (employeeId: string) => {
    if (!activeRun) return;
    const resultId = buildBonusResultId(activeRun.id, employeeId);
    setBonusResultDB((prev) => {
      const next = prev.filter((r) => r.id !== resultId);
      syncRunStatus(activeRun.id, next);
      return next;
    });
  };

  // ── 共有（会計士・社労士への賞与明細PDF送付） ──
  const [recipientEmail, setRecipientEmail] = usePersistedState<string>(SHARE_EMAIL_KEY, "");
  const [sharing, setSharing] = useState(false);

  const openMailer = () => {
    if (!activeRun) return;
    const subject = `【${activeRun.name}】賞与明細`;
    const body = `${activeRun.name}（支給日 ${activeRun.paymentDate}）の賞与明細をお送りします。`;
    window.location.href = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
    toast.success("メーラーを起動しました", {
      description: "ダウンロードしたPDFを添付して送信してください。",
    });
  };

  const handleShare = async () => {
    if (!activeRun) return;
    if (!recipientEmail.trim()) {
      window.alert("送付先メールアドレスを設定してください。");
      return;
    }
    if (!window.confirm(`${recipientEmail} 宛に全従業員の賞与明細を送付します。よろしいですか？`)) return;
    setSharing(true);
    try {
      const employeesData: BonusPayslipEmployeeData[] = rows
        .filter((r) => r.isLocked)
        .map((r) => {
          const s = r.snapshot;
          return {
            employeeNumber: r.emp.employeeNumber,
            employeeName: r.emp.name,
            grossBonus: s.grossBonus,
            standardBonusAmount: s.standardBonusAmount,
            deductions: {
              health: s.healthInsurance,
              nursingCare: s.nursingCare,
              pension: s.pension,
              childSupport: s.childSupport,
              employment: s.employmentInsurance,
              incomeTax: s.incomeTax,
              total: s.totalDeduction,
            },
            netBonus: s.netBonus,
          };
        });
      await generateBonusPayslipPDF({
        companyName: DEFAULT_TENANT_NAME,
        bonusName: activeRun.name,
        paymentDate: activeRun.paymentDate,
        employees: employeesData,
      });
      openMailer();
    } catch (err) {
      console.error("[handleShareBonus]", err);
      toast.error("賞与明細PDFの生成に失敗しました");
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ヘッダー + 賞与回セレクタ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Gift className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">賞与計算</p>
            <p className="text-xs text-muted-foreground">
              月次給与とは独立した賞与の算定・確定を行います
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {bonusRunDB.length > 0 && (
            <select
              value={activeRun?.id ?? ""}
              onChange={(e) => setActiveRunId(e.target.value)}
              data-testid="bonus-run-select"
              className="px-3 py-2 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {bonusRunDB.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}（{r.paymentDate}）{r.status === "locked" ? " ✓" : ""}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowCreate((v) => !v)}
            data-testid="bonus-create-toggle"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-secondary text-foreground border border-border hover:bg-secondary/70 transition-colors"
          >
            <Plus className="w-4 h-4" />
            賞与回を追加
          </button>
        </div>
      </div>

      {/* 新規賞与回フォーム */}
      {showCreate && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="bonus-create-form">
          <p className="text-sm font-bold text-foreground">新規賞与回</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-semibold text-foreground">名称</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例：2026年 夏季賞与"
                data-testid="bonus-name-input"
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">支給日</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                data-testid="bonus-date-input"
                className="px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
          <button
            onClick={handleCreateRun}
            data-testid="bonus-create-submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            作成
          </button>
        </div>
      )}

      {!activeRun ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          賞与回がまだありません。「賞与回を追加」から作成してください。
        </div>
      ) : (
        <>
          {/* サマリー + 全員確定 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {activeRun.name}（支給日 {activeRun.paymentDate}） / 全{participants.length}名 / 確定済 {lockedCount} 名 / 未確定 {draftRows.length} 名
            </p>
            <button
              onClick={handleLockAll}
              disabled={draftRows.length === 0}
              data-testid="bonus-lock-all"
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
              源泉所得税は「前月の社会保険料控除後の給与」を基準に算出率表（令和8年分・甲欄・扶養0人）で計算します。
              前月給与が未確定の場合は現在のマスタから再計算した暫定値を用います（行に「暫定」表示）。住民税は賞与にはかかりません。
            </p>
          </div>

          {/* 全員確定バナー */}
          {allLocked && (
            <div
              className="flex items-center gap-2 text-sm font-semibold text-green-800 bg-green-50 border border-green-200 rounded-xl p-3"
              data-testid="bonus-all-locked-banner"
            >
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-green-600" />
              <p>全{participants.length}名の賞与が確定済みです。会計士・社労士へPDFを共有できます。</p>
            </div>
          )}

          {/* テーブル */}
          <div className="rounded-xl border border-border overflow-x-auto bg-card">
            <table className="w-full text-sm min-w-[920px]">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">従業員</th>
                  <th className="text-right px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[150px]">賞与額</th>
                  <th className="text-right px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[110px]">社会保険</th>
                  <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[170px]">源泉所得税</th>
                  <th className="text-right px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[120px]">手取</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[140px]">状態 / 操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const d = row.isLocked
                    ? {
                        gross: row.snapshot.grossBonus,
                        social: row.snapshot.socialInsuranceTotal,
                        incomeTax: row.snapshot.incomeTax,
                        net: row.snapshot.netBonus,
                        method: row.snapshot.appliedRates.taxMethod,
                        rate: row.snapshot.appliedRates.bonusTaxRate,
                        provisional: row.snapshot.appliedRates.prevMonthProvisional,
                        healthCap: row.snapshot.healthBaseStandardBonus < row.snapshot.standardBonusAmount,
                        pensionCap: row.snapshot.pensionBaseStandardBonus < row.snapshot.standardBonusAmount,
                      }
                    : {
                        gross: row.grossBonus,
                        social: row.live.computation.deductions.socialInsuranceTotal,
                        incomeTax: row.live.computation.deductions.incomeTax,
                        net: row.live.computation.netBonus,
                        method: row.live.computation.taxMethod,
                        rate: row.live.computation.appliedTaxRate,
                        provisional: row.live.prevMonth.provisional,
                        healthCap: row.live.computation.healthCapReached,
                        pensionCap: row.live.computation.pensionCapReached,
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
                            <span className={cn("text-sm font-semibold", row.isLocked ? "text-gray-400" : "text-foreground")}>
                              {row.emp.name}
                            </span>
                            {row.isLocked && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[10px] font-bold text-green-700 bg-green-100 border border-green-300 rounded-full px-1.5 py-0.5"
                                data-testid={`bonus-badge-locked-${row.emp.id}`}
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
                      <td className="px-2 py-2.5 text-right">
                        {row.isLocked ? (
                          <span className="text-xs font-semibold tabular-nums text-gray-400">{yen(d.gross)}</span>
                        ) : (
                          <input
                            inputMode="numeric"
                            value={grossInputs[activeRun.id]?.[row.emp.id] ?? ""}
                            onChange={(e) => setGross(activeRun.id, row.emp.id, e.target.value)}
                            placeholder="0"
                            data-testid={`bonus-gross-${row.emp.id}`}
                            className="w-[130px] px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        )}
                        {(d.healthCap || d.pensionCap) && (
                          <div className="mt-1 flex flex-col items-end gap-0.5">
                            {d.healthCap && (
                              <span className="text-[9px] text-amber-700 bg-amber-100 rounded px-1 py-0.5">健保 573万上限</span>
                            )}
                            {d.pensionCap && (
                              <span className="text-[9px] text-amber-700 bg-amber-100 rounded px-1 py-0.5">厚年 150万上限</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={cn("px-2 py-2.5 text-right tabular-nums text-xs", row.isLocked ? "text-gray-400" : "text-rose-700")}>
                        -{yen(d.social)}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className={cn("text-xs tabular-nums", row.isLocked ? "text-gray-400" : "text-rose-700")}>
                            -{yen(d.incomeTax)}
                          </span>
                          <span className={cn("inline-flex items-center gap-1 text-[10px]", row.isLocked ? "text-gray-400" : "text-muted-foreground")}>
                            <Info className="w-2.5 h-2.5" />
                            {methodLabel(d.method, d.rate)}
                          </span>
                          {d.provisional && (
                            <span className="text-[9px] text-blue-700 bg-blue-100 rounded px-1 py-0.5 w-fit" data-testid={`bonus-provisional-${row.emp.id}`}>
                              前月暫定
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={cn("px-2 py-2.5 text-right tabular-nums text-sm font-bold", row.isLocked ? "text-gray-400" : "text-primary")}
                        data-testid={`bonus-net-${row.emp.id}`}
                      >
                        {yen(d.net)}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        {row.isLocked ? (
                          <div className="flex flex-col items-center gap-1.5">
                            <button
                              disabled
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-200 text-gray-400 text-xs font-semibold cursor-not-allowed"
                            >
                              <Lock className="w-3 h-3" />
                              確定
                            </button>
                            <button
                              onClick={() => handleUnlockRow(row.emp.id)}
                              data-testid={`bonus-unlock-${row.emp.id}`}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Unlock className="w-3 h-3" />
                              確定解除
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleLockRow(row.emp)}
                            disabled={row.grossBonus <= 0}
                            data-testid={`bonus-lock-${row.emp.id}`}
                            className={cn(
                              "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                              row.grossBonus <= 0
                                ? "bg-muted text-muted-foreground cursor-not-allowed"
                                : "bg-primary/10 text-primary hover:bg-primary/20",
                            )}
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
                  <td className="px-3 py-2.5 text-xs font-bold text-muted-foreground text-right">合計</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-xs font-bold text-foreground">{yen(totals.gross)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-xs font-bold text-rose-700" colSpan={2}>
                    -{yen(totals.deduction)}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-sm font-bold text-primary">{yen(totals.net)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 共有 — 全員確定時のみ */}
          {allLocked && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="bonus-share-section">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Send className="w-4.5 h-4.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">会計士・社労士へ賞与明細を共有</p>
                  <p className="text-xs text-muted-foreground">確定済みの賞与データをPDF化し、メールで送付します。</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="bonus-share-email" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                  送付先メールアドレス
                </label>
                <input
                  id="bonus-share-email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="例：accountant@example.com"
                  data-testid="bonus-share-email-input"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                onClick={handleShare}
                disabled={sharing}
                data-testid="bonus-share-btn"
                className={cn(
                  "w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm",
                  sharing
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                <FileText className="w-4 h-4" />
                賞与明細を送付
              </button>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                ※ メール添付はお使いのメールソフトで行います。ボタンを押すとPDFがダウンロードされ、メーラーが起動します。
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
