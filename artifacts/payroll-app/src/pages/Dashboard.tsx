import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { DUMMY_EMPLOYEE_DATA, EmployeeRecord, EmployeeColor, DEFAULT_WORKPLACES, WorkplaceDef, EmployeeMaster, ContractMaster, PayrollResult, DEFAULT_TENANT_ID, DEFAULT_EMPLOYEE_MASTERS } from "@/lib/dummy-data";
import { usePersistedState } from "@/lib/usePersistedState";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Users, CheckCircle2 } from "lucide-react";
import { EmployeeInfoTab } from "@/components/EmployeeInfoTab";
import { PayrollTab } from "@/components/PayrollTab";
import { PayrollFinalizationTab } from "@/components/PayrollFinalizationTab";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

// ─────────────────────────────────────────────
// カラーパレット（Tailwind JIT対策でinline styleで使用）
// ─────────────────────────────────────────────

const COLOR_PALETTE: EmployeeColor[] = ["blue", "green", "rose", "amber", "purple", "teal"];

type ColorTokens = {
  border: string;
  bg50: string;
  bg100: string;
  text: string;
  avatar: string;
};

const COLOR_MAP: Record<EmployeeColor, ColorTokens> = {
  blue:   { border: "#3b82f6", bg50: "#eff6ff", bg100: "#dbeafe", text: "#2563eb", avatar: "#bfdbfe" },
  green:  { border: "#22c55e", bg50: "#f0fdf4", bg100: "#dcfce7", text: "#16a34a", avatar: "#bbf7d0" },
  rose:   { border: "#f43f5e", bg50: "#fff1f2", bg100: "#ffe4e6", text: "#e11d48", avatar: "#fecdd3" },
  amber:  { border: "#f59e0b", bg50: "#fffbeb", bg100: "#fef3c7", text: "#d97706", avatar: "#fde68a" },
  purple: { border: "#a855f7", bg50: "#faf5ff", bg100: "#f3e8ff", text: "#9333ea", avatar: "#e9d5ff" },
  teal:   { border: "#14b8a6", bg50: "#f0fdfa", bg100: "#ccfbf1", text: "#0d9488", avatar: "#99f6e4" },
};

// ─────────────────────────────────────────────
// 従業員サイドバー（PC・モバイル共用コンテンツ）
// ─────────────────────────────────────────────

interface EmployeeSidebarProps {
  employees: EmployeeRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAddClick: () => void;
  onAfterSelect?: () => void;
  lockedIds: Set<string>;
}

