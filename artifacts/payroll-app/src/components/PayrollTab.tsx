import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { calculateIncomeTax } from "@/lib/taxCalculator";
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
  EmployeeMaster,
  PayrollResult,
  DEFAULT_HOURLY_RATES,
  AllowanceItem,
  ALLOWANCE_TYPE_PRESETS,
} from "@/lib/dummy-data";
import {
  isNursingCareInsuranceTarget,
} from "@/lib/insurance";
import { buildPayrollResultId, toYearMonth } from "@/lib/payrollCalc";
import { getInsuranceRateOrFallback } from "@/lib/constants/rates";
import { useKeyedPersistedState } from "@/lib/usePersistedState";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import {
  Calculator, Clock, Info, TrendingUp, Loader2,
  CheckCircle2, AlertCircle, Plus,
  CalendarDays, Moon, Sunrise, MapPin, PencilLine, Pencil,
  Briefcase, Zap, CalendarOff, Share2, Download, Trash2,
  Camera, FileSpreadsheet, Keyboard, ChevronRight,
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
  applyLateNight: boolean = true,
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
  buckets.lateNight = applyLateNight ? lateNightMin / 60 : 0;
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
  timeManuallyEdited: boolean;
  /** えんぴつアイコンで打刻の手動上書き編集を開いている状態（永続化対象） */
  manualEdit: boolean;
};

function entryToRow(entry: TimecardEntry, defaultBreak: number, workplaceId: string): TimecardRow {
  return {
    ...entry,
    editStart: "", editEnd: "",
    workplaceId,
    breakMinutes: defaultBreak,
    timeManuallyEdited: false,
    manualEdit: false,
  };
}

/** シードのダミー打刻を職場ごとに分配（前半→第1職場 / 後半→第2職場）してタブ表示を成立させる */
function seedRows(entries: TimecardEntry[], workplaces: Record<string, WorkplaceDef>): TimecardRow[] {
  const ids = Object.keys(workplaces);
  const primary = workplaces[DEFAULT_WP_KEY] ? DEFAULT_WP_KEY : ids[0];
  const secondary = ids.find((id) => id !== primary) ?? primary;
  const half = Math.ceil(entries.length / 2);
  return entries.map((e, i) => {
    const wpId = i < half ? primary : secondary;
    const wp = workplaces[wpId];
    return entryToRow(e, wp?.defaultRestMinutes ?? 60, wpId ?? DEFAULT_WP_KEY);
  });
}

let manualRowCounter = 0;

// ─────────────────────────────────────────────
// 給与体系ピルトグル / 月給入力 / OCRバナー (簡略)
// ─────────────────────────────────────────────

type PayType = "monthly" | "hourly";

function PayTypePills({ value, onChange, disabled }: { value: PayType; onChange: (v: PayType) => void; disabled?: boolean }) {
  return (
    <div className={cn("inline-flex items-center bg-muted rounded-full p-1 gap-1", disabled && "opacity-60")}>
      {(["monthly", "hourly"] as PayType[]).map((type) => (
        <button key={type} onClick={() => onChange(type)} disabled={disabled}
          className={cn(
            "px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-200",
            value === type ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            disabled && "cursor-not-allowed",
          )}
        >
          {type === "monthly" ? "月給制" : "時給制"}
        </button>
      ))}
    </div>
  );
}

function MonthlyInput({
  value, onChange, previousGross,
}: {
  value: string;
  onChange: (v: string) => void;
  previousGross: number;
}) {
  const hasValue = value.replace(/[^0-9]/g, "").length > 0;
  const canCopyPrev = previousGross > 0;
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-foreground">月給(円)</label>
      <p className="text-xs text-muted-foreground">社会保険料控除前の総支給額を入力してください</p>
      <div className="relative mt-1 flex items-stretch gap-2">
        <div className="relative flex-1">
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
        <button
          type="button"
          onClick={() => canCopyPrev && onChange(toDisplayValue(String(previousGross)))}
          disabled={!canCopyPrev}
          data-testid="copy-prev-month"
          className={cn(
            "flex-shrink-0 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap",
            canCopyPrev
              ? "border-primary/30 text-primary bg-primary/5 hover:bg-primary/10"
              : "border-border text-muted-foreground/50 bg-muted/30 cursor-not-allowed",
          )}
          title={canCopyPrev ? `前月の総支給額 ${formatJPY(previousGross)} を入力` : "前月のデータがありません"}
        >
          前月と同様
        </button>
      </div>
    </div>
  );
}

type OcrState = "idle" | "loading" | "done";

// ─────────────────────────────────────────────
// 打刻データ追加: ボトムシート（3つの入力モード）
// ─────────────────────────────────────────────

interface DataInputDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickOcr: () => void;
  onPickManual: () => void;
  onPickCsv: () => void;
}

