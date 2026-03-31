import { useState } from "react";
import { calculateIncomeTax, calcEffectiveRate } from "@/lib/taxCalculator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Calculator, Clock, Info, TrendingUp } from "lucide-react";

// ─────────────────────────────────────────────
// ユーティリティ
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

/** "HH:MM" 形式の2点から労働時間（小数）を返す */
function calcHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return Math.max(0, diff / 60);
}

// ─────────────────────────────────────────────
// タイムカードのダミーデータ
// ─────────────────────────────────────────────

type TimecardRow = {
  id: string;
  date: string;
  ocrStart: string;   // OCR打刻（生データ）
  ocrEnd: string;
  stdStart: string;   // 通常計上開始（丸め後）
  stdEnd: string;     // 通常計上終了
  earlyOvertime: boolean;
};

const INITIAL_TIMECARD: TimecardRow[] = [
  { id: "r1", date: "4/1（火）", ocrStart: "08:55", ocrEnd: "18:02", stdStart: "09:00", stdEnd: "18:00", earlyOvertime: false },
  { id: "r2", date: "4/2（水）", ocrStart: "08:48", ocrEnd: "18:15", stdStart: "09:00", stdEnd: "18:15", earlyOvertime: false },
  { id: "r3", date: "4/3（木）", ocrStart: "09:03", ocrEnd: "17:58", stdStart: "09:03", stdEnd: "17:58", earlyOvertime: false },
  { id: "r4", date: "4/4（金）", ocrStart: "08:51", ocrEnd: "19:30", stdStart: "09:00", stdEnd: "19:30", earlyOvertime: false },
];

// ─────────────────────────────────────────────
// 給与体系ピルトグル
// ─────────────────────────────────────────────

type PayType = "monthly" | "hourly";

