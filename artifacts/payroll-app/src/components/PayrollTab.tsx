import { useState, useRef, useEffect, Fragment, useMemo } from "react";
import { calculateIncomeTax, calcEffectiveRate } from "@/lib/taxCalculator";
import {
  getTimecardEntries,
  TimecardEntry,
  TimecardOcrStatus,
  WorkplaceDef,
  RoundingType,
  DayOfWeek,
  HolidayType,
  NEW_WORKPLACE_COLORS,
  DEFAULT_TENANT_ID,
  PREFECTURE_OPTIONS,
} from "@/lib/dummy-data";
import { useKeyedPersistedState } from "@/lib/usePersistedState";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Calculator, Clock, Info, TrendingUp, Upload, Loader2,
  CheckCircle2, AlertCircle, Plus, ScanLine, ChevronDown,
  CalendarDays, Moon, Sunrise, MapPin, PencilLine, Pencil,
  Briefcase, Zap, CalendarOff,
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

function toMin(t: string): number {
  if (!t || t === "--:--") return -1;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function calcHours(start: string, end: string): number {
  const s = toMin(start);
  let e = toMin(end);
  if (s < 0 || e < 0) return 0;
  if (e <= s) e += 1440; // 日跨ぎ補正
  return (e - s) / 60;
}

function monthLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

const DOW_LIST: DayOfWeek[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW_JP: Record<DayOfWeek, string> = {
  Sunday: "日", Monday: "月", Tuesday: "火", Wednesday: "水",
  Thursday: "木", Friday: "金", Saturday: "土",
};

const ADD_WORKPLACE_VALUE = "__add_new_workplace__";
const DEFAULT_WP_KEY = "w1";

const ROUNDING_LABELS: Record<RoundingType, string> = {
  "1min": "1分単位",
  "15min": "15分単位",
  "snap": "所定時間にスナップ",
};

const HOLIDAY_LABELS: Record<HolidayType, string> = {
  weekday: "平日",
  legal_holiday: "法定休日",
  scheduled_holiday: "所定休日",
};

const HOLIDAY_BADGE_STYLE: Record<HolidayType, string> = {
  weekday: "text-slate-600 bg-slate-100 border-slate-200",
  legal_holiday: "text-rose-700 bg-rose-50 border-rose-200",
  scheduled_holiday: "text-orange-700 bg-orange-50 border-orange-200",
};

// rowDate "M/D" + year → Date
function getRowDate(year: number, dateStr: string): Date {
  const m = dateStr.match(/^(\d+)\/(\d+)/);
  if (!m) return new Date(year, 0, 1);
  return new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

function detectHoliday(date: Date, wp: WorkplaceDef): HolidayType {
  const dow = DOW_LIST[date.getDay()];
  if (dow === wp.legalHoliday) return "legal_holiday";
  if (wp.scheduledHoliday.includes(dow)) return "scheduled_holiday";
  return "weekday";
}

// 22:00–翌05:00 と [start, end] の重なり(分)
function calcLateNightMin(start: string, end: string): number {
  const s = toMin(start);
  let e = toMin(end);
  if (s < 0 || e < 0) return 0;
  if (e <= s) e += 1440;
  // 22:00–29:00 (1320–1740) を想定。前日帯も拾うため 22:00 までの 0:00–05:00 区間を別途加算。
  const overnight = Math.max(0, Math.min(e, 1740) - Math.max(s, 1320));
  const earlyMorning = Math.max(0, Math.min(e, 300) - Math.max(s, 0));
  return overnight + earlyMorning;
}

// ─────────────────────────────────────────────
// 5区分労働時間バケット
// ─────────────────────────────────────────────

interface TimeBuckets {
  basic: number;            // 平日所定内
  overtime: number;         // 1日8h超
  earlyOvertime: number;    // 朝残業
  lateNight: number;        // 22:00–05:00
  legalHolidayWork: number; // 法定休日労働
  scheduledHolidayWork: number; // 所定休日労働
}

const EMPTY_BUCKETS: TimeBuckets = {
  basic: 0, overtime: 0, earlyOvertime: 0, lateNight: 0,
  legalHolidayWork: 0, scheduledHolidayWork: 0,
};

function addBuckets(a: TimeBuckets, b: TimeBuckets): TimeBuckets {
  return {
    basic: a.basic + b.basic,
    overtime: a.overtime + b.overtime,
    earlyOvertime: a.earlyOvertime + b.earlyOvertime,
    lateNight: a.lateNight + b.lateNight,
    legalHolidayWork: a.legalHolidayWork + b.legalHolidayWork,
    scheduledHolidayWork: a.scheduledHolidayWork + b.scheduledHolidayWork,
  };
}

function calcRowBuckets(
  effectiveStart: string, effectiveEnd: string,
  ocrStart: string, stdStart: string,
  breakMinutes: number, earlyOvertime: boolean, holiday: HolidayType,
): TimeBuckets {
  const grossMin = (calcHours(effectiveStart, effectiveEnd) * 60) | 0;
  if (grossMin <= 0) return EMPTY_BUCKETS;
  const workMin = Math.max(0, grossMin - breakMinutes);
  const earlyMin = earlyOvertime
    ? Math.max(0, toMin(stdStart) - toMin(ocrStart))
    : 0;
  const lateNightMin = calcLateNightMin(effectiveStart, effectiveEnd);

  const buckets: TimeBuckets = { ...EMPTY_BUCKETS };

  if (holiday === "legal_holiday") {
    buckets.legalHolidayWork = workMin / 60;
  } else if (holiday === "scheduled_holiday") {
    buckets.scheduledHolidayWork = workMin / 60;
  } else {
    buckets.earlyOvertime = earlyMin / 60;
    const remaining = Math.max(0, workMin - earlyMin);
    buckets.basic = Math.min(8 * 60, remaining) / 60;
    buckets.overtime = Math.max(0, remaining - 8 * 60) / 60;
  }
  buckets.lateNight = lateNightMin / 60;
  return buckets;
}

// ─────────────────────────────────────────────
// タイムカード行型(UI ステート込み)
// ─────────────────────────────────────────────

type TimecardRow = TimecardEntry & {
  editStart: string;
  editEnd: string;
  workplaceId: string;
  breakMinutes: number;
  earlyOvertime: boolean;
  lateNightPremium: boolean;
  note: string;
  expanded: boolean;
  timeManuallyEdited: boolean;
  holidayOverride: HolidayType | "auto";
};

function entryToRow(entry: TimecardEntry, defaultBreak: number): TimecardRow {
  return {
    ...entry,
    editStart: "", editEnd: "",
    workplaceId: DEFAULT_WP_KEY,
    breakMinutes: defaultBreak,
    earlyOvertime: false,
    lateNightPremium: false,
    note: "",
    expanded: false,
    timeManuallyEdited: false,
    holidayOverride: "auto",
  };
}

let manualRowCounter = 0;

// ─────────────────────────────────────────────
// 給与体系ピルトグル / 月給入力 / OCRバナー (簡略)
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

function MonthlyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hasValue = value.replace(/[^0-9]/g, "").length > 0;
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-foreground">月給(円)</label>
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
// 5区分サマリーカード
// ─────────────────────────────────────────────

function BucketSummary({ buckets }: { buckets: TimeBuckets }) {
  const items = [
    { label: "基本労働", value: buckets.basic, icon: Briefcase, style: "text-slate-700 bg-slate-50 border-slate-200" },
    { label: "時間外", value: buckets.overtime, icon: Zap, style: "text-orange-700 bg-orange-50 border-orange-200" },
    { label: "朝残業", value: buckets.earlyOvertime, icon: Sunrise, style: "text-amber-700 bg-amber-50 border-amber-200" },
    { label: "深夜労働", value: buckets.lateNight, icon: Moon, style: "text-indigo-700 bg-indigo-50 border-indigo-200" },
  ];
  const holidayTotal = buckets.legalHolidayWork + buckets.scheduledHolidayWork;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">5区分・月間労働時間の内訳</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {items.map(({ label, value, icon: Icon, style }) => (
          <div key={label} className={cn("rounded-xl border px-3 py-2.5 space-y-1", style)}>
            <div className="flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</span>
            </div>
            <p className="text-base font-bold tabular-nums">{value.toFixed(1)}<span className="text-[10px] font-medium opacity-70 ml-0.5">h</span></p>
          </div>
        ))}
        <div className="rounded-xl border px-3 py-2.5 space-y-1 text-rose-700 bg-rose-50 border-rose-200">
          <div className="flex items-center gap-1.5">
            <CalendarOff className="w-3.5 h-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">休日労働</span>
          </div>
          <p className="text-base font-bold tabular-nums">{holidayTotal.toFixed(1)}<span className="text-[10px] font-medium opacity-70 ml-0.5">h</span></p>
          <p className="text-[9px] opacity-70 leading-tight">
            法定 {buckets.legalHolidayWork.toFixed(1)}h ・ 所定 {buckets.scheduledHolidayWork.toFixed(1)}h
          </p>
        </div>
      </div>
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
  monthlyBuckets: TimeBuckets;
  workplaces: Record<string, WorkplaceDef>;
  onWorkplaceChange: (id: string, wpId: string) => void;
  onEditWorkplace: (wpId: string) => void;
  onBreakMinutesChange: (id: string, mins: number) => void;
  onEditTime: (id: string, field: "editStart" | "editEnd", value: string) => void;
  onToggleEarlyOvertime: (id: string, checked: boolean) => void;
  onToggleLateNight: (id: string, checked: boolean) => void;
  onNoteChange: (id: string, note: string) => void;
  onHolidayOverrideChange: (id: string, value: HolidayType | "auto") => void;
  onToggleExpanded: (id: string) => void;
  onAddManualRow: () => void;
}