function DataInputDrawer({ open, onOpenChange, onPickOcr, onPickManual, onPickCsv }: DataInputDrawerProps) {
  const options = [
    {
      key: "ocr",
      icon: Camera,
      title: "画像から自動入力",
      desc: "タイムカードの写真をAI（OCR）で読み取り",
      style: "bg-primary/10 text-primary",
      onClick: onPickOcr,
      testid: "input-mode-ocr",
    },
    {
      key: "manual",
      icon: Keyboard,
      title: "手動で入力する",
      desc: "事業所・日付・時間を選んで1件ずつ入力",
      style: "bg-amber-100 text-amber-700",
      onClick: onPickManual,
      testid: "input-mode-manual",
    },
    {
      key: "csv",
      icon: FileSpreadsheet,
      title: "Excel / CSV からインポート",
      desc: "勤怠ファイルを一括で取り込み",
      style: "bg-emerald-100 text-emerald-700",
      onClick: onPickCsv,
      testid: "input-mode-csv",
    },
  ];
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="data-input-drawer">
        <div className="mx-auto w-full max-w-md">
          <DrawerHeader className="text-left">
            <DrawerTitle>打刻データを追加</DrawerTitle>
            <DrawerDescription>入力方法を選んでください</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-2.5">
            {options.map(({ key, icon: Icon, title, desc, style, onClick, testid }) => (
              <button
                key={key}
                type="button"
                data-testid={testid}
                onClick={onClick}
                className="w-full flex items-center gap-3.5 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50 active:bg-muted"
              >
                <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0", style)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ─────────────────────────────────────────────
// 手動入力モーダル（フルスクリーン別ビュー）
// ─────────────────────────────────────────────

interface ManualEntryDraft {
  rowId: string | null;
  workplaceId: string;
  day: number;
  start: string;
  end: string;
  breakMinutes: number;
}

interface ManualEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workplaces: Record<string, WorkplaceDef>;
  currentDate: Date;
  draft: ManualEntryDraft | null;
  lockDate: boolean;
  onSave: (draft: ManualEntryDraft) => void;
}

function ManualEntryModal({
  open, onOpenChange, workplaces, currentDate, draft, lockDate, onSave,
}: ManualEntryModalProps) {
  const [workplaceId, setWorkplaceId] = useState("");
  const [day, setDay] = useState(1);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(60);

  useEffect(() => {
    if (open && draft) {
      setWorkplaceId(draft.workplaceId);
      setDay(draft.day);
      setStart(draft.start);
      setEnd(draft.end);
      setBreakMinutes(draft.breakMinutes);
    }
  }, [open, draft]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayOptions = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const wpList = Object.values(workplaces);

  const valid = (t: string) => /^\d{2}:\d{2}$/.test(t);
  const canSave = !!workplaceId && valid(start) && valid(end);

  const handleSave = () => {
    if (!canSave) return;
    onSave({ rowId: draft?.rowId ?? null, workplaceId, day, start, end, breakMinutes });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="manual-entry-modal"
        className="max-w-md w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-2xl flex flex-col gap-0 p-0"
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border text-left">
          <DialogTitle>{draft?.rowId ? "打刻を修正" : "打刻データを手動入力"}</DialogTitle>
          <DialogDescription>事業所・対象日・時間を入力して保存してください</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 勤務先の事業所 */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-foreground">勤務先の事業所</label>
            <Select value={workplaceId} onValueChange={setWorkplaceId}>
              <SelectTrigger data-testid="manual-workplace" className="w-full">
                <SelectValue placeholder="事業所を選択" />
              </SelectTrigger>
              <SelectContent>
                {wpList.map((wp) => (
                  <SelectItem key={wp.id} value={wp.id}>{wp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 対象日 */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-foreground">対象日</label>
            <Select value={String(day)} onValueChange={(v) => setDay(parseInt(v, 10))} disabled={lockDate}>
              <SelectTrigger data-testid="manual-day" className="w-full">
                <SelectValue placeholder="日付を選択" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {dayOptions.map((d) => {
                  const dt = new Date(year, month - 1, d);
                  return (
                    <SelectItem key={d} value={String(d)}>
                      {month}/{d}（{DOW_JP[DOW_LIST[dt.getDay()]]}）
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {lockDate && <p className="text-[11px] text-muted-foreground">エラー行の修正のため対象日は固定されています</p>}
          </div>

          {/* 開始 / 終了 時間 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-foreground">開始時間</label>
              <input
                type="time" value={start} onChange={(e) => setStart(e.target.value)}
                data-testid="manual-start"
                className="w-full px-3 py-3 rounded-xl border border-border bg-background text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-foreground">終了時間</label>
              <input
                type="time" value={end} onChange={(e) => setEnd(e.target.value)}
                data-testid="manual-end"
                className="w-full px-3 py-3 rounded-xl border border-border bg-background text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
              />
            </div>
          </div>

          {/* 休憩 */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-foreground">休憩時間(分)</label>
            <input
              type="number" min={0} max={240} step={15} value={breakMinutes}
              onChange={(e) => setBreakMinutes(parseInt(e.target.value, 10) || 0)}
              data-testid="manual-break"
              className="w-32 px-3 py-3 rounded-xl border border-border bg-background text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
            />
          </div>
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border gap-2 sm:gap-2">
          <DialogClose asChild>
            <button type="button" className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors">
              キャンセル
            </button>
          </DialogClose>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            data-testid="manual-save"
            className={cn(
              "flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-sm font-bold transition-colors",
              canSave ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            保存
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  /** このテーブルが属する職場（タブ）。休日判定・朝残業算入などの計算に使用 */
  workplace: WorkplaceDef;
  onBreakMinutesChange: (id: string, mins: number) => void;
  onEditTime: (id: string, field: "editStart" | "editEnd", value: string) => void;
  onToggleManualEdit: (id: string) => void;
  /** 「打刻データを追加」ボトムシートを開く */
  onRequestAddData: () => void;
  /** エラー行タップで手動入力モーダルを開く */
  onOpenManual: (rowId: string) => void;
}

function TimecardTable({
  rows, currentDate, workplace,
  onBreakMinutesChange, onEditTime, onToggleManualEdit, onRequestAddData, onOpenManual,
}: TimecardTableProps) {
  const errorCount = rows.filter(
    (r) => (r.ocrStatus === "error" || r.ocrStatus === "manual") && !(r.editStart && r.editEnd)
  ).length;

  const wp = workplace;

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
        <button
          type="button"
          onClick={onRequestAddData}
          data-testid="add-data-button-header"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:bg-primary/10 rounded-lg px-2 py-1 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />打刻データを追加
        </button>
      </div>

      {/* 手修正が必要なエラー行のアラート */}
      {errorCount > 0 && (
        <div
          data-testid="ocr-error-alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-3.5 py-3"
        >
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-red-700">手修正が必要です</p>
            <p className="text-xs text-red-600/90 leading-snug">
              {errorCount}件の打刻を読み取れませんでした。赤色の行をタップして時間を入力してください。
            </p>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center space-y-1.5">
          <CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-semibold text-muted-foreground/60">{wp.name} の打刻データがありません</p>
          <p className="text-xs text-muted-foreground/40">OCRで読み込むか、手動で行を追加してください</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-2 py-2.5 w-7"></th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[110px]">日付</th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground">出勤 – 退勤</th>
                <th className="text-left px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[82px]">休憩(分)</th>
                <th className="text-right px-2 py-2.5 text-xs font-semibold text-muted-foreground w-[72px]">実働</th>
                <th className="px-2 py-2.5 w-[44px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isError = row.ocrStatus === "error";
                const isManual = row.ocrStatus === "manual";
                const needsInput = isError || isManual;

                const rowDate = getRowDate(row.year, row.date);
                const holiday = detectHoliday(rowDate, wp);

                // 未入力（OCRエラー等）行: 行全体をタップ → 手動入力モーダルを開く
                if (needsInput) {
                  return (
                    <tr
                      key={row.id}
                      onClick={() => onOpenManual(row.id)}
                      data-testid="timecard-error-row"
                      className="cursor-pointer border-2 border-red-400 bg-red-50/80 hover:bg-red-100/80 transition-colors"
                    >
                      <td className="px-2 py-3 text-center">
                        <AlertCircle className="w-4 h-4 text-red-500 mx-auto" />
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <span className="text-xs font-medium text-foreground whitespace-nowrap">
                          {row.date}
                          <span className="ml-1 text-[10px] text-muted-foreground">({DOW_JP[DOW_LIST[rowDate.getDay()]]})</span>
                        </span>
                      </td>
                      <td className="px-2 py-3" colSpan={3}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-red-600 tabular-nums">--:-- – --:--</span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-white border border-red-300 rounded-full px-2 py-0.5">
                            <PencilLine className="w-2.5 h-2.5" />タップして修正
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-3 text-right">
                        <ChevronRight className="w-4 h-4 text-red-400 ml-auto" />
                      </td>
                    </tr>
                  );
                }

                // 確定済み（success）行
                const editing = row.manualEdit;
                const effectiveStart = editing
                  ? (row.editStart || "--:--")
                  : wp.includeEarlyOvertime ? row.ocrStart : row.stdStart;
                const effectiveEnd = editing ? (row.editEnd || "--:--") : row.stdEnd;

                const breakManuallyEdited = row.isRestManuallyEdited;

                const gross = calcHours(effectiveStart, effectiveEnd);
                const net = gross > 0 ? Math.max(0, gross - row.breakMinutes / 60) : 0;

                const rowBg = holiday === "legal_holiday" ? "bg-rose-50/30 hover:bg-rose-50/50"
                  : holiday === "scheduled_holiday" ? "bg-orange-50/30 hover:bg-orange-50/50"
                  : "bg-background hover:bg-muted/20";

                return (
                  <tr key={row.id} className={cn("transition-colors border-b border-border/40 last:border-b-0", rowBg)}>
                    <td className="px-2 py-2.5 text-center">
                      <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                    </td>

                    {/* 日付 + 休日バッジ */}
                    <td className="px-2 py-2.5 align-top">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-foreground whitespace-nowrap">
                          {row.date}
                          <span className="ml-1 text-[10px] text-muted-foreground">({DOW_JP[DOW_LIST[rowDate.getDay()]]})</span>
                        </span>
                        {holiday !== "weekday" && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 self-start text-[9px] font-semibold border rounded px-1 py-0.5 leading-none",
                              HOLIDAY_BADGE_STYLE[holiday],
                            )}
                            title="職場マスタの休日設定から自動判定"
                          >
                            {HOLIDAY_LABELS[holiday]}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 出勤–退勤（OCR読み取り / 手動上書き） */}
                    <td className={cn(
                      "px-2 py-2.5 transition-colors",
                      row.timeManuallyEdited && "bg-yellow-50/80"
                    )}>
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <input type="time" value={row.editStart}
                            onChange={(e) => onEditTime(row.id, "editStart", e.target.value)}
                            aria-label="出勤時刻"
                            className={cn(
                              "w-[86px] px-2 py-1.5 rounded-lg border text-xs font-medium",
                              "focus:outline-none focus:ring-2 transition-all",
                              row.editStart
                                ? "border-yellow-400 bg-yellow-50 focus:ring-yellow-200 focus:border-yellow-500"
                                : "border-border bg-background focus:ring-primary/20 focus:border-primary/50"
                            )}
                          />
                          <span className="text-muted-foreground text-xs">–</span>
                          <input type="time" value={row.editEnd}
                            onChange={(e) => onEditTime(row.id, "editEnd", e.target.value)}
                            aria-label="退勤時刻"
                            className={cn(
                              "w-[86px] px-2 py-1.5 rounded-lg border text-xs font-medium",
                              "focus:outline-none focus:ring-2 transition-all",
                              row.editEnd
                                ? "border-yellow-400 bg-yellow-50 focus:ring-yellow-200 focus:border-yellow-500"
                                : "border-border bg-background focus:ring-primary/20 focus:border-primary/50"
                            )}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground tabular-nums">
                            {effectiveStart} – {effectiveEnd}
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

                    {/* 休憩 */}
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min={0} max={240} step={15}
                          value={row.breakMinutes}
                          onChange={(e) => onBreakMinutesChange(row.id, parseInt(e.target.value, 10) || 0)}
                          aria-label="休憩時間(分)"
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

                    {/* 実働時間 */}
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {net > 0
                        ? <span className="text-xs font-bold text-foreground">{net.toFixed(1)}h</span>
                        : <span className="text-xs text-muted-foreground/40">—</span>
                      }
                    </td>

                    {/* えんぴつ: 手動上書き */}
                    <td className="px-1 py-2.5 text-right">
                      <button
                        onClick={() => onToggleManualEdit(row.id)}
                        className={cn(
                          "inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors",
                          row.manualEdit
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                        aria-label={row.manualEdit ? "手動上書きを閉じる" : "打刻を手動で上書き"}
                        title={row.manualEdit ? "手動上書きを閉じる" : "打刻を手動で上書き"}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={onRequestAddData}
        data-testid="add-data-button-table"
        className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-lg border border-dashed border-border transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />打刻データを追加
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// 時給セクション
// ─────────────────────────────────────────────

/** 5区分バケットから正味労働時間（休憩差引後の実働合計）を算出 */
function bucketNetHours(b: TimeBuckets): number {
  return b.basic + b.overtime + b.earlyOvertime + b.legalHolidayWork + b.scheduledHolidayWork;
}

interface HourlySectionProps {
  workplaces: Record<string, WorkplaceDef>;
  rows: TimecardRow[];
  currentDate: Date;
  ocrState: OcrState;
  /** 職場ID → 当月の集計バケット */
  bucketsByWorkplace: Record<string, TimeBuckets>;
  /** 職場ID → 入力中の時給（カンマ区切り文字列） */
  rates: Record<string, string>;
  /** 前月確定時の職場別時給（"前月と同様"用） */
  prevRates: Record<string, string>;
  activeWpId: string;
  onActiveWpChange: (id: string) => void;
  onRateChange: (wpId: string, value: string) => void;
  onCopyPrevRate: (wpId: string) => void;
  onAddWorkplace: () => void;
  onEditWorkplace: (wpId: string) => void;
  onBreakMinutesChange: (id: string, mins: number) => void;
  onEditTime: (id: string, field: "editStart" | "editEnd", value: string) => void;
  onToggleManualEdit: (id: string) => void;
  /** 「打刻データを追加」ボトムシートを開く */
  onRequestAddData: () => void;
  /** エラー行タップ等で手動入力モーダルを開く（rowId=対象行） */
  onOpenManual: (rowId: string) => void;
}

function HourlySection({
  workplaces, rows, currentDate, ocrState,
  bucketsByWorkplace, rates, prevRates, activeWpId, onActiveWpChange,
  onRateChange, onCopyPrevRate, onAddWorkplace, onEditWorkplace,
  onBreakMinutesChange, onEditTime, onToggleManualEdit,
  onRequestAddData, onOpenManual,
}: HourlySectionProps) {
  const wpList = Object.values(workplaces);
  const activeWp = workplaces[activeWpId] ?? wpList[0];
  const activeRows = rows.filter((r) => r.workplaceId === activeWp?.id);
  const activeBuckets = bucketsByWorkplace[activeWp?.id ?? ""] ?? EMPTY_BUCKETS;
  const activeHours = bucketNetHours(activeBuckets);
  const rateStr = rates[activeWp?.id ?? ""] ?? "";
  const rateNum = parseInt(rateStr.replace(/[^0-9]/g, ""), 10) || 0;
  const hasRate = rateNum > 0;
  const subtotal = Math.round(rateNum * activeHours);
  const prevRateStr = prevRates[activeWp?.id ?? ""] ?? "";
  const canCopyPrev = prevRateStr.replace(/[^0-9]/g, "").length > 0;

  return (
    <div className="space-y-5">
      {/* 事業所タブ */}
      <div className="flex items-center gap-1.5 flex-wrap border-b border-border pb-px -mb-px">
        {wpList.map((wp) => {
          const active = wp.id === activeWp?.id;
          return (
            <button
              key={wp.id}
              type="button"
              onClick={() => onActiveWpChange(wp.id)}
              data-testid={`wp-tab-${wp.id}`}
              className={cn(
                "px-3.5 py-2 rounded-t-lg text-sm font-semibold border border-b-0 -mb-px transition-colors",
                active
                  ? "bg-card border-border text-foreground"
                  : "bg-muted/40 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/70",
              )}
            >
              {wp.name}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAddWorkplace}
          data-testid="wp-tab-add"
          className="px-3 py-2 rounded-t-lg text-sm font-semibold text-primary hover:bg-primary/10 transition-colors inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />事業所を追加
        </button>
      </div>

      {/* アクティブ職場の内容 */}
      {activeWp && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <span className={cn(
              "inline-flex items-center gap-1.5 text-xs font-bold border rounded-full px-2.5 py-1",
              activeWp.color,
            )}>
              <MapPin className="w-3 h-3" />{activeWp.name}
            </span>
            <button
              type="button"
              onClick={() => onEditWorkplace(activeWp.id)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              title={`${activeWp.name}のマスタ設定（所定労働時間・休憩・休日・割増ルール）を編集`}
            >
              <Pencil className="w-3 h-3" />職場マスタを編集
            </button>
          </div>

          {/* 時給入力 + 前月と同様 */}
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-foreground">{activeWp.name} の基本時給(円)</label>
            <p className="text-xs text-muted-foreground">社会保険料控除前の基本時給を入力してください</p>
            <div className="relative mt-1 flex items-stretch gap-2 max-w-[360px]">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold select-none">¥</span>
                <input
                  type="text" inputMode="numeric" value={rateStr} placeholder="1,200"
                  data-testid={`hourly-rate-${activeWp.id}`}
                  onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ""); onRateChange(activeWp.id, toDisplayValue(d)); }}
                  className={cn(
                    "w-full pl-8 pr-4 py-3.5 rounded-xl border bg-background text-foreground text-base font-medium",
                    "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all",
                    "placeholder:text-muted-foreground/40",
                    hasRate ? "border-primary/30" : "border-border"
                  )}
                />
              </div>
              <button
                type="button"
                onClick={() => canCopyPrev && onCopyPrevRate(activeWp.id)}
                disabled={!canCopyPrev}
                data-testid={`copy-prev-rate-${activeWp.id}`}
                className={cn(
                  "flex-shrink-0 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap",
                  canCopyPrev
                    ? "border-primary/30 text-primary bg-primary/5 hover:bg-primary/10"
                    : "border-border text-muted-foreground/50 bg-muted/30 cursor-not-allowed",
                )}
                title={canCopyPrev ? `前月の時給 ¥${prevRateStr} を入力` : "前月のデータがありません"}
              >
                前月と同様
              </button>
            </div>
          </div>

          {ocrState === "loading" ? (
            <div
              data-testid="ocr-loading"
              className="rounded-xl border border-primary/20 bg-primary/5 py-12 flex flex-col items-center justify-center gap-3"
            >
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm font-semibold text-primary">OCR解析中...</p>
              <p className="text-xs text-muted-foreground">タイムカード画像を読み取っています</p>
            </div>
          ) : (
            <TimecardTable
              rows={activeRows}
              currentDate={currentDate}
              workplace={activeWp}
              onBreakMinutesChange={onBreakMinutesChange}
              onEditTime={onEditTime}
              onToggleManualEdit={onToggleManualEdit}
              onRequestAddData={onRequestAddData}
              onOpenManual={onOpenManual}
            />
          )}

          <BucketSummary buckets={activeBuckets} />

          {/* この職場の小計 */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/20">
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{activeWp.name} 小計</span>
              <span className="ml-2 tabular-nums">¥{rateStr || "—"} × {activeHours.toFixed(1)}h</span>
            </div>
            <span className="text-lg font-bold tabular-nums text-primary" data-testid={`wp-subtotal-${activeWp.id}`}>
              {hasRate ? formatJPY(subtotal) : "¥ —"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 手当セクション（通勤手当・役職手当などの支給項目）
// 入力した手当は総支給額に加算される
// ─────────────────────────────────────────────

let allowanceCounter = 0;
function newAllowanceId(): string {
  allowanceCounter += 1;
  return `al_${Date.now()}_${allowanceCounter}`;
}

function AllowancesSection({
  allowances,
  onChange,
  disabled,
}: {
  allowances: AllowanceItem[];
  onChange: (next: AllowanceItem[]) => void;
  disabled?: boolean;
}) {
  const total = allowances.reduce((s, a) => s + (a.amount || 0), 0);

  const addAllowance = () => {
    onChange([...allowances, { id: newAllowanceId(), type: "", amount: 0 }]);
  };
  const updateAllowance = (id: string, patch: Partial<AllowanceItem>) => {
    onChange(allowances.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };
  const removeAllowance = (id: string) => {
    onChange(allowances.filter((a) => a.id !== id));
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Plus className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-bold text-foreground">手当</h3>
        {allowances.length > 0 && (
          <span className="ml-auto text-xs font-semibold tabular-nums text-foreground" data-testid="allowance-total">
            合計 {formatJPY(total)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        通勤手当・役職手当・資格手当などの支給項目を追加すると、総支給額に加算されます。
      </p>

      {allowances.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-6 text-center">
          <p className="text-xs text-muted-foreground/60">支給項目はまだ登録されていません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allowances.map((a) => (
            <div key={a.id} className="flex items-center gap-2" data-testid="allowance-row">
              <input
                type="text"
                value={a.type}
                list="allowance-type-presets"
                placeholder="手当の種類"
                disabled={disabled}
                onChange={(e) => updateAllowance(a.id, { type: e.target.value })}
                data-testid="allowance-type-input"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
              <div className="relative w-32 flex-shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">¥</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={a.amount ? a.amount.toLocaleString("ja-JP") : ""}
                  placeholder="0"
                  disabled={disabled}
                  onChange={(e) => {
                    const d = e.target.value.replace(/[^0-9]/g, "");
                    updateAllowance(a.id, { amount: d ? parseInt(d, 10) : 0 });
                  }}
                  data-testid="allowance-amount-input"
                  className="w-full pl-7 pr-3 py-2 rounded-lg border border-border bg-background text-sm text-right tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <button
                type="button"
                onClick={() => removeAllowance(a.id)}
                disabled={disabled}
                aria-label="手当を削除"
                data-testid="allowance-delete"
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addAllowance}
        disabled={disabled}
        data-testid="allowance-add"
        className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg border border-dashed border-border text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus className="w-3.5 h-3.5" />
        手当を追加
      </button>

      <datalist id="allowance-type-presets">
        {ALLOWANCE_TYPE_PRESETS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

// ─────────────────────────────────────────────
// 計算結果カード
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// 控除額内訳（モックアップ用の簡易計算）
// ─────────────────────────────────────────────
interface DeductionBreakdown {
  health: number;          // 健康保険料（労使折半後の従業員負担）
  nursingCare: number;     // 介護保険料（40歳以上のみ）
  childcare: number;       // こども子育て支援金
  pension: number;         // 厚生年金保険料
  labor: number;           // 労働保険（雇用保険・従業員負担）
  incomeTax: number;       // 所得税（源泉徴収）
  residentTax: number;     // 住民税
  total: number;
  isNursingCareTarget: boolean;
}

function calcDeductions(
  grossAmount: number,
  master: EmployeeMaster | undefined,
  yyyymm: string,
  prefecture: string,
): DeductionBreakdown {
  // 都道府県×年月の料率マスタを参照（マスタに無ければ全国平均フォールバック）
  const rates = getInsuranceRateOrFallback(prefecture, yyyymm);

  const enrolled = !!master?.isSocialInsurance && (master?.standardRemuneration ?? 0) > 0;
  const standardRem = enrolled ? master!.standardRemuneration : 0;
  const isNursingCareTarget = enrolled && !!master
    ? isNursingCareInsuranceTarget(master.birthDate, yyyymm)
    : false;

  // 健康保険(基本部分) — 標準報酬月額 × 都道府県別料率 × 折半
  const health = enrolled
    ? Math.floor(standardRem * rates.healthInsuranceRate / 2)
    : 0;
  // 介護保険(40歳以上) — 上乗せ分（全国一律料率）
  const nursingCare = isNursingCareTarget
    ? Math.floor(standardRem * rates.nursingCareInsuranceRate / 2)
    : 0;
  // こども子育て支援金 — 標準報酬 × 0.36% × 折半 (令和8年度導入予定の試算)
  const childcare = enrolled ? Math.floor(standardRem * 0.0036 / 2) : 0;
  // 厚生年金 — 都道府県別料率(現状は全国一律18.30%) 労使折半
  const pension = enrolled ? Math.floor(standardRem * rates.pensionInsuranceRate / 2) : 0;
  // 雇用保険（労働保険のうち従業員負担分） — 総支給 × 0.6%
  const labor = grossAmount > 0 ? Math.floor(grossAmount * 0.006) : 0;
  // 所得税 — 社保控除後の金額をベースに簡易計算
  const taxableBase = Math.max(0, grossAmount - health - nursingCare - pension - labor);
  const incomeTax = grossAmount > 0 ? calculateIncomeTax(taxableBase) : 0;
  // 住民税 — 従業員マスタの residentTax（決定通知書の月額）をそのまま引き当て
  const residentTax = grossAmount > 0 ? (master?.residentTax ?? 0) : 0;

  const total = health + nursingCare + childcare + pension + labor + incomeTax + residentTax;
  return { health, nursingCare, childcare, pension, labor, incomeTax, residentTax, total, isNursingCareTarget };
}

// ─────────────────────────────────────────────
// 計算結果カード
// ─────────────────────────────────────────────

interface ResultCardProps {
  grossAmount: number;
  /** 手当を除いた基本給（時給制: 時給×正味労働時間 / 月給制: 月給額） */
  baseAmount: number;
  /** 手当合計（時給制のみ。月給制では 0） */
  allowancesTotal: number;
  payType: PayType;
  currentDate: Date;
  master: EmployeeMaster | undefined;
  employeeName: string;
  /** 控除計算に使用する所属事業所の都道府県（料率マスタのキー） */
  prefecture: string;
  previousMonth: { gross: number; incomeTax: number };
  isLocked: boolean;
  canLock: boolean;
  onLock: (deductions: DeductionBreakdown) => void;
  onUnlock: () => void;
}

const SHARE_DUMMY_URL = "https://app.payroll-saas.com/dummy-link";

const PAYSLIP_PRINT_ID = "payslip-print-target";

async function downloadPayslipPdf(employeeName: string, currentDate: Date) {
  const target = typeof document !== "undefined" ? document.getElementById(PAYSLIP_PRINT_ID) : null;
  if (!target) {
    toast.error("給与明細の出力対象が見つかりません");
    return;
  }
  const yyyymm = toYearMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
  const safeName = (employeeName || "従業員").replace(/[\\/:*?"<>|\s]+/g, "");
  const filename = `${safeName}_給与明細_${yyyymm}.pdf`;
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const usableWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * usableWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = margin;
    pdf.addImage(imgData, "JPEG", margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", margin, position, usableWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }
    pdf.save(filename);
    toast.success(`${filename} をダウンロードしました`);
  } catch (err) {
    console.error("[downloadPayslipPdf]", err);
    toast.error("PDF生成に失敗しました");
  }
}

async function sharePayslip(employeeName: string, currentDate: Date) {
  const monthStr = monthLabel(currentDate);
  const payload = {
    title: `${monthStr}分 給与明細`,
    text: `${employeeName}さんの${monthStr}分の給与明細が確定しました。以下のリンクから確認してください。`,
    url: SHARE_DUMMY_URL,
  };
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share(payload);
      toast.success("共有メニューを開きました");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload.url);
    }
    if (typeof window !== "undefined") {
      window.alert("共有メニューを開きました（ダミーURLをコピーしました）");
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    toast.error("共有に失敗しました");
  }
}

function DeductionRow({ label, amount, hint, faded }: { label: string; amount: number; hint?: string; faded?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-2 px-1 text-xs border-b border-border/40 last:border-b-0",
      faded && "opacity-50",
    )}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span>{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground/70">({hint})</span>}
      </div>
      <span className="font-semibold tabular-nums text-foreground">{formatJPY(amount)}</span>
    </div>
  );
}

function ResultCard({
  grossAmount, baseAmount, allowancesTotal, payType, currentDate, master, employeeName, prefecture,
  previousMonth, isLocked, canLock, onLock, onUnlock,
}: ResultCardProps) {
  const yyyymm = toYearMonth(currentDate.getFullYear(), currentDate.getMonth() + 1);
  // 都道府県/年月/標報/総支給 のいずれかが変わると即時に再計算（リアクティブ更新）
  const deductions = useMemo(
    () => calcDeductions(grossAmount, master, yyyymm, prefecture),
    [grossAmount, master, yyyymm, prefecture],
  );
  const hasValue = grossAmount > 0;
  const currentNet = Math.max(0, grossAmount - deductions.total);
  const prevNet = Math.max(0, previousMonth.gross - previousMonth.incomeTax);

  return (
    <div className="space-y-4">
      {/* PDF出力ターゲット — サマリー＋控除額カードを内包 */}
      <div id={PAYSLIP_PRINT_ID} className="space-y-4 bg-background">
      {/* サマリー */}
      <div className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-foreground">支給額・控除額シミュレーション</span>
          </div>
          <span className="text-xs text-muted-foreground">{monthLabel(currentDate)}</span>
        </div>
        <div className="border-t border-border/60" />

        {/* 総支給額 */}
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
          {payType === "hourly" && allowancesTotal > 0 && (
            <p className="text-[11px] text-muted-foreground tabular-nums" data-testid="gross-breakdown">
              基本給 {formatJPY(baseAmount)} ＋ 手当 {formatJPY(allowancesTotal)}
            </p>
          )}
        </div>

        {/* 2列×2行: 当月/前月 × 支給額/源泉徴収 */}
        <div className="grid grid-cols-2 gap-3">
          {/* 当月支給額 */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 space-y-1" data-testid="current-net">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">当月の支給額</p>
            <p className={cn("text-lg font-bold tabular-nums", hasValue ? "text-primary" : "text-muted-foreground/40")}>
              {hasValue ? formatJPY(currentNet) : "¥ —"}
            </p>
            <p className="text-[10px] text-muted-foreground">総支給 − 控除合計</p>
          </div>
          {/* 当月源泉徴収 */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 space-y-1" data-testid="current-tax">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">当月の源泉徴収額</p>
            <p className={cn("text-lg font-bold tabular-nums", hasValue && deductions.incomeTax > 0 ? "text-primary" : "text-muted-foreground/40")}>
              {hasValue ? formatJPY(deductions.incomeTax) : "¥ —"}
            </p>
            <p className="text-[10px] text-muted-foreground">所得税(月額表)</p>
          </div>
          {/* 前月支給額 */}
          <div className="bg-muted/40 border border-border/60 rounded-xl px-4 py-3 space-y-1" data-testid="prev-net">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">前月の支給額</p>
            <p className="text-lg font-bold tabular-nums text-foreground">
              {previousMonth.gross > 0 ? formatJPY(prevNet) : "¥ —"}
            </p>
            <p className="text-[10px] text-muted-foreground">参考値</p>
          </div>
          {/* 前月源泉徴収 */}
          <div className="bg-muted/40 border border-border/60 rounded-xl px-4 py-3 space-y-1" data-testid="prev-tax">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">前月の源泉徴収額</p>
            <p className="text-lg font-bold tabular-nums text-foreground">
              {previousMonth.gross > 0 ? formatJPY(previousMonth.incomeTax) : "¥ —"}
            </p>
            <p className="text-[10px] text-muted-foreground">参考値</p>
          </div>
        </div>

        {hasValue && grossAmount < 88_000 && (
          <p className="text-xs text-muted-foreground px-1">月額 88,000 円未満のため源泉徴収なし</p>
        )}
      </div>

      {/* 控除額 アコーディオン */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <Accordion type="single" collapsible defaultValue={undefined}>
          <AccordionItem value="deductions" className="border-b-0">
            <AccordionTrigger
              className="px-5 py-4 hover:no-underline"
              data-testid="deduction-toggle"
            >
              <div className="flex items-center justify-between w-full pr-2">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold text-foreground">控除額合計</span>
                </div>
                <span className={cn(
                  "text-xl font-bold tabular-nums",
                  hasValue ? "text-foreground" : "text-muted-foreground/40",
                )}
                  data-testid="deduction-total"
                >
                  {hasValue ? formatJPY(deductions.total) : "¥ —"}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-5">
              <div className="rounded-xl bg-muted/20 border border-border/40 px-3 py-1">
                <DeductionRow label="健康保険料" amount={deductions.health} />
                <DeductionRow
                  label="介護保険料"
                  amount={deductions.nursingCare}
                  hint={deductions.isNursingCareTarget ? "40歳以上" : "対象外"}
                  faded={!deductions.isNursingCareTarget}
                />
                <DeductionRow label="こども子育て支援金" amount={deductions.childcare} />
                <DeductionRow label="厚生年金保険料" amount={deductions.pension} />
                <DeductionRow label="労働保険" amount={deductions.labor} hint="雇用保険・従業員負担" />
                <DeductionRow label="所得税" amount={deductions.incomeTax} />
                <DeductionRow label="住民税" amount={deductions.residentTax} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 px-1">
                ※ 各項目は標準報酬月額・総支給額に基づくモックアップ計算です。
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      </div>
      {/* /PDF出力ターゲット */}

      {/* 確定ボタン */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        {isLocked ? (
          <>
            <div className="flex-1 min-w-[180px] flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-green-50 border border-green-200 text-green-700">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-bold">{monthLabel(currentDate)} 確定済</span>
            </div>
            <button
              type="button"
              onClick={() => sharePayslip(employeeName, currentDate)}
              data-testid="share-payslip"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 shadow-sm transition-colors"
            >
              <Share2 className="w-4 h-4" />
              給与明細を共有する
            </button>
            <button
              type="button"
              onClick={() => downloadPayslipPdf(employeeName, currentDate)}
              data-testid="download-payslip-pdf"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-xl border border-primary/40 text-primary bg-primary/5 text-sm font-semibold hover:bg-primary/10 transition-colors"
            >
              <Download className="w-4 h-4" />
              PDFをダウンロード
            </button>
            <button
              type="button"
              onClick={onUnlock}
              data-testid="unlock-month"
              className="px-4 py-3.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              解除
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onLock(deductions)}
            disabled={!canLock || !hasValue}
            data-testid="lock-month"
            className={cn(
              "w-full px-5 py-3.5 rounded-xl text-base font-bold transition-all",
              canLock && hasValue
                ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow"
                : "bg-muted text-muted-foreground/50 cursor-not-allowed",
            )}
          >
            {monthLabel(currentDate)} の給与を確定
          </button>
        )}
      </div>
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
  const [includeEarlyOvertime, setIncludeEarlyOvertime] = useState(false);
  const [applyLateNightPremium, setApplyLateNightPremium] = useState(true);

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
      setIncludeEarlyOvertime(initial.includeEarlyOvertime ?? false);
      setApplyLateNightPremium(initial.applyLateNightPremium ?? true);
    } else {
      setName("");
      setStart("09:00");
      setEnd("18:00");
      setRest(60);
      setRounding("1min");
      setLegal("Sunday");
      setScheduled(["Saturday"]);
      setPrefecture(PREFECTURE_OPTIONS[0]);
      setIncludeEarlyOvertime(false);
      setApplyLateNightPremium(true);
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
      includeEarlyOvertime,
      applyLateNightPremium,
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

          {/* 割増ルール（行ごとの設定から職場マスタへ移動） */}
          <div className="space-y-2.5 pt-1 border-t border-border/60">
            <p className="text-sm font-medium text-foreground pt-2">割増・残業ルール</p>

            <div className="flex items-start gap-3 rounded-xl border border-border p-3">
              <div className="mt-0.5 w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
                <Sunrise className="w-4 h-4 text-amber-600" />
              </div>
              <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                <div>
                  <p className="text-xs font-semibold text-foreground">朝残業(早出)を算入</p>
                  <p className="text-[10px] text-muted-foreground">始業前の打刻を朝残業として計上</p>
                </div>
                <Switch
                  checked={includeEarlyOvertime}
                  onCheckedChange={setIncludeEarlyOvertime}
                  aria-label="朝残業を算入"
                  className="data-[state=checked]:bg-amber-500 flex-shrink-0"
                />
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-border p-3">
              <div className="mt-0.5 w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center flex-shrink-0">
                <Moon className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                <div>
                  <p className="text-xs font-semibold text-foreground">深夜割増(22時以降)を適用</p>
                  <p className="text-[10px] text-muted-foreground">22時以降の労働に25%割増</p>
                </div>
                <Switch
                  checked={applyLateNightPremium}
                  onCheckedChange={setApplyLateNightPremium}
                  aria-label="深夜割増を適用"
                  className="data-[state=checked]:bg-indigo-500 flex-shrink-0"
                />
              </div>
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
  employeeName: string;
  workplaces: Record<string, WorkplaceDef>;
  onAddWorkplace: (key: string, def: WorkplaceDef) => void;
  onUpdateWorkplace: (id: string, def: WorkplaceDef) => void;
  employeeDB: Record<string, EmployeeMaster>;
  payrollResultDB: PayrollResult[];
  onLockOne: (result: PayrollResult) => void;
  onUnlockOne: (employeeId: string, targetYearMonth: string) => void;
}

export function PayrollTab({
  currentDate, employeeId, employeeName, workplaces, onAddWorkplace, onUpdateWorkplace,
  employeeDB, payrollResultDB, onLockOne, onUnlockOne,
}: PayrollTabProps) {
  const [payType, setPayType] = useState<PayType>("monthly");
  const [monthlySalaryInput, setMonthlySalaryInput] = useState("");
  const [ocrState, setOcrState] = useState<OcrState>("idle");

  // 打刻データ追加フロー
  const [inputDrawerOpen, setInputDrawerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualEntryDraft | null>(null);
  const [manualLockDate, setManualLockDate] = useState(false);
  const ocrInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  // OCRの遅延コールバックが古い状態を上書きしないようにする実行ID
  const ocrRunIdRef = useRef(0);

  // タイムカード State（localStorage 同期 — モックアップデモ用）
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;
  const storageKey = `timecard_${DEFAULT_TENANT_ID}_${employeeId}_${year}_${month}`;
  const [timecardRows, setTimecardRows] = useKeyedPersistedState<TimecardRow[]>(
    storageKey,
    () => {
      const entries = getTimecardEntries(employeeId, year, month);
      return seedRows(entries, workplaces);
    },
  );

  // 職場別の基本時給 State（localStorage 同期）。初期値は DEFAULT_HOURLY_RATES。
  const ratesKey = `hourlyRates_${DEFAULT_TENANT_ID}_${employeeId}_${year}_${month}`;
  const [workplaceRates, setWorkplaceRates] = useKeyedPersistedState<Record<string, string>>(
    ratesKey,
    () => {
      const init: Record<string, string> = {};
      for (const id of Object.keys(workplaces)) {
        const def = DEFAULT_HOURLY_RATES[id];
        init[id] = def ? toDisplayValue(String(def)) : "";
      }
      return init;
    },
  );

  // 手当 State（localStorage 同期）。従業員/月 単位で永続化。
  const allowancesKey = `allowances_${DEFAULT_TENANT_ID}_${employeeId}_${year}_${month}`;
  const [allowances, setAllowances] = useKeyedPersistedState<AllowanceItem[]>(
    allowancesKey,
    () => [],
  );

  // アクティブな事業所タブ
  const [activeWpId, setActiveWpId] = useState<string>(
    () => (workplaces[DEFAULT_WP_KEY] ? DEFAULT_WP_KEY : Object.keys(workplaces)[0] ?? DEFAULT_WP_KEY),
  );
  // 職場が削除/変更されてアクティブタブが無効化されたら先頭にフォールバック
  useEffect(() => {
    if (!workplaces[activeWpId]) {
      setActiveWpId(workplaces[DEFAULT_WP_KEY] ? DEFAULT_WP_KEY : Object.keys(workplaces)[0] ?? DEFAULT_WP_KEY);
    }
  }, [workplaces, activeWpId]);

  // Dialog state
  const [wpDialogOpen, setWpDialogOpen] = useState(false);
  const [wpDialogMode, setWpDialogMode] = useState<"create" | "edit">("create");
  const [wpDialogRowId, setWpDialogRowId] = useState<string | null>(null);
  const [wpDialogEditId, setWpDialogEditId] = useState<string | null>(null);

  // 月 / 従業員変更時に OCR バナー状態をリセット（進行中の遅延コールバックも無効化）
  useEffect(() => {
    ocrRunIdRef.current += 1;
    setOcrState("idle");
  }, [storageKey]);

  // ① 画像からOCR: 数秒のローディング後に自動入力。3日・5日は読み取りエラー（要手修正）にする。
  const handleOcrFile = () => {
    const runId = (ocrRunIdRef.current += 1);
    setOcrState("loading");
    setTimeout(() => {
      // 月/従業員が変わった、またはCSV等で別操作が走った場合は古い結果を破棄
      if (ocrRunIdRef.current !== runId) return;
      const entries = getTimecardEntries(employeeId, year, month);
      const seeded = seedRows(entries, workplaces).map((r) => {
        const dm = r.date.match(/^(\d+)\/(\d+)/);
        const day = dm ? parseInt(dm[2], 10) : 0;
        if (day === 3 || day === 5) {
          return {
            ...r,
            ocrStatus: "error" as TimecardOcrStatus,
            ocrStart: "", ocrEnd: "", stdStart: "--:--", stdEnd: "--:--",
            editStart: "", editEnd: "", timeManuallyEdited: false, manualEdit: false,
          };
        }
        return { ...r, ocrStatus: "success" as TimecardOcrStatus };
      });
      setTimecardRows(seeded);
      setOcrState("done");
      const errs = seeded.filter((r) => r.ocrStatus === "error").length;
      if (errs > 0) {
        toast.error(`${errs}件の打刻が読み取れませんでした`, { description: "赤色の行をタップして手修正してください" });
      } else {
        toast.success("OCR解析が完了しました");
      }
    }, 2500);
  };

  // ③ Excel / CSV インポート: 全行を取り込み済みにしてトーストで件数を表示。
  const handleCsvFile = () => {
    // 進行中のOCR遅延コールバックを無効化（インポート結果の上書きを防ぐ）
    ocrRunIdRef.current += 1;
    const entries = getTimecardEntries(employeeId, year, month);
    const seeded = seedRows(entries, workplaces).map((r) => ({ ...r, ocrStatus: "success" as TimecardOcrStatus }));
    setTimecardRows(seeded);
    setOcrState("done");
    toast.success(`${seeded.length}件のデータをインポートしました`);
  };

  // ボトムシートの各モード
  const handlePickOcr = () => { setInputDrawerOpen(false); ocrInputRef.current?.click(); };
  const handlePickCsv = () => { setInputDrawerOpen(false); csvInputRef.current?.click(); };
  const handlePickManual = () => { handleOpenManual(null); };

  // ② 手動入力モーダルを開く。rowId 指定時はエラー行の修正（対象日固定）。
  const handleOpenManual = (rowId: string | null) => {
    setInputDrawerOpen(false);
    const activeWp = workplaces[activeWpId] ?? workplaces[DEFAULT_WP_KEY] ?? Object.values(workplaces)[0];
    if (rowId) {
      const row = timecardRows.find((r) => r.id === rowId);
      if (!row) return;
      const dm = row.date.match(/^(\d+)\/(\d+)/);
      const day = dm ? parseInt(dm[2], 10) : currentDate.getDate();
      setManualDraft({ rowId, workplaceId: row.workplaceId, day, start: "", end: "", breakMinutes: row.breakMinutes });
      setManualLockDate(true);
    } else {
      setManualDraft({
        rowId: null,
        workplaceId: activeWp?.id ?? DEFAULT_WP_KEY,
        day: currentDate.getDate(),
        start: "", end: "",
        breakMinutes: activeWp?.defaultRestMinutes ?? 60,
      });
      setManualLockDate(false);
    }
    setManualOpen(true);
  };

  // 事業所タブの「＋事業所を追加」: 新規作成ダイアログを開く
  const handleAddWorkplaceTab = () => {
    setWpDialogMode("create");
    setWpDialogRowId(null);
    setWpDialogEditId(null);
    setWpDialogOpen(true);
  };

  const handleRateChange = (wpId: string, value: string) => {
    setWorkplaceRates((prev) => ({ ...prev, [wpId]: value }));
  };

  const handleCopyPrevRate = (wpId: string) => {
    const prev = prevRates[wpId];
    if (!prev) return;
    setWorkplaceRates((cur) => ({ ...cur, [wpId]: prev }));
    toast.success("前月の時給を反映しました", { description: `¥${prev}` });
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
      setWorkplaceRates((prev) => ({ ...prev, [newKey]: prev[newKey] ?? "" }));
      setActiveWpId(newKey);
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

  // えんぴつ: success 行の手動上書き入力を開閉。開く時、現在の計上時刻を editStart/End に流し込む。
  const handleToggleManualEdit = (id: string) =>
    setTimecardRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      if (r.manualEdit) return { ...r, manualEdit: false };
      const wp = workplaces[r.workplaceId];
      const start = r.editStart || (wp?.includeEarlyOvertime ? r.ocrStart : r.stdStart) || "";
      const end = r.editEnd || r.stdEnd || "";
      const valid = (t: string) => /^\d{2}:\d{2}$/.test(t);
      return {
        ...r,
        manualEdit: true,
        editStart: valid(start) ? start : r.editStart,
        editEnd: valid(end) ? end : r.editEnd,
      };
    }));

  // 手動入力モーダルの保存: rowId 指定時はエラー行を確定、未指定時は新規行を追加。
  const handleManualSave = (draft: ManualEntryDraft) => {
    const { rowId, workplaceId, day, start, end, breakMinutes } = draft;
    const wp = workplaces[workplaceId] ?? workplaces[DEFAULT_WP_KEY];
    const resolvedWpId = workplaces[workplaceId] ? workplaceId : DEFAULT_WP_KEY;
    const restEdited = breakMinutes !== (wp?.defaultRestMinutes ?? 60);

    if (rowId) {
      setTimecardRows((prev) => prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              workplaceId: resolvedWpId,
              breakMinutes,
              isRestManuallyEdited: restEdited || r.isRestManuallyEdited,
              ocrStatus: "success" as TimecardOcrStatus,
              ocrStart: start, ocrEnd: end,
              stdStart: start, stdEnd: end,
              editStart: start, editEnd: end,
              timeManuallyEdited: true,
              manualEdit: false,
            }
          : r
      ));
      toast.success("打刻を修正しました");
    } else {
      manualRowCounter += 1;
      const dt = new Date(year, month - 1, day);
      const dateLabel = `${month}/${day}（${DOW_JP[DOW_LIST[dt.getDay()]]}）`;
      setTimecardRows((prev) => [
        ...prev,
        {
          tenantId: DEFAULT_TENANT_ID,
          id: `m${manualRowCounter}`,
          date: dateLabel,
          year, month,
          ocrStatus: "success",
          ocrStart: start, ocrEnd: end, editStart: start, editEnd: end,
          stdStart: start, stdEnd: end,
          workplaceId: resolvedWpId,
          breakMinutes,
          timeManuallyEdited: true,
          manualEdit: false,
          isRestManuallyEdited: restEdited,
        },
      ]);
      toast.success("打刻データを保存しました");
    }
    setManualOpen(false);
  };

  // 職場別 5区分集計 (workplaces / timecardRows 変更で再計算)
  const bucketsByWorkplace = useMemo<Record<string, TimeBuckets>>(() => {
    const map: Record<string, TimeBuckets> = {};
    for (const id of Object.keys(workplaces)) map[id] = { ...EMPTY_BUCKETS };
    for (const row of timecardRows) {
      const wp = workplaces[row.workplaceId];
      if (!wp) continue;
      const needsInput = row.ocrStatus === "error" || row.ocrStatus === "manual";
      const editing = needsInput || row.manualEdit;
      const effectiveStart = editing
        ? (row.editStart || "--:--")
        : wp.includeEarlyOvertime ? row.ocrStart : row.stdStart;
      const effectiveEnd = editing ? (row.editEnd || "--:--") : row.stdEnd;
      const rowDate = getRowDate(row.year, row.date);
      const holiday = detectHoliday(rowDate, wp);
      const buckets = calcRowBuckets(
        effectiveStart, effectiveEnd, row.ocrStart, row.stdStart,
        row.breakMinutes, wp.includeEarlyOvertime, holiday,
        wp.applyLateNightPremium !== false,
      );
      map[row.workplaceId] = addBuckets(map[row.workplaceId] ?? { ...EMPTY_BUCKETS }, buckets);
    }
    return map;
  }, [timecardRows, workplaces]);

  // 職場別の正味労働時間
  const hoursByWorkplace = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const [id, b] of Object.entries(bucketsByWorkplace)) map[id] = bucketNetHours(b);
    return map;
  }, [bucketsByWorkplace]);

  // 全職場合計の正味労働時間（確定スナップショット用）
  const totalHours = useMemo(
    () => Object.values(hoursByWorkplace).reduce((a, b) => a + b, 0),
    [hoursByWorkplace],
  );

  // 時給制総支給 = Σ（職場別時給 × 職場別実働時間）
  const hourlyGross = useMemo(() => {
    let sum = 0;
    for (const [id, hours] of Object.entries(hoursByWorkplace)) {
      const rate = parseInt((workplaceRates[id] ?? "").replace(/[^0-9]/g, ""), 10) || 0;
      sum += rate * hours;
    }
    return Math.round(sum);
  }, [hoursByWorkplace, workplaceRates]);

  // 手当合計（時給制の総支給額に加算）
  const allowancesTotal = useMemo(
    () => allowances.reduce((s, a) => s + (a.amount || 0), 0),
    [allowances],
  );

  const monthlyRaw = parseInt(monthlySalaryInput.replace(/[^0-9]/g, ""), 10) || 0;
  // 確定スナップショットの「適用基本給」用: 主たる事業所（既定→先頭）の時給
  const primaryHourlyRate = useMemo(() => {
    const primaryId = workplaces[DEFAULT_WP_KEY] ? DEFAULT_WP_KEY : Object.keys(workplaces)[0];
    return parseInt((workplaceRates[primaryId] ?? "").replace(/[^0-9]/g, ""), 10) || 0;
  }, [workplaceRates, workplaces]);
  const grossAmount = payType === "monthly" ? monthlyRaw : hourlyGross + allowancesTotal;

  // 前月給与の取得（PayrollResultDB → なければモックダミー）
  const yyyymm = toYearMonth(year, month);
  const prevDate = new Date(year, month - 2, 1);
  const prevYM = toYearMonth(prevDate.getFullYear(), prevDate.getMonth() + 1);

  // 前月の職場別時給（"前月と同様"用）。前月の localStorage を参照し、無ければ既定時給。
  const prevRatesKey = `hourlyRates_${DEFAULT_TENANT_ID}_${employeeId}_${prevDate.getFullYear()}_${prevDate.getMonth() + 1}`;
  const prevRates = useMemo<Record<string, string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(prevRatesKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, string>;
          if (parsed && typeof parsed === "object") return parsed;
        }
      } catch {
        /* フォールバックへ */
      }
    }
    const init: Record<string, string> = {};
    for (const id of Object.keys(workplaces)) {
      const def = DEFAULT_HOURLY_RATES[id];
      if (def) init[id] = toDisplayValue(String(def));
    }
    return init;
  }, [prevRatesKey, workplaces]);
  const prevSnapshot = useMemo(
    () => payrollResultDB.find(
      (p) => p != null && p.employeeId === employeeId && p.targetYearMonth === prevYM,
    ),
    [payrollResultDB, employeeId, prevYM],
  );
  const previousMonth = useMemo(() => {
    if (prevSnapshot) {
      return {
        gross: prevSnapshot.totalPayment,
        incomeTax: calculateIncomeTax(prevSnapshot.totalPayment),
      };
    }
    // モックダミー（前月データ未確定時）
    return { gross: 298_000, incomeTax: calculateIncomeTax(298_000) };
  }, [prevSnapshot]);

  // 当月ロック状態
  const lockedSnapshot = useMemo(
    () => payrollResultDB.find(
      (p) =>
        p != null &&
        p.tenantId === DEFAULT_TENANT_ID &&
        p.employeeId === employeeId &&
        p.targetYearMonth === yyyymm &&
        p.status === "locked",
    ),
    [payrollResultDB, employeeId, yyyymm],
  );

  const master = employeeDB[employeeId];

  // 所属事業所の都道府県を導出（社会保険料率の都道府県別計算用）。
  // タイムカードに打刻された職場のうち最も労働時間が多い職場を「主たる事業所」とし、
  // 打刻が無い（月給制等）場合は既定職場 (DEFAULT_WP_KEY) → 任意の職場 の順でフォールバック。
  // workplaces の prefecture 設定変更 / 月切替 / 打刻内容変更で即時に再評価される。
  const primaryPrefecture = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const row of timecardRows) {
      const h = calcHours(row.stdStart, row.stdEnd) - (row.breakMinutes ?? 0) / 60;
      if (h > 0) totals[row.workplaceId] = (totals[row.workplaceId] ?? 0) + h;
    }
    let topId: string | null = null;
    let topHours = -1;
    for (const [id, h] of Object.entries(totals)) {
      if (h > topHours) { topHours = h; topId = id; }
    }
    const wp: WorkplaceDef | undefined =
      (topId ? workplaces[topId] : undefined) ??
      workplaces[DEFAULT_WP_KEY] ??
      Object.values(workplaces)[0];
    return wp?.prefecture ?? "東京都";
  }, [timecardRows, workplaces]);

  const handleLock = (deductions: DeductionBreakdown) => {
    const result: PayrollResult = {
      tenantId: DEFAULT_TENANT_ID,
      id: buildPayrollResultId(employeeId, year, month),
      employeeId,
      targetYearMonth: yyyymm,
      status: "locked",
      appliedSalaryType: payType === "monthly" ? "月給" : "時給",
      appliedBaseSalary: payType === "monthly" ? monthlyRaw : primaryHourlyRate,
      totalWorkingHours: payType === "hourly"
        ? Math.round(totalHours * 100) / 100
        : 0,
      totalPayment: grossAmount,
      totalDeduction: deductions.total,
      netPay: Math.max(0, grossAmount - deductions.total),
      lockedAt: new Date().toISOString(),
    };
    onLockOne(result);
    toast.success(`${monthLabel(currentDate)} の給与を確定しました`, {
      description: `総支給 ${formatJPY(grossAmount)} / 差引支給額 ${formatJPY(Math.max(0, grossAmount - deductions.total))}`,
    });
  };

  const handleUnlock = () => {
    onUnlockOne(employeeId, yyyymm);
    toast.info(`${monthLabel(currentDate)} の確定を解除しました`);
  };

  const dialogInitial = wpDialogMode === "edit" && wpDialogEditId ? workplaces[wpDialogEditId] ?? null : null;

  const isLocked = !!lockedSnapshot;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Calculator className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">所得税シミュレーター</p>
              {isLocked && (
                <span
                  data-testid="locked-badge"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  確定済み
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">甲欄・扶養親族0人(令和6年分)</p>
          </div>
        </div>
        <PayTypePills value={payType} onChange={setPayType} disabled={isLocked} />
      </div>

      <fieldset
        disabled={isLocked}
        data-testid="payroll-form-fieldset"
        className={cn(
          "border-0 p-0 m-0 min-w-0 space-y-5 transition-opacity",
          isLocked && "opacity-60",
        )}
      >
        <div
          className={cn(
            "bg-card border border-border rounded-2xl p-5 shadow-sm space-y-5",
            isLocked && "bg-muted/40",
          )}
        >
          {payType === "monthly" ? (
            <MonthlyInput
              value={monthlySalaryInput}
              onChange={setMonthlySalaryInput}
              previousGross={previousMonth.gross}
            />
          ) : (
            <HourlySection
              workplaces={workplaces}
              rows={timecardRows}
              currentDate={currentDate}
              ocrState={ocrState}
              bucketsByWorkplace={bucketsByWorkplace}
              rates={workplaceRates}
              prevRates={prevRates}
              activeWpId={activeWpId}
              onActiveWpChange={setActiveWpId}
              onRateChange={handleRateChange}
              onCopyPrevRate={handleCopyPrevRate}
              onAddWorkplace={handleAddWorkplaceTab}
              onEditWorkplace={handleEditWorkplace}
              onBreakMinutesChange={handleBreakMinutesChange}
              onEditTime={handleEditTime}
              onToggleManualEdit={handleToggleManualEdit}
              onRequestAddData={() => setInputDrawerOpen(true)}
              onOpenManual={handleOpenManual}
            />
          )}
        </div>

        {payType === "hourly" && (
          <AllowancesSection
            allowances={allowances}
            onChange={setAllowances}
            disabled={isLocked}
          />
        )}
      </fieldset>

      <ResultCard
        grossAmount={grossAmount}
        baseAmount={payType === "monthly" ? monthlyRaw : hourlyGross}
        allowancesTotal={payType === "hourly" ? allowancesTotal : 0}
        payType={payType}
        currentDate={currentDate}
        master={master}
        employeeName={employeeName}
        prefecture={primaryPrefecture}
        previousMonth={previousMonth}
        isLocked={!!lockedSnapshot}
        canLock={true}
        onLock={handleLock}
        onUnlock={handleUnlock}
      />

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

      {/* 打刻データ追加フロー（時給制・編集可能時のみ） */}
      {payType === "hourly" && !isLocked && (
        <>
          {/* 隠しファイル入力（OCR画像 / CSV） */}
          <input
            ref={ocrInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleOcrFile(); e.target.value = ""; }}
          />
          <input
            ref={csvInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvFile(); e.target.value = ""; }}
          />

          {/* FAB */}
          <button
            type="button"
            onClick={() => setInputDrawerOpen(true)}
            data-testid="add-data-fab"
            className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground pl-4 pr-5 py-3.5 shadow-lg shadow-primary/30 hover:bg-primary/90 active:scale-95 transition-all"
          >
            <Plus className="w-5 h-5" />
            <span className="text-sm font-bold">打刻データを追加</span>
          </button>

          <DataInputDrawer
            open={inputDrawerOpen}
            onOpenChange={setInputDrawerOpen}
            onPickOcr={handlePickOcr}
            onPickManual={handlePickManual}
            onPickCsv={handlePickCsv}
          />

          <ManualEntryModal
            open={manualOpen}
            onOpenChange={setManualOpen}
            workplaces={workplaces}
            currentDate={currentDate}
            draft={manualDraft}
            lockDate={manualLockDate}
            onSave={handleManualSave}
          />
        </>
      )}
    </div>
  );
}
