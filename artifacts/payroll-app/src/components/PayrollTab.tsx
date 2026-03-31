import { useState, useRef, useEffect, Fragment } from "react";
import { calculateIncomeTax, calcEffectiveRate } from "@/lib/taxCalculator";
import { getTimecardEntries, TimecardEntry, TimecardOcrStatus } from "@/lib/dummy-data";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Calculator, Clock, Info, TrendingUp, Upload, Loader2,
  CheckCircle2, AlertCircle, Plus, ScanLine, ChevronDown,
  CalendarDays, Moon, Sunrise,
} from "lucide-react";

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

function formatJPY(amount: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount);
}

function toDisplayValue(digits: string): string {
  if (!digits) return "";
  return parseInt(digits, 10).toLocaleString("ja-JP");
}

function calcHours(start: string, end: string): number {
  if (!start || !end || start === "--:--" || end === "--:--") return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
}

function monthLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

// ─────────────────────────────────────────────
// 職場マスタ
// ─────────────────────────────────────────────

const WORKPLACES = {
  A: { label: "職場A", breakMinutes: 60, color: "text-blue-600 bg-blue-50 border-blue-200" },
  B: { label: "職場B", breakMinutes: 45, color: "text-violet-600 bg-violet-50 border-violet-200" },
  C: { label: "職場C", breakMinutes: 30, color: "text-teal-600 bg-teal-50 border-teal-200" },
} as const;

type Workplace = keyof typeof WORKPLACES;

// ─────────────────────────────────────────────
// タイムカード行型（UI ステート込み）
// ─────────────────────────────────────────────

type TimecardRow = TimecardEntry & {
  editStart: string;
  editEnd: string;
  // 職場・休憩
  workplace: Workplace;
  breakMinutes: number;
  // 詳細パネル
  earlyOvertime: boolean;
  lateNightPremium: boolean;
  note: string;
  expanded: boolean;
};

function entryToRow(entry: TimecardEntry): TimecardRow {
  return {
    ...entry,
    editStart: "", editEnd: "",
    workplace: "A",
    breakMinutes: WORKPLACES.A.breakMinutes,
    earlyOvertime: false,
    lateNightPremium: false,
    note: "",
    expanded: false,
  };
}

let manualRowCounter = 0;

// ─────────────────────────────────────────────
// 給与体系ピルトグル
// ─────────────────────────────────────────────

type PayType = "monthly" | "hourly";