function TimecardTable({
  rows, currentDate, totalHours, monthlyBuckets, workplaces,
  onWorkplaceChange, onEditWorkplace, onBreakMinutesChange, onEditTime,
  onToggleEarlyOvertime, onToggleLateNight, onNoteChange, onHolidayOverrideChange,
  onToggleExpanded, onAddManualRow,
}: TimecardTableProps) {
  const errorCount = rows.filter(
    (r) => (r.ocrStatus === "error" || r.ocrStatus === "manual") && !(r.editStart && r.editEnd)
  ).length;

  const COL_SPAN = 7;
  const fallbackWp: WorkplaceDef = workplaces[DEFAULT_WP_KEY] ?? Object.values(workplaces)[0] ?? {
    id: "fallback", name: "未設定", color: "text-muted-foreground bg-muted border-border",
    defaultStartTime: "09:00", defaultEndTime: "18:00", defaultRestMinutes: 0,
    roundingRule: "1min", legalHoliday: "Sunday", scheduledHoliday: [],
  };

  return (
    <div className="space-y-2">
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

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center space-y-1.5">
          <CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-semibold text-muted-foreground/60">{monthLabel(currentDate)} のデータがありません</p>
          <p className="text-xs text-muted-foreground/40">OCRで読み込むか、手動で行を追加してください</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-2 py-2.5 w-7"></th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[110px]">日付・属性</th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[150px]">職場</th>
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

                const effectiveStart = needsInput
                  ? (row.editStart || "--:--")
                  : row.earlyOvertime ? row.ocrStart : row.stdStart;
                const effectiveEnd = needsInput ? (row.editEnd || "--:--") : row.stdEnd;

                const wp = workplaces[row.workplaceId] ?? fallbackWp;
                const breakManuallyEdited = row.isRestManuallyEdited;

                // 休日属性: override > auto detect
                const rowDate = getRowDate(row.year, row.date);
                const autoHoliday = detectHoliday(rowDate, wp);
                const holiday = row.holidayOverride === "auto" ? autoHoliday : row.holidayOverride;
                const holidayManual = row.holidayOverride !== "auto" && row.holidayOverride !== autoHoliday;

                const gross = calcHours(effectiveStart, effectiveEnd);
                const net = gross > 0 ? Math.max(0, gross - row.breakMinutes / 60) : 0;

                const rowBg = row.expanded ? "bg-primary/[.03]"
                  : isError && !hasEditedBoth ? "bg-red-50/60"
                  : isManual && !hasEditedBoth ? "bg-blue-50/40"
                  : holiday === "legal_holiday" ? "bg-rose-50/30 hover:bg-rose-50/50"
                  : holiday === "scheduled_holiday" ? "bg-orange-50/30 hover:bg-orange-50/50"
                  : "bg-background hover:bg-muted/20";

                return (
                  <Fragment key={row.id}>
                    <tr className={cn("transition-colors", rowBg)}>
                      <td className="px-2 py-2.5 text-center">
                        {resolved
                          ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                          : isError
                          ? <AlertCircle className="w-4 h-4 text-red-500 mx-auto" />
                          : <div className="w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground/40 mx-auto" />
                        }
                      </td>

                      {/* 日付 + 休日属性バッジ */}
                      <td className="px-2 py-2.5 align-top">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-foreground whitespace-nowrap">
                            {row.date}
                            <span className="ml-1 text-[10px] text-muted-foreground">({DOW_JP[DOW_LIST[rowDate.getDay()]]})</span>
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 self-start text-[9px] font-semibold border rounded px-1 py-0.5 leading-none",
                              HOLIDAY_BADGE_STYLE[holiday],
                            )}
                            title={holidayManual ? "手動で上書き済み" : "曜日から自動判定"}
                          >
                            {HOLIDAY_LABELS[holiday]}
                            {holidayManual && <PencilLine className="w-2 h-2" />}
                          </span>
                        </div>
                      </td>

                      {/* 職場選択 + 編集 */}
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <Select
                            value={row.workplaceId}
                            onValueChange={(v) => onWorkplaceChange(row.id, v)}
                          >
                            <SelectTrigger className={cn(
                              "h-7 text-xs px-2 w-[110px] border font-semibold rounded-lg",
                              wp.color
                            )}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.values(workplaces).map((def) => (
                                <SelectItem key={def.id} value={def.id} className="text-xs">
                                  <span className="font-semibold">{def.name}</span>
                                  <span className="ml-2 text-muted-foreground">休憩{def.defaultRestMinutes}分</span>
                                </SelectItem>
                              ))}
                              <SelectSeparator />
                              <SelectItem
                                value={ADD_WORKPLACE_VALUE}
                                className="text-xs text-primary font-semibold focus:bg-primary/10"
                              >
                                <span className="inline-flex items-center gap-1">
                                  <Plus className="w-3 h-3" />新しい職場を登録
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <button
                            onClick={() => onEditWorkplace(row.workplaceId)}
                            aria-label={`${wp.name}を編集`}
                            title={`${wp.name}のマスタ設定を編集`}
                            className="w-6 h-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      {/* OCR打刻 */}
                      <td className={cn(
                        "px-2 py-2.5 transition-colors",
                        row.timeManuallyEdited && "bg-yellow-50/80"
                      )}>
                        {needsInput ? (
                          <div className="flex items-center gap-1">
                            <input type="time" value={row.editStart}
                              onChange={(e) => onEditTime(row.id, "editStart", e.target.value)}
                              className={cn(
                                "w-[86px] px-2 py-1.5 rounded-lg border text-xs font-medium",
                                "focus:outline-none focus:ring-2 transition-all",
                                !row.editStart && isError
                                  ? "border-red-400 bg-background focus:ring-red-200 focus:border-red-500"
                                  : row.editStart
                                  ? "border-yellow-400 bg-yellow-50 focus:ring-yellow-200 focus:border-yellow-500"
                                  : "border-border bg-background focus:ring-primary/20 focus:border-primary/50"
                              )}
                            />
                            <span className="text-muted-foreground text-xs">–</span>
                            <input type="time" value={row.editEnd}
                              onChange={(e) => onEditTime(row.id, "editEnd", e.target.value)}
                              className={cn(
                                "w-[86px] px-2 py-1.5 rounded-lg border text-xs font-medium",
                                "focus:outline-none focus:ring-2 transition-all",
                                !row.editEnd && isError
                                  ? "border-red-400 bg-background focus:ring-red-200 focus:border-red-500"
                                  : row.editEnd
                                  ? "border-yellow-400 bg-yellow-50 focus:ring-yellow-200 focus:border-yellow-500"
                                  : "border-border bg-background focus:ring-primary/20 focus:border-primary/50"
                              )}
                            />
                            {isError && !hasEditedBoth && (
                              <span className="text-[10px] text-red-600 font-semibold bg-red-50 border border-red-200 rounded px-1 py-0.5 whitespace-nowrap">要修正</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {row.ocrStart} – {row.ocrEnd}
                            </span>
                            {row.timeManuallyEdited && (
                              <span
                                title="手修正されたデータ"
                                className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-yellow-700 bg-yellow-100 border border-yellow-300 rounded px-1 py-0.5"
                              >
                                <PencilLine className="w-2.5 h-2.5" />手修正
                              </span>
                            )}
                          </div>
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

                      {/* 休憩 */}
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number" min={0} max={240} step={15}
                            value={row.breakMinutes}
                            onChange={(e) => onBreakMinutesChange(row.id, parseInt(e.target.value, 10) || 0)}
                            className={cn(
                              "w-[46px] px-1.5 py-1.5 rounded-lg border text-xs font-medium text-center",
                              "focus:outline-none focus:ring-2 transition-all",
                              breakManuallyEdited
                                ? "border-yellow-400 bg-yellow-50 text-yellow-900 focus:ring-yellow-200 focus:border-yellow-500"
                                : "border-border bg-background focus:ring-primary/20 focus:border-primary/50"
                            )}
                            title={breakManuallyEdited ? `${wp.name}の既定値(${wp.defaultRestMinutes}分)から手修正` : undefined}
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

                    {/* 詳細パネル */}
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
                            <div className="px-4 py-3 border-t border-border/40 bg-muted/30 space-y-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

                                {/* 朝残業 */}
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                                    <Sunrise className="w-4 h-4 text-amber-600" />
                                  </div>
                                  <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                                    <div>
                                      <p className="text-xs font-semibold text-foreground">朝残業(早出)</p>
                                      <p className="text-[10px] text-muted-foreground">始業前を朝残業に算入</p>
                                    </div>
                                    <Switch
                                      checked={row.earlyOvertime}
                                      onCheckedChange={(c) => onToggleEarlyOvertime(row.id, c)}
                                      className="data-[state=checked]:bg-amber-500 flex-shrink-0"
                                    />
                                  </div>
                                </div>

                                {/* 深夜割増 */}
                                <div className="flex items-start gap-3">
                                  <div className="mt-0.5 w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center flex-shrink-0">
                                    <Moon className="w-4 h-4 text-indigo-600" />
                                  </div>
                                  <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                                    <div>
                                      <p className="text-xs font-semibold text-foreground">深夜割増(22時以降)</p>
                                      <p className="text-[10px] text-muted-foreground">25%割増を適用</p>
                                    </div>
                                    <Switch
                                      checked={row.lateNightPremium}
                                      onCheckedChange={(c) => onToggleLateNight(row.id, c)}
                                      className="data-[state=checked]:bg-indigo-500 flex-shrink-0"
                                    />
                                  </div>
                                </div>

                                {/* 休日属性 上書き */}
                                <div className="space-y-1.5">
                                  <p className="text-xs font-semibold text-foreground">休日属性(強制上書き)</p>
                                  <Select
                                    value={row.holidayOverride}
                                    onValueChange={(v) => onHolidayOverrideChange(row.id, v as HolidayType | "auto")}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="auto" className="text-xs">自動判定 ({HOLIDAY_LABELS[autoHoliday]})</SelectItem>
                                      <SelectItem value="weekday" className="text-xs">平日</SelectItem>
                                      <SelectItem value="legal_holiday" className="text-xs">法定休日</SelectItem>
                                      <SelectItem value="scheduled_holiday" className="text-xs">所定休日</SelectItem>
                                    </SelectContent>
                                  </Select>
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

                              {/* 行ごとの5区分内訳 */}
                              {(() => {
                                const b = calcRowBuckets(
                                  effectiveStart, effectiveEnd, row.ocrStart, row.stdStart,
                                  row.breakMinutes, row.earlyOvertime, holiday,
                                );
                                const items: { label: string; value: number }[] = [
                                  { label: "基本", value: b.basic },
                                  { label: "時間外", value: b.overtime },
                                  { label: "朝残業", value: b.earlyOvertime },
                                  { label: "深夜", value: b.lateNight },
                                  { label: "法定休日", value: b.legalHolidayWork },
                                  { label: "所定休日", value: b.scheduledHolidayWork },
                                ];
                                return (
                                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/40">
                                    <span className="text-[10px] font-semibold text-muted-foreground self-center mr-1">本日内訳:</span>
                                    {items.map((it) => (
                                      <span
                                        key={it.label}
                                        className={cn(
                                          "text-[10px] font-medium border rounded px-1.5 py-0.5 tabular-nums",
                                          it.value > 0
                                            ? "text-foreground bg-background border-border"
                                            : "text-muted-foreground/50 bg-muted/30 border-border/40"
                                        )}
                                      >
                                        {it.label} {it.value.toFixed(1)}h
                                      </span>
                                    ))}
                                  </div>
                                );
                              })()}

                              {/* 手修正・適用中インジケーター */}
                              {(row.earlyOvertime || row.lateNightPremium || breakManuallyEdited || row.timeManuallyEdited || holidayManual) && (
                                <div className="flex flex-wrap gap-2">
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
                                  {breakManuallyEdited && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-yellow-700 bg-yellow-50 border border-yellow-300 rounded-full px-2 py-0.5">
                                      <PencilLine className="w-3 h-3" />休憩時間 手修正(既定 {wp.defaultRestMinutes}分)
                                    </span>
                                  )}
                                  {row.timeManuallyEdited && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-yellow-700 bg-yellow-50 border border-yellow-300 rounded-full px-2 py-0.5">
                                      <PencilLine className="w-3 h-3" />打刻 手修正
                                    </span>
                                  )}
                                  {holidayManual && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-yellow-700 bg-yellow-50 border border-yellow-300 rounded-full px-2 py-0.5">
                                      <PencilLine className="w-3 h-3" />休日属性 手動上書き
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

      <button onClick={onAddManualRow}
        className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-lg border border-dashed border-border transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />打刻行を手動で追加
      </button>

      {/* 5区分サマリー */}
      <div className="pt-2">
        <BucketSummary buckets={monthlyBuckets} />
      </div>

      <div className="flex items-center justify-between px-3 py-2.5 bg-muted/40 rounded-xl border border-border/60">
        <span className="text-xs font-semibold text-muted-foreground">
          {monthLabel(currentDate)} 正味労働時間(休憩差引後)
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
  onFileSelect: (f: File) => void; totalHours: number; monthlyBuckets: TimeBuckets;
} & Omit<TimecardTableProps, "rows" | "currentDate" | "totalHours" | "monthlyBuckets">) {
  const { hourlyRate, onHourlyRateChange, rows, currentDate, ocrState, onFileSelect, totalHours, monthlyBuckets, ...tableProps } = props;
  const hasRate = hourlyRate.replace(/[^0-9]/g, "").length > 0;
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-foreground">基本時給(円)</label>
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
      <TimecardTable rows={rows} currentDate={currentDate} totalHours={totalHours} monthlyBuckets={monthlyBuckets} {...tableProps} />
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
          {payType === "monthly" ? "月給制" : "時給制(時給 × 正味労働時間)"}
        </p>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
            {hasValue ? formatJPY(grossAmount) : "¥ —"}
          </span>
          <span className="text-xs text-muted-foreground">(総支給額)</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">源泉徴収税額(月額)</p>
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
          <span>差引支給額(税引後・参考値)</span>
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
// 職場マスタ Dialog (新規 / 編集 兼用)
// ─────────────────────────────────────────────

interface WorkplaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial: WorkplaceDef | null;     // edit時の元データ / create時null
  onSubmit: (def: Omit<WorkplaceDef, "color"> & { color?: string }) => void;
}

function WorkplaceDialog({ open, onOpenChange, mode, initial, onSubmit }: WorkplaceDialogProps) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [rest, setRest] = useState<number>(60);
  const [rounding, setRounding] = useState<RoundingType>("1min");
  const [legal, setLegal] = useState<DayOfWeek>("Sunday");
  const [scheduled, setScheduled] = useState<DayOfWeek[]>(["Saturday"]);
  const [prefecture, setPrefecture] = useState<string>(PREFECTURE_OPTIONS[0]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setName(initial.name);
      setStart(initial.defaultStartTime);
      setEnd(initial.defaultEndTime);
      setRest(initial.defaultRestMinutes);
      setRounding(initial.roundingRule);
      setLegal(initial.legalHoliday);
      setScheduled(initial.scheduledHoliday);
      setPrefecture(initial.prefecture ?? PREFECTURE_OPTIONS[0]);
    } else {
      setName("");
      setStart("09:00");
      setEnd("18:00");
      setRest(60);
      setRounding("1min");
      setLegal("Sunday");
      setScheduled(["Saturday"]);
      setPrefecture(PREFECTURE_OPTIONS[0]);
    }
  }, [open, mode, initial]);

  const canSubmit = name.trim().length > 0 && !!start && !!end;

  const toggleScheduled = (d: DayOfWeek) => {
    setScheduled((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      tenantId: initial?.tenantId ?? DEFAULT_TENANT_ID,
      id: initial?.id ?? "",
      name: name.trim(),
      prefecture,
      defaultStartTime: start,
      defaultEndTime: end,
      defaultRestMinutes: rest,
      roundingRule: rounding,
      legalHoliday: legal,
      scheduledHoliday: scheduled,
      color: initial?.color,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            {mode === "create" ? "新しい職場を登録" : `「${initial?.name ?? ""}」を編集`}
          </DialogTitle>
          <DialogDescription>
            職場ごとの所定労働時間・休憩・休日設定を登録します。変更は即座に全行へ反映されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="wp-name">
              職場名 <span className="text-destructive">*</span>
            </label>
            <input
              id="wp-name" type="text" value={name} autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="例：渋谷店、本社オフィス"
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">都道府県</label>
            <Select value={prefecture} onValueChange={setPrefecture}>
              <SelectTrigger className="w-full" aria-label="都道府県"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PREFECTURE_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">社会保険料率の計算に使用されます</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">所定労働時間</label>
            <div className="flex items-center gap-2">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="始業時刻"
                className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
              <span className="text-muted-foreground text-sm">–</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="終業時刻"
                className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="wp-rest">デフォルト休憩時間(分)</label>
            <div className="flex items-center gap-2">
              <input id="wp-rest" type="number" min={0} max={240} step={15} value={rest}
                onChange={(e) => setRest(parseInt(e.target.value, 10) || 0)}
                className="w-28 px-3 py-2.5 rounded-xl border border-border bg-background text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50" />
              <span className="text-sm text-muted-foreground">分</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">打刻の丸め設定</label>
            <Select value={rounding} onValueChange={(v) => setRounding(v as RoundingType)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(ROUNDING_LABELS) as RoundingType[]).map((k) => (
                  <SelectItem key={k} value={k}>{ROUNDING_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">法定休日(週1日)</label>
            <Select value={legal} onValueChange={(v) => setLegal(v as DayOfWeek)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOW_LIST.map((d) => (
                  <SelectItem key={d} value={d}>{DOW_JP[d]}曜日</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">所定休日(複数選択可)</label>
            <div className="flex flex-wrap gap-1.5">
              {DOW_LIST.map((d) => {
                const active = scheduled.includes(d);
                const isLegal = d === legal;
                return (
                  <button
                    key={d} type="button" disabled={isLegal}
                    onClick={() => toggleScheduled(d)}
                    className={cn(
                      "w-9 h-9 rounded-lg border text-xs font-semibold transition-colors",
                      isLegal
                        ? "bg-rose-50 border-rose-200 text-rose-400 cursor-not-allowed"
                        : active
                        ? "bg-orange-100 border-orange-300 text-orange-700"
                        : "bg-background border-border text-muted-foreground hover:bg-muted"
                    )}
                    title={isLegal ? "法定休日は所定休日に重複指定できません" : undefined}
                  >
                    {DOW_JP[d]}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <DialogClose asChild>
            <button className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-secondary transition-colors">
              キャンセル
            </button>
          </DialogClose>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mode === "create" ? "決定(登録)" : "更新を保存"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

interface PayrollTabProps {
  currentDate: Date;
  employeeId: string;
  workplaces: Record<string, WorkplaceDef>;
  onAddWorkplace: (key: string, def: WorkplaceDef) => void;
  onUpdateWorkplace: (id: string, def: WorkplaceDef) => void;
}

export function PayrollTab({ currentDate, employeeId, workplaces, onAddWorkplace, onUpdateWorkplace }: PayrollTabProps) {
  const [payType, setPayType] = useState<PayType>("monthly");
  const [monthlySalaryInput, setMonthlySalaryInput] = useState("");
  const [hourlyRateInput, setHourlyRateInput] = useState("");
  const [ocrState, setOcrState] = useState<OcrState>("idle");

  // タイムカード State（localStorage 同期 — モックアップデモ用）
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const storageKey = `timecard_${DEFAULT_TENANT_ID}_${employeeId}_${year}_${month}`;
  const [timecardRows, setTimecardRows] = useKeyedPersistedState<TimecardRow[]>(
    storageKey,
    () => {
      const entries = getTimecardEntries(employeeId, year, month);
      const defaultBreak = workplaces[DEFAULT_WP_KEY]?.defaultRestMinutes ?? 60;
      return entries.map((e) => entryToRow(e, defaultBreak));
    },
  );

  // Dialog state
  const [wpDialogOpen, setWpDialogOpen] = useState(false);
  const [wpDialogMode, setWpDialogMode] = useState<"create" | "edit">("create");
  const [wpDialogRowId, setWpDialogRowId] = useState<string | null>(null);
  const [wpDialogEditId, setWpDialogEditId] = useState<string | null>(null);

  // 月 / 従業員変更時に OCR バナー状態をリセット
  useEffect(() => {
    setOcrState("idle");
  }, [storageKey]);

  const handleFileSelect = (_file: File) => {
    setOcrState("loading");
    setTimeout(() => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const entries = getTimecardEntries(employeeId, year, month);
      const defaultBreak = workplaces[DEFAULT_WP_KEY]?.defaultRestMinutes ?? 60;
      setTimecardRows(entries.map((e) => entryToRow(e, defaultBreak)));
      setOcrState("done");
    }, 2500);
  };

  const handleWorkplaceChange = (id: string, value: string) => {
    if (value === ADD_WORKPLACE_VALUE) {
      setWpDialogMode("create");
      setWpDialogRowId(id);
      setWpDialogEditId(null);
      setWpDialogOpen(true);
      return;
    }
    const def = workplaces[value];
    if (!def) return;
    setTimecardRows((prev) => prev.map((r) =>
      r.id === id
        ? { ...r, workplaceId: value, breakMinutes: def.defaultRestMinutes, isRestManuallyEdited: false }
        : r
    ));
  };

  const handleEditWorkplace = (wpId: string) => {
    if (!workplaces[wpId]) return;
    setWpDialogMode("edit");
    setWpDialogEditId(wpId);
    setWpDialogRowId(null);
    setWpDialogOpen(true);
  };

  const handleDialogSubmit = (def: Omit<WorkplaceDef, "color"> & { color?: string }) => {
    if (wpDialogMode === "edit" && wpDialogEditId) {
      const existing = workplaces[wpDialogEditId];
      const updated: WorkplaceDef = {
        ...def,
        id: wpDialogEditId,
        color: def.color ?? existing.color,
      };
      onUpdateWorkplace(wpDialogEditId, updated);
    } else {
      const newKey = `wp_${Date.now()}`;
      const colorIdx = Math.max(0, Object.keys(workplaces).length - 2) % NEW_WORKPLACE_COLORS.length;
      const newDef: WorkplaceDef = {
        ...def,
        id: newKey,
        color: NEW_WORKPLACE_COLORS[colorIdx],
      };
      onAddWorkplace(newKey, newDef);
      if (wpDialogRowId) {
        setTimecardRows((prev) => prev.map((r) =>
          r.id === wpDialogRowId
            ? { ...r, workplaceId: newKey, breakMinutes: newDef.defaultRestMinutes, isRestManuallyEdited: false }
            : r
        ));
      }
    }
    setWpDialogOpen(false);
    setWpDialogRowId(null);
    setWpDialogEditId(null);
  };

  const handleBreakMinutesChange = (id: string, mins: number) => {
    setTimecardRows((prev) => prev.map((r) =>
      r.id === id ? { ...r, breakMinutes: mins, isRestManuallyEdited: true } : r
    ));
  };

  const handleEditTime = (id: string, field: "editStart" | "editEnd", value: string) => {
    setTimecardRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      const newStart = field === "editStart" ? value : r.editStart;
      const newEnd   = field === "editEnd"   ? value : r.editEnd;
      if (newStart && newEnd) {
        return {
          ...updated,
          ocrStatus: "success" as TimecardOcrStatus,
          ocrStart: newStart, ocrEnd: newEnd,
          stdStart: newStart, stdEnd: newEnd,
          timeManuallyEdited: true,
        };
      }
      return updated;
    }));
  };

  const handleToggleEarlyOvertime = (id: string, checked: boolean) =>
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, earlyOvertime: checked } : r));
  const handleToggleLateNight = (id: string, checked: boolean) =>
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, lateNightPremium: checked } : r));
  const handleNoteChange = (id: string, note: string) =>
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, note } : r));
  const handleHolidayOverrideChange = (id: string, value: HolidayType | "auto") =>
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, holidayOverride: value } : r));
  const handleToggleExpanded = (id: string) =>
    setTimecardRows((prev) => prev.map((r) => r.id === id ? { ...r, expanded: !r.expanded } : r));

  const handleAddManualRow = () => {
    const d = currentDate;
    manualRowCounter += 1;
    const defaultBreak = workplaces[DEFAULT_WP_KEY]?.defaultRestMinutes ?? 60;
    setTimecardRows((prev) => [
      ...prev,
      {
        tenantId: DEFAULT_TENANT_ID,
        id: `m${manualRowCounter}`,
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        year: d.getFullYear(), month: d.getMonth() + 1,
        ocrStatus: "manual",
        ocrStart: "", ocrEnd: "", editStart: "", editEnd: "",
        stdStart: "--:--", stdEnd: "--:--",
        workplaceId: DEFAULT_WP_KEY, breakMinutes: defaultBreak,
        earlyOvertime: false, lateNightPremium: false, note: "", expanded: false,
        timeManuallyEdited: false, holidayOverride: "auto",
        isRestManuallyEdited: false,
      },
    ]);
  };

  // 月間 5区分集計 (workplaces / timecardRows 変更で再計算)
  const monthlyBuckets = useMemo<TimeBuckets>(() => {
    return timecardRows.reduce<TimeBuckets>((acc, row) => {
      const wp = workplaces[row.workplaceId];
      if (!wp) return acc;
      const needsInput = row.ocrStatus === "error" || row.ocrStatus === "manual";
      const effectiveStart = needsInput
        ? (row.editStart || "--:--")
        : row.earlyOvertime ? row.ocrStart : row.stdStart;
      const effectiveEnd = needsInput ? (row.editEnd || "--:--") : row.stdEnd;
      const rowDate = getRowDate(row.year, row.date);
      const autoHoliday = detectHoliday(rowDate, wp);
      const holiday = row.holidayOverride === "auto" ? autoHoliday : row.holidayOverride;
      const buckets = calcRowBuckets(
        effectiveStart, effectiveEnd, row.ocrStart, row.stdStart,
        row.breakMinutes, row.earlyOvertime, holiday,
      );
      return addBuckets(acc, buckets);
    }, EMPTY_BUCKETS);
  }, [timecardRows, workplaces]);

  // 正味労働時間（時給制総支給用）
  const totalHours = useMemo(() =>
    monthlyBuckets.basic + monthlyBuckets.overtime + monthlyBuckets.earlyOvertime
    + monthlyBuckets.legalHolidayWork + monthlyBuckets.scheduledHolidayWork,
    [monthlyBuckets],
  );

  const monthlyRaw = parseInt(monthlySalaryInput.replace(/[^0-9]/g, ""), 10) || 0;
  const hourlyRaw  = parseInt(hourlyRateInput.replace(/[^0-9]/g, ""), 10) || 0;
  const grossAmount = payType === "monthly" ? monthlyRaw : Math.round(hourlyRaw * totalHours);

  const tableHandlers: Omit<TimecardTableProps, "rows" | "currentDate" | "totalHours" | "monthlyBuckets"> = {
    workplaces,
    onWorkplaceChange: handleWorkplaceChange,
    onEditWorkplace: handleEditWorkplace,
    onBreakMinutesChange: handleBreakMinutesChange,
    onEditTime: handleEditTime,
    onToggleEarlyOvertime: handleToggleEarlyOvertime,
    onToggleLateNight: handleToggleLateNight,
    onNoteChange: handleNoteChange,
    onHolidayOverrideChange: handleHolidayOverrideChange,
    onToggleExpanded: handleToggleExpanded,
    onAddManualRow: handleAddManualRow,
  };

  const dialogInitial = wpDialogMode === "edit" && wpDialogEditId ? workplaces[wpDialogEditId] ?? null : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Calculator className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">所得税シミュレーター</p>
            <p className="text-xs text-muted-foreground">甲欄・扶養親族0人(令和6年分)</p>
          </div>
        </div>
        <PayTypePills value={payType} onChange={setPayType} />
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-5">
        {payType === "monthly" ? (
          <MonthlyInput value={monthlySalaryInput} onChange={setMonthlySalaryInput} />
        ) : (
          <HourlySection
            hourlyRate={hourlyRateInput} onHourlyRateChange={setHourlyRateInput}
            rows={timecardRows} currentDate={currentDate}
            ocrState={ocrState} onFileSelect={handleFileSelect}
            totalHours={totalHours} monthlyBuckets={monthlyBuckets} {...tableHandlers}
          />
        )}
      </div>

      <ResultCard grossAmount={grossAmount} payType={payType} currentDate={currentDate} />

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-primary/40" />
        <p>
          本計算は国税庁「給与所得の源泉徴収税額表(月額表)」電算機計算の特例に基づく甲欄・扶養親族0人の簡易計算です。
          時給制の総支給額は休憩時間を差し引いた正味労働時間と基本時給から算出しています。
          5区分の判定はマスタの所定労働時間・法定/所定休日設定に基づくダミーロジックです。
        </p>
      </div>

      <WorkplaceDialog
        open={wpDialogOpen}
        onOpenChange={(open) => {
          setWpDialogOpen(open);
          if (!open) { setWpDialogRowId(null); setWpDialogEditId(null); }
        }}
        mode={wpDialogMode}
        initial={dialogInitial}
        onSubmit={handleDialogSubmit}
      />
    </div>
  );
}
