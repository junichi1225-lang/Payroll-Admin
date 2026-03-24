import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { calculateIncomeTax, calcEffectiveRate } from "@/lib/taxCalculator";
import { cn } from "@/lib/utils";
import { Calculator, Info } from "lucide-react";

function formatJPY(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatInputDisplay(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return "";
  return parseInt(digits, 10).toLocaleString("ja-JP");
}

export default function Dashboard() {
  const [inputValue, setInputValue] = useState<string>("");

  const rawDigits = inputValue.replace(/[^0-9]/g, "");
  const monthlySalary = rawDigits ? parseInt(rawDigits, 10) : 0;
  const incomeTax = calculateIncomeTax(monthlySalary);
  const effectiveRate = calcEffectiveRate(monthlySalary);
  const hasValue = monthlySalary > 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/[^0-9]/g, "");
    setInputValue(digits ? formatInputDisplay(digits) : "");
  };

  return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-full px-4 py-12">
        <div className="w-full max-w-md">

          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Calculator className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">所得税シミュレーター</h1>
              <p className="text-xs text-muted-foreground mt-0.5">甲欄・扶養親族0人（令和6年分）</p>
            </div>
          </div>

          {/* Input Card */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">

            {/* Monthly Salary Input */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-foreground">
                月給（円）
              </label>
              <p className="text-xs text-muted-foreground">社会保険料控除前の総支給額を入力してください</p>
              <div className="relative mt-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold select-none">
                  ¥
                </span>
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

            {/* Divider */}
            <div className="border-t border-border/60" />

            {/* Result Area */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-foreground">
                源泉徴収税額（月額）
              </label>
              <p className="text-xs text-muted-foreground">入力値から自動計算されます</p>
              <div className={cn(
                "w-full px-4 py-3.5 rounded-xl border bg-background/50 transition-all",
                hasValue && incomeTax > 0
                  ? "border-primary/20 bg-primary/3"
                  : "border-border/50"
              )}>
                <span className={cn(
                  "text-2xl font-bold tabular-nums tracking-tight transition-colors",
                  hasValue && incomeTax > 0 ? "text-primary" : "text-muted-foreground/50"
                )}>
                  {hasValue ? formatJPY(incomeTax) : "¥ —"}
                </span>
              </div>

              {/* Effective rate + breakdown */}
              {hasValue && (
                <div className="pt-1 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                    <span>実効税率</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {effectiveRate.toFixed(2)} %
                    </span>
                  </div>
                  {monthlySalary < 88_000 && (
                    <p className="text-xs text-muted-foreground px-1">
                      月額 88,000 円未満のため源泉徴収なし
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Note */}
          <div className="flex items-start gap-2.5 mt-4 px-1 text-xs text-muted-foreground">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary/40" />
            <p>
              本計算は国税庁「給与所得の源泉徴収税額表（月額表）」電算機計算の特例に基づく甲欄・扶養親族0人の簡易計算です。
              社会保険料・住民税・各種控除は含まれておらず、実際の控除額と異なる場合があります。
            </p>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