function PayTypePills({
  value,
  onChange,
}: {
  value: PayType;
  onChange: (v: PayType) => void;
}) {
  return (
    <div className="inline-flex items-center bg-muted rounded-full p-1 gap-1">
      {(["monthly", "hourly"] as PayType[]).map((type) => {
        const active = value === type;
        return (
          <button
            key={type}
            onClick={() => onChange(type)}
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-200",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {type === "monthly" ? "月給制" : "時給制"}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// 月給入力エリア
// ─────────────────────────────────────────────

function MonthlyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const hasValue = value.replace(/[^0-9]/g, "").length > 0;
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-foreground">月給（円）</label>
      <p className="text-xs text-muted-foreground">社会保険料控除前の総支給額を入力してください</p>
      <div className="relative mt-1">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold select-none">
          ¥
        </span>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            onChange(toDisplayValue(digits));
          }}
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
  );
}

// ─────────────────────────────────────────────
// 時給入力 + タイムカードテーブル
// ─────────────────────────────────────────────

function HourlySection({
  hourlyRate,
  onHourlyRateChange,
  rows,
  onToggleEarlyOvertime,
  totalHours,
}: {
  hourlyRate: string;
  onHourlyRateChange: (v: string) => void;
  rows: TimecardRow[];
  onToggleEarlyOvertime: (id: string, checked: boolean) => void;
  totalHours: number;
}) {
  const hasRate = hourlyRate.replace(/[^0-9]/g, "").length > 0;
  return (
    <div className="space-y-5">
      {/* 基本時給入力 */}
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">基本時給（円）</label>
        <p className="text-xs text-muted-foreground">社会保険料控除前の基本時給を入力してください</p>
        <div className="relative mt-1 max-w-[200px]">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold select-none">
            ¥
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={hourlyRate}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^0-9]/g, "");
              onHourlyRateChange(toDisplayValue(digits));
            }}
            placeholder="1,200"
            className={cn(
              "w-full pl-8 pr-4 py-3.5 rounded-xl border bg-background text-foreground text-base font-medium",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all",
              "placeholder:text-muted-foreground/40",
              hasRate ? "border-primary/30" : "border-border"
            )}
          />
        </div>
      </div>

      {/* タイムカードテーブル */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">今月のタイムカード</span>
        </div>
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground w-[80px]">日付</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">OCR打刻</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">計上時間</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground">朝残業</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => {
                // 朝残業ONのとき、計上開始をOCR打刻に変更
                const effectiveStart = row.earlyOvertime ? row.ocrStart : row.stdStart;
                const effectiveEnd = row.stdEnd;
                return (
                  <tr key={row.id} className="bg-background hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-3 text-xs font-medium text-foreground whitespace-nowrap">
                      {row.date}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">
                      {row.ocrStart} – {row.ocrEnd}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      <span className="text-xs font-bold text-foreground">
                        {effectiveStart}
                      </span>
                      <span className="text-xs text-muted-foreground"> – </span>
                      <span className="text-xs font-bold text-foreground">
                        {effectiveEnd}
                      </span>
                      {row.earlyOvertime && (
                        <span className="ml-1.5 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                          朝残
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Switch
                        checked={row.earlyOvertime}
                        onCheckedChange={(checked) =>
                          onToggleEarlyOvertime(row.id, checked)
                        }
                        className="data-[state=checked]:bg-amber-500"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 当月総労働時間 */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-muted/40 rounded-xl border border-border/60">
          <span className="text-xs font-semibold text-muted-foreground">当月総労働時間（表示分）</span>
          <span className="text-sm font-bold text-foreground tabular-nums">
            {totalHours.toFixed(1)} 時間
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 共通 計算結果エリア
// ─────────────────────────────────────────────

function ResultCard({
  grossAmount,
  payType,
}: {
  grossAmount: number;
  payType: PayType;
}) {
  const incomeTax = calculateIncomeTax(grossAmount);
  const effectiveRate = calcEffectiveRate(grossAmount);
  const hasValue = grossAmount > 0;

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary" />
        <span className="text-sm font-bold text-foreground">支給額・控除額シミュレーション</span>
      </div>

      <div className="border-t border-border/60" />

      {/* 総支給額 */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {payType === "monthly" ? "月給制" : "時給制（時給 × 総労働時間）"}
        </p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
            {hasValue ? formatJPY(grossAmount) : "¥ —"}
          </span>
          <span className="text-xs text-muted-foreground">（総支給額）</span>
        </div>
      </div>

      {/* 源泉徴収税額 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">源泉徴収税額（月額）</p>
          <p className={cn(
            "text-xl font-bold tabular-nums",
            hasValue && incomeTax > 0 ? "text-primary" : "text-muted-foreground/40"
          )}>
            {hasValue ? formatJPY(incomeTax) : "¥ —"}
          </p>
        </div>
        <div className="bg-muted/40 border border-border/60 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">実効税率</p>
          <p className={cn(
            "text-xl font-bold tabular-nums",
            hasValue ? "text-foreground" : "text-muted-foreground/40"
          )}>
            {hasValue ? `${effectiveRate.toFixed(2)} %` : "— %"}
          </p>
        </div>
      </div>

      {/* 手取り参考値 */}
      {hasValue && (
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1 pt-1">
          <span>差引支給額（税引後・参考値）</span>
          <span className="font-bold text-foreground tabular-nums">
            {formatJPY(grossAmount - incomeTax)}
          </span>
        </div>
      )}

      {hasValue && grossAmount < 88_000 && (
        <p className="text-xs text-muted-foreground px-1">
          月額 88,000 円未満のため源泉徴収なし
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

export function PayrollTab() {
  // ── 給与体系切り替え ──
  const [payType, setPayType] = useState<PayType>("monthly");

  // ── 月給制 ──
  const [monthlySalaryInput, setMonthlySalaryInput] = useState("");

  // ── 時給制 ──
  const [hourlyRateInput, setHourlyRateInput] = useState("");
  const [timecardRows, setTimecardRows] = useState<TimecardRow[]>(INITIAL_TIMECARD);

  // タイムカード: 朝残業スイッチ切替
  const handleToggleEarlyOvertime = (id: string, checked: boolean) => {
    setTimecardRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, earlyOvertime: checked } : r))
    );
  };

  // 当月総労働時間（表示4行分）
  const totalHours = timecardRows.reduce((sum, row) => {
    const start = row.earlyOvertime ? row.ocrStart : row.stdStart;
    return sum + calcHours(start, row.stdEnd);
  }, 0);

  // ── 総支給額の計算 ──
  const monthlyRaw = parseInt(monthlySalaryInput.replace(/[^0-9]/g, ""), 10) || 0;
  const hourlyRaw = parseInt(hourlyRateInput.replace(/[^0-9]/g, ""), 10) || 0;
  // 時給制: 表示分の時間 + 固定ダミー残り（全体160時間）
  const DUMMY_TOTAL_HOURS = 160;
  const grossAmount =
    payType === "monthly"
      ? monthlyRaw
      : Math.round(hourlyRaw * DUMMY_TOTAL_HOURS);

  return (
    <div className="space-y-6 max-w-xl">
      {/* ── ヘッダー + 給与体系ピル ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Calculator className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">所得税シミュレーター</p>
            <p className="text-xs text-muted-foreground">甲欄・扶養親族0人（令和6年分）</p>
          </div>
        </div>
        <PayTypePills value={payType} onChange={setPayType} />
      </div>

      {/* ── 入力エリア（体系別） ── */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-5">
        {payType === "monthly" ? (
          <MonthlyInput
            value={monthlySalaryInput}
            onChange={setMonthlySalaryInput}
          />
        ) : (
          <HourlySection
            hourlyRate={hourlyRateInput}
            onHourlyRateChange={setHourlyRateInput}
            rows={timecardRows}
            onToggleEarlyOvertime={handleToggleEarlyOvertime}
            totalHours={totalHours}
          />
        )}
      </div>

      {/* ── 計算結果カード ── */}
      <ResultCard grossAmount={grossAmount} payType={payType} />

      {/* ── 注記 ── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary/40" />
        <p>
          本計算は国税庁「給与所得の源泉徴収税額表（月額表）」電算機計算の特例に基づく甲欄・扶養親族0人の簡易計算です。
          時給制の総支給額は基本時給 × 160時間（ダミー）で算出しています。
          社会保険料・住民税・各種控除は含まれておらず、実際の控除額と異なる場合があります。
        </p>
      </div>
    </div>
  );
}
