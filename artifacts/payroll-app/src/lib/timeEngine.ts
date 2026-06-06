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

/** 5区分バケットから正味労働時間（休憩差引後の実働合計・割増なし）を算出 */
export function bucketNetHours(b: TimeBuckets): number {
  return b.basic + b.overtime + b.earlyOvertime + b.legalHolidayWork + b.scheduledHolidayWork;
}

// ───────────────────────────────────────────────────────────
// 割増率（労働基準法）
// ───────────────────────────────────────────────────────────

/** 法定の割増率。賃金換算に使用する。 */
export const PREMIUM_RATES = {
  /** 所定内・法定内残業（所定超〜法定8h）: 割増義務なし */
  basic: 1.0,
  /** 法定外残業（法定8h超）: 1.25 */
  overtime: 1.25,
  /** 法定外残業のうち月60時間超の部分: 1.50（中小企業も2023/4〜適用） */
  overtimeOver60: 1.5,
  /** 所定休日労働（法定休日でない）: 時間外として扱う 1.25 */
  scheduledHoliday: 1.25,
  /** 法定休日労働: 1.35 */
  legalHoliday: 1.35,
  /** 深夜（22:00–05:00）: +0.25 加算（基本・残業・休日に上乗せ／排他ではない） */
  lateNightAdd: 0.25,
} as const;

/** 月60時間超で割増が1.50になる閾値（法定外残業の月内累計時間）。 */
export const OVERTIME_OVER60_THRESHOLD = 60;

/**
 * 5区分バケットを「賃金換算時間（割増込み）」へ変換する。
 * 時給 × この戻り値 = その職場の総支給額（時給制）。
 *
 * - 法定外残業（残業＋朝残業）は月内累計60hまで×1.25、超過分×1.50。
 *   ※ `buckets` は当月・職場単位の集計済み値である前提（60h判定は職場×月単位）。
 * - 法定休日 ×1.35 / 所定休日 ×1.25。法定休日労働は時間外60h累計には含めない。
 * - 深夜は加算（×0.25）。基本・残業・休日いずれの深夜帯にも上乗せされる
 *   （`lateNight` は全打刻の22:00–05:00重なりを別途集計しているため二重計上にならない）。
 */
export function bucketPaidHours(b: TimeBuckets): number {
  const legalOvertime = b.overtime + b.earlyOvertime; // 法定外残業（月内累計）
  const over60 = Math.max(0, legalOvertime - OVERTIME_OVER60_THRESHOLD);
  const upTo60 = legalOvertime - over60;
  return (
    b.basic * PREMIUM_RATES.basic +
    upTo60 * PREMIUM_RATES.overtime +
    over60 * PREMIUM_RATES.overtimeOver60 +
    b.scheduledHolidayWork * PREMIUM_RATES.scheduledHoliday +
    b.legalHolidayWork * PREMIUM_RATES.legalHoliday +
    b.lateNight * PREMIUM_RATES.lateNightAdd
  );
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

/** タイムカード行の既定職場キー（PayrollTab と共有）。 */
export const DEFAULT_WP_KEY = "w1";

/** 打刻エントリ1件をタイムカード行へ変換する。行IDは事業所単位で名前空間化する。 */
export function entryToRow(entry: TimecardEntry, defaultBreak: number, workplaceId: string): TimecardRow {
  return {
    ...entry,
    // 同一打刻データを複数事業所へ取り込んだ際のID衝突を防ぐため事業所IDで名前空間化。
    id: `${workplaceId}:${entry.id}`,
    editStart: "", editEnd: "",
    workplaceId,
    breakMinutes: defaultBreak,
    timeManuallyEdited: false,
    manualEdit: false,
    isDayConfirmed: false,
  };
}

/** シードのダミー打刻を職場ごとに分配（前半→第1職場 / 後半→第2職場）。両タブで共用。 */
export function seedTimecardRows(
  entries: TimecardEntry[],
  workplaces: Record<string, WorkplaceDef>,
): TimecardRow[] {
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

/**
 * 時給制総支給 = Σ（職場別時給 × 職場別「賃金換算時間（割増込み）」）。
 * 法定外残業1.25/月60h超1.50・法定休日1.35・所定休日1.25・深夜+0.25 を反映する。
 * 割増判定は `buckets` が当月・職場単位の集計済み値である前提（60h累計は職場×月）。
 */
export function computeHourlyGross(
  bucketsByWorkplace: Record<string, TimeBuckets>,
  rates: Record<string, string>,
): number {
  let sum = 0;
  for (const [id, buckets] of Object.entries(bucketsByWorkplace)) {
    sum += parseRate(rates[id]) * bucketPaidHours(buckets);
  }
  return Math.round(sum);
}

/**
 * 日給制総支給 = Σ（職場別日給 × 職場別出勤日数）。
 *
 * 【SPEC: 割増の適用範囲】法定外残業・深夜・休日の割増は **時給制のみ** 反映する
 * （`computeHourlyGross` / `bucketPaidHours`）。日給制・月給制では割増を加算しない。
 * 理由: 日給・月給から割増の単価（時間給換算）を一意に決められず、本モックの
 * スコープ外とするため。割増対応が必要になった場合は、所定労働時間からの
 * 時間給換算を別途定義すること。
 */
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