function PayTypePills({ value, onChange }: { value: PayType; onChange: (v: PayType) => void }) {
  return (
    <div className="inline-flex items-center bg-muted rounded-full p-1 gap-1">
      {(["monthly", "hourly"] as PayType[]).map((type) => (
        <button key={type} onClick={() => onChange(type)}
          className={cn(
            "px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-200",
            value === type ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {type === "monthly" ? "月給制" : "時給制"}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// 月給入力
// ─────────────────────────────────────────────

function MonthlyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hasValue = value.replace(/[^0-9]/g, "").length > 0;
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-foreground">月給（円）</label>
      <p className="text-xs text-muted-foreground">社会保険料控除前の総支給額を入力してください</p>
      <div className="relative mt-1">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold select-none">¥</span>
        <input
          type="text" inputMode="numeric" value={value} placeholder="300,000"
          onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ""); onChange(toDisplayValue(d)); }}
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
// OCR アップロードバナー
// ─────────────────────────────────────────────

type OcrState = "idle" | "loading" | "done";

function OcrUploadBanner({ ocrState, onFileSelect }: { ocrState: OcrState; onFileSelect: (f: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className={cn(
      "rounded-xl border-2 border-dashed p-4 flex flex-col sm:flex-row items-center gap-3 transition-colors",
      ocrState === "loading" ? "border-primary/30 bg-primary/5"
        : ocrState === "done" ? "border-green-400/40 bg-green-50/60"
        : "border-border hover:border-primary/40 hover:bg-muted/30"
    )}>
      <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(f); e.target.value = ""; }} />
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
          ocrState === "loading" ? "bg-primary/10" : ocrState === "done" ? "bg-green-100" : "bg-muted")}>
          {ocrState === "loading" ? <Loader2 className="w-5 h-5 text-primary animate-spin" />
            : ocrState === "done" ? <CheckCircle2 className="w-5 h-5 text-green-600" />
            : <ScanLine className="w-5 h-5 text-muted-foreground" />}
        </div>
        <div className="min-w-0">
          {ocrState === "loading"
            ? <><p className="text-sm font-semibold text-primary">AI解析中...</p><p className="text-xs text-muted-foreground">タイムカード画像を読み取っています</p></>
            : ocrState === "done"
            ? <><p className="text-sm font-semibold text-green-700">読み込み完了</p><p className="text-xs text-muted-foreground">エラー行を手修正してください</p></>
            : <><p className="text-sm font-semibold text-foreground">タイムカードをOCRで読み込む</p><p className="text-xs text-muted-foreground">画像・PDF をアップロードしてAI解析</p></>}
        </div>
      </div>
      <button disabled={ocrState === "loading"} onClick={() => fileRef.current?.click()}
        className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex-shrink-0",
          ocrState === "loading" ? "bg-muted text-muted-foreground cursor-not-allowed"
            : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm")}>
        {ocrState === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {ocrState === "loading" ? "解析中..." : ocrState === "done" ? "再読込" : "ファイルを選択"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// タイムカードテーブル
// ─────────────────────────────────────────────

interface TimecardTableProps {
  rows: TimecardRow[];
  currentDate: Date;
  totalHours: number;
  onWorkplaceChange: (id: string, wp: Workplace) => void;
  onBreakMinutesChange: (id: string, mins: number) => void;
  onEditTime: (id: string, field: "editStart" | "editEnd", value: string) => void;
  onToggleEarlyOvertime: (id: string, checked: boolean) => void;
  onToggleLateNight: (id: string, checked: boolean) => void;
  onNoteChange: (id: string, note: string) => void;
  onToggleExpanded: (id: string) => void;
  onAddManualRow: () => void;
}

function TimecardTable({
  rows, currentDate, totalHours,
  onWorkplaceChange, onBreakMinutesChange, onEditTime,
  onToggleEarlyOvertime, onToggleLateNight, onNoteChange,
  onToggleExpanded, onAddManualRow,
}: TimecardTableProps) {
  const errorCount = rows.filter(
    (r) => (r.ocrStatus === "error" || r.ocrStatus === "manual") && !(r.editStart && r.editEnd)
  ).length;

  // 列数（ステータス / 日付 / 職場 / OCR打刻 / 計上時間 / 休憩 / 詳細）
  const COL_SPAN = 7;

  return (
    <div className="space-y-2">
      {/* テーブルヘッダー */}
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">{monthLabel(currentDate)} のタイムカード</span>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} 件</span>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
            <AlertCircle className="w-3 h-3" />要修正 {errorCount} 件
          </span>
        )}
      </div>

      {/* データなし */}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center space-y-1.5">
          <CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-semibold text-muted-foreground/60">{monthLabel(currentDate)} のデータがありません</p>
          <p className="text-xs text-muted-foreground/40">OCRで読み込むか、手動で行を追加してください</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-2 py-2.5 w-7"></th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[68px]">日付</th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[100px]">職場</th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground">OCR打刻</th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground">計上時間</th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[82px]">休憩(分)</th>
                <th className="px-2 py-2.5 w-[52px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isError = row.ocrStatus === "error";
                const isManual = row.ocrStatus === "manual";
                const needsInput = isError || isManual;
                const hasEditedBoth = !!(row.editStart && row.editEnd);
                const resolved = row.ocrStatus === "success" || (needsInput && hasEditedBoth);

                // 計上時間の実効値
                const effectiveStart = needsInput
                  ? (row.editStart || "--:--")
                  : row.earlyOvertime ? row.ocrStart : row.stdStart;
                const effectiveEnd = needsInput ? (row.editEnd || "--:--") : row.stdEnd;

                // 正味労働時間（この行）
                const gross = calcHours(effectiveStart, effectiveEnd);
                const net = gross > 0 ? Math.max(0, gross - row.breakMinutes / 60) : 0;

                const wp = WORKPLACES[row.workplace] ?? WORKPLACES.A;
                const rowBg = row.expanded ? "bg-primary/[.03]"
                  : isError && !hasEditedBoth ? "bg-red-50/60"
                  : isManual && !hasEditedBoth ? "bg-blue-50/40"
                  : "bg-background hover:bg-muted/20";

                return (
                  <Fragment key={row.id}>
                    {/* ── メイン行 ── */}
                    <tr className={cn("transition-colors", rowBg)}>

                      {/* ステータスアイコン */}
                      <td className="px-2 py-2.5 text-center">
                        {resolved
                          ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                          : isError
                          ? <AlertCircle className="w-4 h-4 text-red-500 mx-auto" />
                          : <div className="w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground/40 mx-auto" />
                        }
                      </td>

                      {/* 日付 */}
                      <td className="px-2 py-2.5 text-xs font-medium text-foreground whitespace-nowrap">
                        {row.date}
                      </td>

                      {/* 職場選択 */}
                      <td className="px-2 py-2.5">
                        <Select
                          value={row.workplace}
                          onValueChange={(v) => onWorkplaceChange(row.id, v as Workplace)}
                        >
                          <SelectTrigger className={cn(
                            "h-7 text-xs px-2 w-[90px] border font-semibold rounded-lg",
                            wp.color
                          )}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.entries(WORKPLACES) as [Workplace, typeof WORKPLACES.A][]).map(([key, def]) => (
                              <SelectItem key={key} value={key} className="text-xs">
                                {def.label}
                                <span className="ml-2 text-muted-foreground">休憩{def.breakMinutes}分</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>

                      {/* OCR打刻 / エラー行インプット */}
                      <td className="px-2 py-2.5">
                        {needsInput ? (
                          <div className="flex items-center gap-1">
                            <input type="time" value={row.editStart}
                              onChange={(e) => onEditTime(row.id, "editStart", e.target.value)}
                              className={cn(
                                "w-[86px] px-2 py-1.5 rounded-lg border text-xs font-medium bg-background",
                                "focus:outline-none focus:ring-2 transition-all",
                                !row.editStart && isError
                                  ? "border-red-400 focus:ring-red-200 focus:border-red-500"
                                  : "border-border focus:ring-primary/20 focus:border-primary/50"
                              )}
                            />
                            <span className="text-muted-foreground text-xs">–</span>
                            <input type="time" value={row.editEnd}
                              onChange={(e) => onEditTime(row.id, "editEnd", e.target.value)}
                              className={cn(
                                "w-[86px] px-2 py-1.5 rounded-lg border text-xs font-medium bg-background",
                                "focus:outline-none focus:ring-2 transition-all",
                                !row.editEnd && isError
                                  ? "border-red-400 focus:ring-red-200 focus:border-red-500"
                                  : "border-border focus:ring-primary/20 focus:border-primary/50"
                              )}
                            />
                            {isError && !hasEditedBoth && (
                              <span className="text-[10px] text-red-600 font-semibold bg-red-50 border border-red-200 rounded px-1 py-0.5 whitespace-nowrap">要修正</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {row.ocrStart} – {row.ocrEnd}
                          </span>
                        )}
                      </td>

                      {/* 計上時間 */}
                      <td className="px-2 py-2.5 tabular-nums">
                        {effectiveStart === "--:--" || effectiveEnd === "--:--" ? (
                          <span className="text-xs text-muted-foreground/50">--:-- – --:--</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-bold text-foreground">
                              {effectiveStart}
                              <span className="font-normal text-muted-foreground"> – </span>
                              {effectiveEnd}
                            </span>
                            {net > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                実働 {net.toFixed(1)}h
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 休憩時間 */}
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min={0} max={120} step={15}
                            value={row.breakMinutes}
                            onChange={(e) => onBreakMinutesChange(row.id, parseInt(e.target.value, 10) || 0)}
                            className="w-[46px] px-1.5 py-1.5 rounded-lg border border-border text-xs font-medium text-center bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
                          />
                          <span className="text-xs text-muted-foreground">分</span>
                        </div>
                      </td>

                      {/* 詳細トグル */}
                      <td className="px-1 py-2.5 text-right">
                        <button
                          onClick={() => onToggleExpanded(row.id)}
                          className={cn(
                            "inline-flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors",
                            row.expanded
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                          aria-label={row.expanded ? "詳細を閉じる" : "詳細を表示"}
                          aria-expanded={row.expanded}
                        >
                          <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", row.expanded && "rotate-180")} />
                        </button>
                      </td>
                    </tr>

                    {/* ── 詳細パネル行（アコーディオン） ── */}
                    <tr className={cn(rowBg)}>
                      <td colSpan={COL_SPAN} className="p-0 border-0">
                        <div
                          aria-hidden={!row.expanded}
                          className={cn(
                            "grid transition-all duration-200 ease-in-out",
                            row.expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                          )}
                        >
                          <div className="overflow-hidden">
                            <div className="px-4 py-3 border-t border-border/40 bg-muted/30">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

                                {/* 朝残業トグル */}
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                                    <Sunrise className="w-4 h-4 text-amber-600" />
                                  </div>
                                  <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                                    <div>
                                      <p className="text-xs font-semibold text-foreground">朝残業（早出）</p>
                                      <p className="text-[10px] text-muted-foreground">始業前を労働時間に含める</p>
                                    </div>
                                    <Switch
                                      checked={row.earlyOvertime}
                                      onCheckedChange={(c) => onToggleEarlyOvertime(row.id, c)}
                                      className="data-[state=checked]:bg-amber-500 flex-shrink-0"
                                    />
                                  </div>
                                </div>

                                {/* 深夜割増トグル */}
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center flex-shrink-0">
                                    <Moon className="w-4 h-4 text-indigo-600" />
                                  </div>
                                  <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                                    <div>
                                      <p className="text-xs font-semibold text-foreground">深夜割増（22時以降）</p>
                                      <p className="text-[10px] text-muted-foreground">25%割増賃金を適用する</p>
                                    </div>
                                    <Switch
                                      checked={row.lateNightPremium}
                                      onCheckedChange={(c) => onToggleLateNight(row.id, c)}
                                      className="data-[state=checked]:bg-indigo-500 flex-shrink-0"
                                    />
                                  </div>
                                </div>

                                {/* 備考 */}
                                <div className="space-y-1.5">
                                  <p className="text-xs font-semibold text-foreground">備考</p>
                                  <input
                                    type="text"
                                    value={row.note}
                                    onChange={(e) => onNoteChange(row.id, e.target.value)}
                                    placeholder="特記事項を入力..."
                                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
                                  />
                                </div>

                              </div>
                              {/* インジケーター（朝残業・深夜割増がONのとき） */}
                              {(row.earlyOvertime || row.lateNightPremium) && (
                                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/40">
                                  {row.earlyOvertime && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                      <Sunrise className="w-3 h-3" />朝残業 適用中
                                    </span>
                                  )}
                                  {row.lateNightPremium && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                                      <Moon className="w-3 h-3" />深夜割増 適用中
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 手動追加 */}
      <button onClick={onAddManualRow}
        className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-lg border border-dashed border-border transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />打刻行を手動で追加
      </button>

      {/* 総労働時間 */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-muted/40 rounded-xl border border-border/60">
        <span className="text-xs font-semibold text-muted-foreground">
          {monthLabel(currentDate)} 正味労働時間（休憩差引後）
        </span>
        <span className="text-sm font-bold text-foreground tabular-nums">{totalHours.toFixed(1)} 時間</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 時給セクション
// ─────────────────────────────────────────────

function HourlySection(props: {
  hourlyRate: string; onHourlyRateChange: (v: string) => void;
  rows: TimecardRow[]; currentDate: Date; ocrState: OcrState;
  onFileSelect: (f: File) => void; totalHours: number;
} & Omit<TimecardTableProps, "rows" | "currentDate" | "totalHours">) {
  const { hourlyRate, onHourlyRateChange, rows, currentDate, ocrState, onFileSelect, totalHours, ...tableProps } = props;
  const hasRate = hourlyRate.replace(/[^0-9]/g, "").length > 0;
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">基本時給（円）</label>
        <p className="text-xs text-muted-foreground">社会保険料控除前の基本時給を入力してください</p>
        <div className="relative mt-1 max-w-[200px]">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold select-none">¥</span>
          <input
            type="text" inputMode="numeric" value={hourlyRate} placeholder="1,200"
            onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ""); onHourlyRateChange(toDisplayValue(d)); }}
            className={cn(
              "w-full pl-8 pr-4 py-3.5 rounded-xl border bg-background text-foreground text-base font-medium",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all",
              "placeholder:text-muted-foreground/40",
              hasRate ? "border-primary/30" : "border-border"
            )}
          />
        </div>
      </div>
      <OcrUploadBanner ocrState={ocrState} onFileSelect={onFileSelect} />
      <TimecardTable rows={rows} currentDate={currentDate} totalHours={totalHours} {...tableProps} />
    </div>
  );
}

// ─────────────────────────────────────────────
// 計算結果カード
// ─────────────────────────────────────────────

function ResultCard({ grossAmount, payType, currentDate }: { grossAmount: number; payType: PayType; currentDate: Date }) {
  const incomeTax = calculateIncomeTax(grossAmount);
  const effectiveRate = calcEffectiveRate(grossAmount);
  const hasValue = grossAmount > 0;
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold text-foreground">支給額・控除額シミュレーション</span>
        </div>
        <span className="text-xs text-muted-foreground">{monthLabel(currentDate)}</span>
      </div>
      <div className="border-t border-border/60" />
      <div className="space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {payType === "monthly" ? "月給制" : "時給制（時給 × 正味労働時間）"}
        </p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
            {hasValue ? formatJPY(grossAmount) : "¥ —"}
          </span>
          <span className="text-xs text-muted-foreground">（総支給額）</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">源泉徴収税額（月額）</p>
          <p className={cn("text-xl font-bold tabular-nums", hasValue && incomeTax > 0 ? "text-primary" : "text-muted-foreground/40")}>
            {hasValue ? formatJPY(incomeTax) : "¥ —"}
          </p>
        </div>
        <div className="bg-muted/40 border border-border/60 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">実効税率</p>
          <p className={cn("text-xl font-bold tabular-nums", hasValue ? "text-foreground" : "text-muted-foreground/40")}>
            {hasValue ? `${effectiveRate.toFixed(2)} %` : "— %"}
          </p>
        </div>
      </div>
      {hasValue && (
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1 pt-1">
          <span>差引支給額（税引後・参考値）</span>
          <span className="font-bold text-foreground tabular-nums">{formatJPY(grossAmount - incomeTax)}</span>
        </div>
      )}
      {hasValue && grossAmount < 88_000 && (
        <p className="text-xs text-muted-foreground px-1">月額 88,000 円未満のため源泉徴収なし</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

interface PayrollTabProps {
  currentDate: Date;
  employeeId: string;
}

export function PayrollTab({ currentDate, employeeId }: PayrollTabProps) {
  const [payType, setPayType] = useState<PayType>("monthly");
  const [monthlySalaryInput, setMonthlySalaryInput] = useState("");
  const [hourlyRateInput, setHourlyRateInput] = useState("");
  const [timecardRows, setTimecardRows] = useState<TimecardRow[]>([]);
  const [ocrState, setOcrState] = useState<OcrState>("idle");

  // 月 / 従業員変更 → タイムカードリロード
  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const entries = getTimecardEntries(employeeId, year, month);
    setTimecardRows(entries.map(entryToRow));
    setOcrState("idle");
  }, [currentDate, employeeId]);

  // OCR
  const handleFileSelect = (_file: File) => {
    setOcrState("loading");
    setTimeout(() => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const entries = getTimecardEntries(employeeId, year, month);
      setTimecardRows(entries.map(entryToRow));
      setOcrState("done");
    }, 2500);
  };

  // 職場変更 → 休憩時間のスマートデフォルトも更新
  const handleWorkplaceChange = (id: string, wp: Workplace) => {
    setTimecardRows((prev) => prev.map((r) =>
      r.id === id ? { ...r, workplace: wp, breakMinutes: WORKPLACES[wp].breakMinutes } : r
    ));
  };

  const handleBreakMinutesChange = (id: string, mins: number) => {
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, breakMinutes: mins } : r));
  };

  // エラー行の手修正 → 両方入力でステータス昇格
  const handleEditTime = (id: string, field: "editStart" | "editEnd", value: string) => {
    setTimecardRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      const newStart = field === "editStart" ? value : r.editStart;
      const newEnd   = field === "editEnd"   ? value : r.editEnd;
      if (newStart && newEnd) {
        return { ...updated, ocrStatus: "success" as TimecardOcrStatus, ocrStart: newStart, ocrEnd: newEnd, stdStart: newStart, stdEnd: newEnd };
      }
      return updated;
    }));
  };

  const handleToggleEarlyOvertime = (id: string, checked: boolean) => {
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, earlyOvertime: checked } : r));
  };

  const handleToggleLateNight = (id: string, checked: boolean) => {
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, lateNightPremium: checked } : r));
  };

  const handleNoteChange = (id: string, note: string) => {
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, note } : r));
  };

  const handleToggleExpanded = (id: string) => {
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, expanded: !r.expanded } : r));
  };

  const handleAddManualRow = () => {
    const d = currentDate;
    manualRowCounter += 1;
    setTimecardRows((prev) => [
      ...prev,
      {
        id: `m${manualRowCounter}`,
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        year: d.getFullYear(), month: d.getMonth() + 1,
        ocrStatus: "manual",
        ocrStart: "", ocrEnd: "", editStart: "", editEnd: "",
        stdStart: "--:--", stdEnd: "--:--",
        workplace: "A", breakMinutes: WORKPLACES.A.breakMinutes,
        earlyOvertime: false, lateNightPremium: false, note: "", expanded: false,
      },
    ]);
  };

  // 正味総労働時間（休憩差引後）
  const totalHours = timecardRows.reduce((sum, row) => {
    const needsInput = row.ocrStatus === "error" || row.ocrStatus === "manual";
    const start = needsInput ? row.editStart : (row.earlyOvertime ? row.ocrStart : row.stdStart);
    const end   = needsInput ? row.editEnd   : row.stdEnd;
    const gross = calcHours(start, end);
    return sum + (gross > 0 ? Math.max(0, gross - row.breakMinutes / 60) : 0);
  }, 0);

  // 総支給額
  const monthlyRaw = parseInt(monthlySalaryInput.replace(/[^0-9]/g, ""), 10) || 0;
  const hourlyRaw  = parseInt(hourlyRateInput.replace(/[^0-9]/g, ""), 10) || 0;
  const grossAmount = payType === "monthly" ? monthlyRaw : Math.round(hourlyRaw * totalHours);

  const tableHandlers: Omit<TimecardTableProps, "rows" | "currentDate" | "totalHours"> = {
    onWorkplaceChange: handleWorkplaceChange,
    onBreakMinutesChange: handleBreakMinutesChange,
    onEditTime: handleEditTime,
    onToggleEarlyOvertime: handleToggleEarlyOvertime,
    onToggleLateNight: handleToggleLateNight,
    onNoteChange: handleNoteChange,
    onToggleExpanded: handleToggleExpanded,
    onAddManualRow: handleAddManualRow,
  };

  return (
    <div className="space-y-6 max-w-xl">
      {/* ヘッダー */}
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

      {/* 入力カード */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-5">
        {payType === "monthly" ? (
          <MonthlyInput value={monthlySalaryInput} onChange={setMonthlySalaryInput} />
        ) : (
          <HourlySection
            hourlyRate={hourlyRateInput} onHourlyRateChange={setHourlyRateInput}
            rows={timecardRows} currentDate={currentDate}
            ocrState={ocrState} onFileSelect={handleFileSelect}
            totalHours={totalHours} {...tableHandlers}
          />
        )}
      </div>

      {/* 結果カード */}
      <ResultCard grossAmount={grossAmount} payType={payType} currentDate={currentDate} />

      {/* 注記 */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary/40" />
        <p>
          本計算は国税庁「給与所得の源泉徴収税額表（月額表）」電算機計算の特例に基づく甲欄・扶養親族0人の簡易計算です。
          時給制の総支給額は休憩時間を差し引いた正味労働時間と基本時給から算出しています。
          社会保険料・住民税・各種控除は含まれておらず、実際の控除額と異なる場合があります。
        </p>
      </div>
    </div>
  );
}