// 各タブ項目: hoverをローカルstateで追跡してinline styleに渡す
function EmployeeTabButton({
  emp,
  isSelected,
  onSelect,
  onAfterSelect,
  isLocked,
}: {
  emp: EmployeeRecord;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onAfterSelect?: () => void;
  isLocked: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const c = COLOR_MAP[emp.color];

  const bgColor = isSelected
    ? c.bg50
    : hovered
    ? c.bg100
    : "transparent";

  return (
    <button
      onClick={() => { onSelect(emp.id); onAfterSelect?.(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "w-full flex items-center gap-3 py-2.5 pl-2 pr-3 text-sm text-left transition-colors duration-150",
        "rounded-l-lg rounded-r-none border-l-4",
        isSelected ? "relative z-10 mr-[-1px] font-bold" : "font-medium"
      )}
      style={{
        // アクティブ: 100%不透明／非アクティブ: 約60%不透明で常時表示
        borderLeftColor: isSelected ? c.border : c.border + "99",
        backgroundColor: bgColor,
        color: isSelected ? c.text : undefined,
      }}
    >
      {/* アバター — アクティブ/非アクティブ問わず固有色を使用 */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 border transition-colors"
        style={
          isSelected
            ? { backgroundColor: c.avatar, borderColor: c.border + "66", color: c.text }
            : { backgroundColor: c.avatar + "cc", borderColor: c.border + "55", color: c.text }
        }
      >
        {emp.name[0]}
      </div>

      {/* テキスト */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm flex items-center gap-1.5" style={{ color: isSelected ? c.text : undefined }}>
          <span className="truncate">{emp.name}</span>
          {isLocked && (
            <CheckCircle2
              className="w-3.5 h-3.5 text-green-600 flex-shrink-0"
              data-testid={`sidebar-locked-${emp.id}`}
            />
          )}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {emp.department}
          {isLocked && <span className="ml-1.5 text-green-600 font-semibold">・確定</span>}
        </p>
      </div>
    </button>
  );
}

function EmployeeSidebarContent({
  employees,
  selectedId,
  onSelect,
  onAddClick,
  onAfterSelect,
  lockedIds,
}: EmployeeSidebarProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/50 flex-shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">従業員一覧</p>
      </div>

      {/* Employee list */}
      <nav className="flex-1 overflow-y-auto py-2 pl-2 pr-0 space-y-0.5">
        {employees.map((emp) => (
          <EmployeeTabButton
            key={emp.id}
            emp={emp}
            isSelected={emp.id === selectedId}
            onSelect={onSelect}
            onAfterSelect={onAfterSelect}
            isLocked={lockedIds.has(emp.id)}
          />
        ))}

        {/* 従業員追加ボタン */}
        <div className="pt-1 pb-2">
          <button
            onClick={onAddClick}
            className="w-full flex items-center gap-3 pl-2 pr-3 py-2.5 rounded-l-lg rounded-r-none border-l-4 border-l-transparent text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-150"
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center border border-dashed border-border/70 bg-background/60 flex-shrink-0">
              <Plus className="w-3.5 h-3.5" />
            </div>
            <span>従業員を追加</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

// ─────────────────────────────────────────────
// メインページ
// ─────────────────────────────────────────────

type TabType = "payroll" | "info" | "finalize";

const TAB_LABELS: Record<TabType, string> = {
  payroll: "給与情報",
  info: "社員情報",
  finalize: "給与確定",
};

export default function Dashboard() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 2, 1));
  const [employees, setEmployees] = useState<EmployeeRecord[]>(DUMMY_EMPLOYEE_DATA);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(DUMMY_EMPLOYEE_DATA[0].id);
  const [activeTab, setActiveTab] = useState<TabType>("payroll");

  // Mobile sheet state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // 職場マスタ(全従業員で共有 — localStorage 同期)
  const [workplaces, setWorkplaces] = usePersistedState<Record<string, WorkplaceDef>>("mock_workplaces", DEFAULT_WORKPLACES);
  const handleAddWorkplace = (key: string, def: WorkplaceDef) => {
    setWorkplaces((prev) => ({ ...prev, [key]: { ...def, tenantId: DEFAULT_TENANT_ID } }));
  };
  const handleUpdateWorkplace = (id: string, def: WorkplaceDef) => {
    setWorkplaces((prev) => ({ ...prev, [id]: { ...def, id, tenantId: DEFAULT_TENANT_ID } }));
  };

  // 従業員マスタ DB / 契約マスタ DB（localStorage 同期 — モックアップデモ用）
  const [employeeDB, setEmployeeDB] = usePersistedState<Record<string, EmployeeMaster>>("mock_employeeDB", DEFAULT_EMPLOYEE_MASTERS);
  const [contractDB, setContractDB] = usePersistedState<ContractMaster[]>("mock_contractDB", []);

  /**
   * 旧バージョンの localStorage 互換マイグレーション。
   * - `mock_employeeDB` が `{}` のまま保存されている既存ユーザにダミー社員マスタをシード
   * - `residentTax` 等の新フィールドが欠落しているレコードを DEFAULT_EMPLOYEE_MASTERS から補完
   * 1度きり実行（補完が不要なら setState は呼ばない＝再レンダリングを発生させない）。
   */
  useEffect(() => {
    setEmployeeDB((prev) => {
      const seedIds = Object.keys(DEFAULT_EMPLOYEE_MASTERS);
      let mutated = false;
      const next: Record<string, EmployeeMaster> = { ...prev };
      for (const id of seedIds) {
        const seed = DEFAULT_EMPLOYEE_MASTERS[id];
        const cur = next[id];
        if (!cur) {
          next[id] = seed;
          mutated = true;
          continue;
        }
        if (typeof cur.residentTax !== "number") {
          next[id] = { ...cur, residentTax: seed.residentTax };
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
    // 職場マスタ: 旧バージョンに無い設定フィールド（朝残業算入・深夜割増適用）を補完
    setWorkplaces((prev) => {
      let mutated = false;
      const next: Record<string, WorkplaceDef> = { ...prev };
      for (const [key, wp] of Object.entries(prev)) {
        const seed = DEFAULT_WORKPLACES[key];
        if (typeof wp.includeEarlyOvertime !== "boolean" || typeof wp.applyLateNightPremium !== "boolean") {
          next[key] = {
            ...wp,
            includeEarlyOvertime: typeof wp.includeEarlyOvertime === "boolean"
              ? wp.includeEarlyOvertime
              : seed?.includeEarlyOvertime ?? false,
            applyLateNightPremium: typeof wp.applyLateNightPremium === "boolean"
              ? wp.applyLateNightPremium
              : seed?.applyLateNightPremium ?? true,
          };
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 給与確定スナップショット DB（マスタ変更後も金額が変動しないように保持）
  // ユニーク制約: (tenantId, employeeId, targetYearMonth) — 1人 × 1月 = 1レコード
  const [payrollResultDB, setPayrollResultDB] = usePersistedState<PayrollResult[]>("mock_payrollResultDB", []);

  /**
   * (tenantId, employeeId, targetYearMonth) を一意キーとする正規化。
   * 配列に同一タプルの重複が混入していた場合（手動編集・レガシー等）も1件に圧縮する。
   * 同タプルが複数あるときは「配列内で最後に現れたもの」を採用（last-write-wins）。
   * 元の配列順序は最初の出現位置を維持する。
   */
  const tupleKey = (p: PayrollResult) =>
    `${p.tenantId}::${p.employeeId}::${p.targetYearMonth}`;

  const dedupeByTuple = (list: PayrollResult[]): PayrollResult[] => {
    const lastByKey = new Map<string, PayrollResult>();
    for (const p of list) lastByKey.set(tupleKey(p), p);
    const seen = new Set<string>();
    const out: PayrollResult[] = [];
    for (const p of list) {
      const k = tupleKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(lastByKey.get(k)!);
    }
    return out;
  };

  /**
   * タプルキー一意性を保証する upsert。
   * 既存に同一タプルがあれば(複数あっても全て)除去し、incoming を末尾に追加する。
   * 既存 id があれば保持（最初の一致のものを再利用）。
   */
  const upsertPayrollResult = (
    list: PayrollResult[],
    incoming: PayrollResult,
  ): PayrollResult[] => {
    const matchTuple = (p: PayrollResult) =>
      p.tenantId === incoming.tenantId &&
      p.employeeId === incoming.employeeId &&
      p.targetYearMonth === incoming.targetYearMonth;
    const existing = list.find(matchTuple);
    const stripped = list.filter((p) => !matchTuple(p));
    const merged: PayrollResult = existing
      ? { ...incoming, id: existing.id }
      : incoming;
    return [...stripped, merged];
  };

  const handleLockOne = (result: PayrollResult) => {
    setPayrollResultDB((prev) => upsertPayrollResult(prev, result));
  };
  /**
   * 解除はタプル基準で行う（同タプルに重複idが残っていても全て除去）。
   * id を直接受け取って filter すると重複行のうち1件しか消えないため、
   * 解除対象の (employeeId, targetYearMonth) を渡してもらう。
   */
  const handleUnlockOne = (employeeId: string, targetYearMonth: string) => {
    setPayrollResultDB((prev) =>
      prev.filter(
        (p) =>
          !(
            p != null &&
            p.tenantId === DEFAULT_TENANT_ID &&
            p.employeeId === employeeId &&
            p.targetYearMonth === targetYearMonth
          ),
      ),
    );
  };
  const handleLockAll = (results: PayrollResult[]) => {
    setPayrollResultDB((prev) => results.reduce(upsertPayrollResult, prev));
  };
  const handleSaveEmployeeMaster = (
    master: EmployeeMaster,
    contractInput: Pick<ContractMaster, "salaryType" | "baseSalary">,
  ) => {
    setEmployeeDB((prev) => ({ ...prev, [master.id]: master }));
    setContractDB((prev) => {
      const idx = prev.findIndex((c) => c.employeeId === master.id && c.workplaceId === "default");
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...contractInput, tenantId: DEFAULT_TENANT_ID };
        return next;
      }
      return [
        ...prev,
        {
          tenantId: DEFAULT_TENANT_ID,
          id: `c_${master.id}_default`,
          employeeId: master.id,
          workplaceId: "default",
          ...contractInput,
        },
      ];
    });
  };

  // Add employee dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newPosition, setNewPosition] = useState("");

  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId) ?? employees[0];
  const selectedColor = COLOR_MAP[selectedEmployee.color];

  const handleSelectEmployee = (id: string) => {
    setSelectedEmployeeId(id);
    setActiveTab("payroll");
  };

  const handleOpenAddDialog = () => {
    setNewName("");
    setNewDepartment("");
    setNewPosition("");
    setAddDialogOpen(true);
  };

  const handleAddEmployee = () => {
    if (!newName.trim()) return;

    // Generate next EMP number based on current list
    const maxNum = employees.reduce((max, emp) => {
      const num = parseInt(emp.employeeNumber.replace("EMP", ""), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    const empNumber = `EMP${String(maxNum + 1).padStart(3, "0")}`;
    const newId = `e_${Date.now()}`;

    // カラーパレットを順番に循環して割り当て
    const nextColor = COLOR_PALETTE[employees.length % COLOR_PALETTE.length];

    const newEmployee: EmployeeRecord = {
      id: newId,
      employeeNumber: empNumber,
      name: newName.trim(),
      department: newDepartment.trim() || "未設定",
      position: newPosition.trim() || "未設定",
      joinDate: todayJP(),
      status: "在籍中",
      color: nextColor,
    };

    setEmployees((prev) => [...prev, newEmployee]);
    setSelectedEmployeeId(newId);
    setActiveTab("payroll");
    setAddDialogOpen(false);
  };

  const currentYyyymm = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const lockedIds = new Set(
    payrollResultDB
      .filter(
        (p) =>
          p != null &&
          p.tenantId === DEFAULT_TENANT_ID &&
          p.targetYearMonth === currentYyyymm &&
          p.status === "locked",
      )
      .map((p) => p.employeeId),
  );

  const sidebarProps: EmployeeSidebarProps = {
    employees,
    selectedId: selectedEmployeeId,
    onSelect: handleSelectEmployee,
    onAddClick: handleOpenAddDialog,
    lockedIds,
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-hidden">

        {/* ── 月切り替えヘッダー ── */}
        <div className="px-4 pt-3 pb-2 sm:px-6 flex-shrink-0">
          <MonthSwitcher currentDate={currentDate} onChange={setCurrentDate} />
        </div>

        {/* ── モバイル: 従業員リスト Sheetトリガー ── */}
        <div className="md:hidden px-4 pb-3 flex-shrink-0">
          <button
            onClick={() => setMobileSheetOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground hover:bg-secondary transition-colors w-full"
          >
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="flex-1 text-left">
              {selectedEmployee ? selectedEmployee.name : "従業員を選択"}
            </span>
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
              {employees.length}名
            </span>
          </button>
        </div>

        {/* ── メインエリア（サイドバー + 詳細） ── */}
        <div className="flex flex-1 overflow-hidden border-t border-border/40">

          {/* デスクトップ: 従業員縦サイドバー（常時表示） */}
          <aside className="hidden md:flex flex-col w-56 lg:w-64 border-r border-border flex-shrink-0 bg-muted/40">
            <EmployeeSidebarContent {...sidebarProps} />
          </aside>

          {/* 詳細エリア — 選択中従業員の色でごく薄く染める */}
          <div
            className="flex-1 overflow-y-auto transition-colors duration-300"
            style={{ backgroundColor: selectedColor.bg50 }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedEmployeeId}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18 }}
              >
                <div className="px-4 py-5 sm:px-6 lg:px-8 pb-16 max-w-3xl mx-auto">

                  {/* 従業員ヘッダー */}
                  <div className="flex items-center gap-3 mb-6">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-lg border-2 flex-shrink-0 transition-colors duration-300"
                      style={{
                        backgroundColor: selectedColor.avatar,
                        borderColor: selectedColor.border + "80",
                        color: selectedColor.text,
                      }}
                    >
                      {selectedEmployee.name[0]}
                    </div>
                    <div>
                      <h2
                        className="text-lg font-bold transition-colors duration-300"
                        style={{ color: selectedColor.text }}
                      >
                        {selectedEmployee.name}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {selectedEmployee.employeeNumber} &middot; {selectedEmployee.department} &middot; {selectedEmployee.position}
                      </p>
                    </div>
                  </div>

                  {/* タブ */}
                  <div className="inline-flex bg-secondary/80 p-1 rounded-2xl border border-border/50 shadow-inner mb-6">
                    {(["payroll", "info", "finalize"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        data-testid={`tab-${tab}`}
                        className={cn(
                          "relative px-5 py-2.5 text-sm font-semibold rounded-xl transition-colors z-10",
                          activeTab === tab ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {activeTab === tab && (
                          <motion.div
                            layoutId="activeTabIndicator"
                            className="absolute inset-0 bg-primary rounded-xl shadow-md"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
                          />
                        )}
                        <span className="relative z-20">{TAB_LABELS[tab]}</span>
                      </button>
                    ))}
                  </div>

                  {/* タブコンテンツ */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                    >
                      {activeTab === "payroll" ? (
                        <PayrollTab
                          key={selectedEmployeeId}
                          currentDate={currentDate}
                          employeeId={selectedEmployeeId}
                          employeeName={selectedEmployee.name}
                          workplaces={workplaces}
                          onAddWorkplace={handleAddWorkplace}
                          onUpdateWorkplace={handleUpdateWorkplace}
                          employeeDB={employeeDB}
                          payrollResultDB={payrollResultDB}
                          onLockOne={handleLockOne}
                          onUnlockOne={handleUnlockOne}
                        />
                      ) : activeTab === "info" ? (
                        <EmployeeInfoTab
                          key={selectedEmployeeId}
                          employee={selectedEmployee}
                          savedMaster={employeeDB[selectedEmployeeId]}
                          savedContract={contractDB.find((c) => c.employeeId === selectedEmployeeId && c.workplaceId === "default")}
                          onSave={handleSaveEmployeeMaster}
                        />
                      ) : (
                        <PayrollFinalizationTab
                          currentDate={currentDate}
                          employees={employees}
                          employeeDB={employeeDB}
                          contractDB={contractDB}
                          payrollResultDB={payrollResultDB}
                          onLockOne={handleLockOne}
                          onUnlockOne={handleUnlockOne}
                          onLockAll={handleLockAll}
                        />
                      )}
                    </motion.div>
                  </AnimatePresence>

                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── モバイル: 従業員リスト Sheet ── */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col">
          {/* SheetTitle は accessibility 用（非表示） */}
          <SheetTitle className="sr-only">従業員一覧</SheetTitle>
          <div className="flex-1 overflow-hidden flex flex-col pt-8">
            <EmployeeSidebarContent
              {...sidebarProps}
              onAfterSelect={() => setMobileSheetOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* ── 従業員追加 Dialog ── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>従業員を追加</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="new-name">
                名前 <span className="text-destructive">*</span>
              </label>
              <input
                id="new-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例：山田 太郎"
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all placeholder:text-muted-foreground/40"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="new-dept">
                部署
              </label>
              <input
                id="new-dept"
                type="text"
                value={newDepartment}
                onChange={(e) => setNewDepartment(e.target.value)}
                placeholder="例：営業部"
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all placeholder:text-muted-foreground/40"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="new-pos">
                役職
              </label>
              <input
                id="new-pos"
                type="text"
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                placeholder="例：主任"
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all placeholder:text-muted-foreground/40"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 mt-2">
            <DialogClose asChild>
              <button className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-secondary transition-colors">
                キャンセル
              </button>
            </DialogClose>
            <button
              onClick={handleAddEmployee}
              disabled={!newName.trim()}
              className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              追加
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
