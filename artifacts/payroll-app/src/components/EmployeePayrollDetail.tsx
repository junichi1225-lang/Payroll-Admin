import { useState, useMemo } from "react";
import { PayrollRecord } from "@/lib/dummy-data";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2, AlertCircle, Calculator, Banknote, TrendingDown, TrendingUp, Info } from "lucide-react";

interface EmployeePayrollDetailProps {
  payroll: PayrollRecord | undefined;
  currentDate: Date;
}

function calcIncomeTax(monthlySalary: number): number {
  if (monthlySalary <= 0) return 0;
  const annual = monthlySalary * 12;
  const basicDeduction = 480000;
  const taxable = Math.max(0, annual - basicDeduction);

  const brackets = [
    { limit: 1950000, rate: 0.05, offset: 0 },
    { limit: 3300000, rate: 0.10, offset: 97500 },
    { limit: 6950000, rate: 0.20, offset: 427500 },
    { limit: 9000000, rate: 0.23, offset: 636000 },
    { limit: 18000000, rate: 0.33, offset: 1536000 },
    { limit: 40000000, rate: 0.40, offset: 2796000 },
    { limit: Infinity, rate: 0.45, offset: 4796000 },
  ];

  let annualTax = 0;
  for (const b of brackets) {
    if (taxable <= b.limit) {
      annualTax = taxable * b.rate - b.offset;
      break;
    }
  }

  const monthly = Math.max(0, Math.floor(annualTax / 12));
  return monthly;
}

export function EmployeePayrollDetail({ payroll, currentDate }: EmployeePayrollDetailProps) {
  const [simulationSalary, setSimulationSalary] = useState<string>("");

  const simSalary = parseInt(simulationSalary.replace(/,/g, ""), 10) || 0;
  const simTax = useMemo(() => calcIncomeTax(simSalary), [simSalary]);
  const simEffectiveRate = simSalary > 0 ? ((simTax / simSalary) * 100).toFixed(1) : "0.0";

  const monthLabel = `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;

  const handleSalaryInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setSimulationSalary(raw ? parseInt(raw, 10).toLocaleString() : "");
  };

  if (!payroll) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-card rounded-3xl border border-border/50 border-dashed">
        <Banknote className="w-12 h-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-bold text-foreground">給与データなし</h3>
        <p className="mt-2 text-sm text-muted-foreground">{monthLabel}の給与データは未登録です。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Monthly Status Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{monthLabel}の給与明細</p>
        <Badge variant={payroll.status === "確定済み" ? "success" : "warning"} className="px-3 py-1">
          {payroll.status === "確定済み"
            ? <><CheckCircle2 className="w-3 h-3 mr-1.5" />確定済み</>
            : <><AlertCircle className="w-3 h-3 mr-1.5" />未確定</>
          }
        </Badge>
      </div>

      {/* Payroll Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium mb-1.5">基本給</p>
          <p className="text-lg font-bold text-foreground">{formatCurrency(payroll.baseSalary)}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium mb-1.5">各種手当</p>
          <p className="text-lg font-bold text-emerald-600">+{formatCurrency(payroll.allowances)}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium mb-1.5">控除合計</p>
          <p className="text-lg font-bold text-destructive">-{formatCurrency(payroll.deductions)}</p>
        </div>
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 shadow-sm col-span-2 sm:col-span-1">
          <p className="text-xs text-primary/70 font-medium mb-1.5">支給総額</p>
          <p className="text-lg font-bold text-primary">{formatCurrency(payroll.netPay)}</p>
        </div>
      </div>

      {/* Breakdown Bar */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground mb-4">給与内訳</h3>
        <div className="space-y-3">
          {[
            { label: "基本給", value: payroll.baseSalary, color: "bg-primary", icon: TrendingUp },
            { label: "各種手当", value: payroll.allowances, color: "bg-emerald-500", icon: TrendingUp },
            { label: "控除", value: payroll.deductions, color: "bg-destructive", icon: TrendingDown },
          ].map((row) => {
            const total = payroll.baseSalary + payroll.allowances;
            const pct = Math.round((row.value / total) * 100);
            return (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-medium">{row.label}</span>
                  <span className="font-semibold text-foreground">{formatCurrency(row.value)}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full ${row.color} rounded-full transition-all duration-700`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Income Tax Simulator */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Calculator className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">所得税シミュレーター</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-5">月給を入力すると、源泉徴収税額をリアルタイムで計算します（扶養親族0人の簡易計算）。</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">月給（円）</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">¥</span>
              <input
                type="text"
                inputMode="numeric"
                value={simulationSalary}
                onChange={handleSalaryInput}
                placeholder="300,000"
                className="w-full pl-8 pr-4 py-3 rounded-xl border border-border bg-background text-foreground text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all placeholder:text-muted-foreground/40"
              />
            </div>
          </div>

          {simSalary > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="bg-secondary/60 rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">月給</p>
                <p className="text-base font-bold text-foreground">{formatCurrency(simSalary)}</p>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center dark:bg-red-950/20 dark:border-red-900/30">
                <p className="text-xs text-muted-foreground mb-1">推定所得税（月額）</p>
                <p className="text-base font-bold text-destructive">{formatCurrency(simTax)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">実効税率 {simEffectiveRate}%</p>
              </div>
              <div className="bg-primary/5 border border-primary/15 rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">手取り概算</p>
                <p className="text-base font-bold text-primary">{formatCurrency(simSalary - simTax)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">※社保除く</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/40 rounded-xl p-3 mt-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary/50" />
            <p>
              所得税は給与所得控除・基礎控除（48万円）を適用した課税所得に対し、累進税率で算出しています。
              社会保険料・住民税は含まれていません。実際の控除額は源泉徴収税額表に基づきます。
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}
