import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MonthSwitcher } from "@/components/MonthSwitcher";
import { DUMMY_EMPLOYEE_DATA, EmployeeRecord, EmployeeColor } from "@/lib/dummy-data";
import { calculateIncomeTax, calcEffectiveRate } from "@/lib/taxCalculator";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, Info, User, Plus, Users } from "lucide-react";
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
// Utility
// ─────────────────────────────────────────────

function formatJPY(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
}

function toDisplayValue(digits: string): string {
  if (!digits) return "";
  return parseInt(digits, 10).toLocaleString("ja-JP");
}

function todayJP(): string {
  const d = new Date();
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, "0")}月${String(d.getDate()).padStart(2, "0")}日`;
}

// ─────────────────────────────────────────────
// 給与情報タブ: 所得税計算フォーム
// key={selectedEmployeeId} で従業員切替時にリセット
// ─────────────────────────────────────────────

function TaxCalculatorForm() {
  const [inputValue, setInputValue] = useState("");

  const rawDigits = inputValue.replace(/[^0-9]/g, "");
  const monthlySalary = rawDigits ? parseInt(rawDigits, 10) : 0;
  const incomeTax = calculateIncomeTax(monthlySalary);
  const effectiveRate = calcEffectiveRate(monthlySalary);
  const hasValue = monthlySalary > 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/[^0-9]/g, "");
    setInputValue(toDisplayValue(digits));
  };

  return (
    <div className="space-y-6 max-w-md">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Calculator className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">所得税シミュレーター</p>
          <p className="text-xs text-muted-foreground">甲欄・扶養親族0人（令和6年分）</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">月給（円）</label>
          <p className="text-xs text-muted-foreground">社会保険料控除前の総支給額を入力してください</p>
          <div className="relative mt-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold select-none">¥</span>
            <input
              type="text"
              inputMode="numeric"
              value={inputValue}
              onChange={handleChange}
              placeholder="300,000"
              className={cn(
                "w-full pl-8 pr-4 py-3.5 rounded-xl border bg-background text-foreground text-base font-medium",
                "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all",
                "placeholder:text-muted-foreground/40",
                hasValue ? "border-primary/30" : "border-border"
              )}
            />
          </div>
        </div>

        <div className="border-t border-border/60" />

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-foreground">源泉徴収税額（月額）</label>
          <p className="text-xs text-muted-foreground">入力値から自動計算されます</p>
          <div className={cn(
            "w-full px-4 py-3.5 rounded-xl border bg-background/50 transition-all",
            hasValue && incomeTax > 0 ? "border-primary/20 bg-primary/5" : "border-border/50"
          )}>
            <span className={cn(
              "text-2xl font-bold tabular-nums tracking-tight transition-colors",
              hasValue && incomeTax > 0 ? "text-primary" : "text-muted-foreground/40"
            )}>
              {hasValue ? formatJPY(incomeTax) : "¥ —"}
            </span>
          </div>
          {hasValue && (
            <div className="pt-1 space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>実効税率</span>
                <span className="font-semibold text-foreground tabular-nums">{effectiveRate.toFixed(2)} %</span>
              </div>
              {monthlySalary < 88_000 && (
                <p className="text-xs text-muted-foreground px-1">月額 88,000 円未満のため源泉徴収なし</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary/40" />
        <p>
          本計算は国税庁「給与所得の源泉徴収税額表（月額表）」電算機計算の特例に基づく甲欄・扶養親族0人の簡易計算です。
          社会保険料・住民税・各種控除は含まれておらず、実際の控除額と異なる場合があります。
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 社員情報タブ: プレースホルダー
// ─────────────────────────────────────────────

function EmployeeInfoPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center max-w-md">
      <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4">
        <User className="w-7 h-7 text-muted-foreground/50" />
      </div>
      <p className="text-base font-semibold text-foreground">社員情報エリア</p>
      <p className="text-sm text-muted-foreground mt-1.5">将来の拡張用エリアです。現在準備中です。</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// 従業員サイドバー（PC・モバイル共用コンテンツ）
// ─────────────────────────────────────────────

interface EmployeeSidebarProps {
  employees: EmployeeRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAddClick: () => void;
  onAfterSelect?: () => void;
}

// 各タブ項目: hoverをローカルstateで追跡してinline styleに渡す
function EmployeeTabButton({
  emp,
  isSelected,
  onSelect,
  onAfterSelect,
}: {
  emp: EmployeeRecord;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onAfterSelect?: () => void;
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
        <p className="truncate text-sm" style={{ color: isSelected ? c.text : undefined }}>
          {emp.name}
        </p>
        <p className="text-xs text-muted-foreground truncate">{emp.department}</p>
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

type TabType = "payroll" | "info";

export default function Dashboard() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 2, 1));
  const [employees, setEmployees] = useState<EmployeeRecord[]>(DUMMY_EMPLOYEE_DATA);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(DUMMY_EMPLOYEE_DATA[0].id);
  const [activeTab, setActiveTab] = useState<TabType>("payroll");

  // Mobile sheet state
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

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

  const sidebarProps: EmployeeSidebarProps = {
    employees,
    selectedId: selectedEmployeeId,
    onSelect: handleSelectEmployee,
    onAddClick: handleOpenAddDialog,
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
                    {(["payroll", "info"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                          "relative px-6 py-2.5 text-sm font-semibold rounded-xl transition-colors z-10",
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
                        <span className="relative z-20">
                          {tab === "payroll" ? "給与情報" : "社員情報"}
                        </span>
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
                        <TaxCalculatorForm key={selectedEmployeeId} />
                      ) : (
                        <EmployeeInfoPlaceholder />
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
