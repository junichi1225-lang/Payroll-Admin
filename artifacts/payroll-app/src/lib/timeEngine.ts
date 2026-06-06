/**
 * 勤務時間エンジン（純粋ロジック）
 *
 * タイムカード行 → 5区分労働時間バケット → 職場別の正味労働時間・出勤日数・総支給
 * までを副作用なしで算出する。PayrollTab（シミュレーター）と payrollInputs アダプタ
 * （給与確定タブ向け）が同一ロジックを共用し、総支給額が両タブで一致するようにする。
 */

import { DayOfWeek, HolidayType, TimecardEntry, WorkplaceDef } from "@/lib/dummy-data";

const DOW_LIST: DayOfWeek[] = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// ───────────────────────────────────────────────────────────
// 時刻ユーティリティ
// ───────────────────────────────────────────────────────────

export function toMin(t: string): number {
  if (!t || t === "--:--") return -1;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

export function calcHours(start: string, end: string): number {
  const s = toMin(start);
  let e = toMin(end);
  if (s < 0 || e < 0) return 0;
  if (e <= s) e += 1440; // 日跨ぎ補正
  return (e - s) / 60;
}

/** 22:00–翌05:00 と [start, end] の重なり(分) */
export function calcLateNightMin(start: string, end: string): number {
  const s = toMin(start);
  let e = toMin(end);
  if (s < 0 || e < 0) return 0;
  if (e <= s) e += 1440;
  const overnight = Math.max(0, Math.min(e, 1740) - Math.max(s, 1320));
  const earlyMorning = Math.max(0, Math.min(e, 300) - Math.max(s, 0));
  return overnight + earlyMorning;
}

/** rowDate "M/D" + year → Date */
export function getRowDate(year: number, dateStr: string): Date {
  const m = dateStr.match(/^(\d+)\/(\d+)/);
  if (!m) return new Date(year, 0, 1);
  return new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

export function detectHoliday(date: Date, wp: WorkplaceDef): HolidayType {
  const dow = DOW_LIST[date.getDay()];
  if (dow === wp.legalHoliday) return "legal_holiday";
  if (wp.scheduledHoliday.includes(dow)) return "scheduled_holiday";
  return "weekday";
}

// ───────────────────────────────────────────────────────────
// 5区分労働時間バケット
// ───────────────────────────────────────────────────────────

export interface TimeBuckets {
  basic: number;            // 平日所定内
  overtime: number;         // 1日8h超
  earlyOvertime: number;    // 朝残業
  lateNight: number;        // 22:00–05:00
  legalHolidayWork: number; // 法定休日労働
  scheduledHolidayWork: number; // 所定休日労働
}

export const EMPTY_BUCKETS: TimeBuckets = {
  basic: 0, overtime: 0, earlyOvertime: 0, lateNight: 0,
  legalHolidayWork: 0, scheduledHolidayWork: 0,
};

export function addBuckets(a: TimeBuckets, b: TimeBuckets): TimeBuckets {
  return {
    basic: a.basic + b.basic,
    overtime: a.overtime + b.overtime,
    earlyOvertime: a.earlyOvertime + b.earlyOvertime,
    lateNight: a.lateNight + b.lateNight,
    legalHolidayWork: a.legalHolidayWork + b.legalHolidayWork,
    scheduledHolidayWork: a.scheduledHolidayWork + b.scheduledHolidayWork,
  };
}

export function calcRowBuckets(
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

/** 5区分バケットから正味労働時間（休憩差引後の実働合計）を算出 */
export function bucketNetHours(b: TimeBuckets): number {
  return b.basic + b.overtime + b.earlyOvertime + b.legalHolidayWork + b.scheduledHolidayWork;
}

// ───────────────────────────────────────────────────────────
// タイムカード行型
// ───────────────────────────────────────────────────────────

export type TimecardRow = TimecardEntry & {
  editStart: string;
  editEnd: string;
  workplaceId: string;
  breakMinutes: number;
  timeManuallyEdited: boolean;
  /** えんぴつアイコンで打刻の手動上書き編集を開いている状態（永続化対象） */
  manualEdit: boolean;
  /** 日次確定（この日の打刻を確定し編集をロック）した状態（永続化対象） */
  isDayConfirmed: boolean;
};

/** 1行が「出勤（実働>0）」かを判定。出勤日数カウントの単一ソース。 */
export function rowWorked(row: TimecardRow, wp: WorkplaceDef): boolean {
  const needsInput = row.ocrStatus === "error" || row.ocrStatus === "manual";
  const editing = needsInput || row.manualEdit;
  const effectiveStart = editing
    ? (row.editStart || "--:--")
    : wp.includeEarlyOvertime ? row.ocrStart : row.stdStart;
  const effectiveEnd = editing ? (row.editEnd || "--:--") : row.stdEnd;
  return calcHours(effectiveStart, effectiveEnd) > 0;
}

/** 職場別の出勤日数（実働>0の日をカウント）。日給制の小計・前月引き継ぎに使用。 */
export function countDaysByWorkplace(
  rows: TimecardRow[],
  workplaces: Record<string, WorkplaceDef>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const id of Object.keys(workplaces)) map[id] = 0;
  for (const row of rows) {
    const wp = workplaces[row.workplaceId];
    if (!wp) continue;
    if (rowWorked(row, wp)) map[row.workplaceId] = (map[row.workplaceId] ?? 0) + 1;
  }
  return map;
}

// ───────────────────────────────────────────────────────────
// 職場別集計・総支給（PayrollTab と給与確定アダプタで共用）
// ───────────────────────────────────────────────────────────

/** 職場別 5区分集計（PayrollTab の bucketsByWorkplace と同一ロジック）。 */
export function computeBucketsByWorkplace(
  rows: TimecardRow[],
  workplaces: Record<string, WorkplaceDef>,
): Record<string, TimeBuckets> {
  const map: Record<string, TimeBuckets> = {};
  for (const id of Object.keys(workplaces)) map[id] = { ...EMPTY_BUCKETS };
  for (const row of rows) {
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
}

/** 職場別の正味労働時間。 */
export function computeHoursByWorkplace(
  bucketsByWorkplace: Record<string, TimeBuckets>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [id, b] of Object.entries(bucketsByWorkplace)) map[id] = bucketNetHours(b);
  return map;
}

/** 数字以外を除去して整数化（"1,200" → 1200）。 */
function parseRate(raw: string | undefined): number {
  return parseInt((raw ?? "").replace(/[^0-9]/g, ""), 10) || 0;
}

/** 時給制総支給 = Σ（職場別時給 × 職場別実働時間）。 */
export function computeHourlyGross(
  hoursByWorkplace: Record<string, number>,
  rates: Record<string, string>,
): number {
  let sum = 0;
  for (const [id, hours] of Object.entries(hoursByWorkplace)) {
    sum += parseRate(rates[id]) * hours;
  }
  return Math.round(sum);
}

/** 日給制総支給 = Σ（職場別日給 × 職場別出勤日数）。 */
export function computeDailyGross(
  daysByWorkplace: Record<string, number>,
  rates: Record<string, string>,
): number {
  let sum = 0;
  for (const [id, days] of Object.entries(daysByWorkplace)) {
    sum += parseRate(rates[id]) * days;
  }
  return sum;
}

/** 全職場合計の正味労働時間。 */
export function totalNetHours(hoursByWorkplace: Record<string, number>): number {
  return Object.values(hoursByWorkplace).reduce((a, b) => a + b, 0);
}
