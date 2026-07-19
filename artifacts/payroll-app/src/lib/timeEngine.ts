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
// 労働時間バケット（残業判定フローチャート準拠）
// ───────────────────────────────────────────────────────────
//
// 判定①: 法定休日か？ → YES: 法定休日労働 ×1.35（深夜帯は+0.25で実質1.60）
// 判定②: 1日8h超 または 週40h超か？（日次で既に8h超となった分は週40hカウントから除外）
//         → YES: 法定外残業。月60hカウンター（全職場横断・月累計）で
//                60h以内 ×1.25 / 60h超 ×1.50（深夜帯は+0.25）
// 判定③: 所定労働時間超（法定内残業）／所定内 → いずれも ×1.00（深夜帯は+0.25）
//
// 所定休日の労働は判定②のフローを通る（一律1.25の特別扱いはしない）。
// 朝残業も同様に「労働時間」として日8h・週40h判定に算入されるだけで、
// それ自体が自動的に割増になるわけではない。

export interface TimeBuckets {
  /** ×1.00: 所定内＋法定内残業（判定③）。所定休日の法定内労働も含む */
  basic: number;
  /** ×1.25: 法定外残業（日8h超 or 週40h超）のうち月累計60h以内 */
  overtime: number;
  /** ×1.50: 法定外残業のうち月累計60h超 */
  overtimeOver60: number;
  /** +0.25 加算: 22:00–05:00 の重なり（他区分に上乗せ） */
  lateNight: number;
  /** ×1.35: 法定休日労働 */
  legalHolidayWork: number;
  /** 参考値: 所定休日の実働時間。支給計算には使わない（basic/overtime に分類済み） */
  scheduledHolidayWork: number;
}

export const EMPTY_BUCKETS: TimeBuckets = {
  basic: 0, overtime: 0, overtimeOver60: 0, lateNight: 0,
  legalHolidayWork: 0, scheduledHolidayWork: 0,
};

export function addBuckets(a: TimeBuckets, b: TimeBuckets): TimeBuckets {
  return {
    basic: a.basic + b.basic,
    overtime: a.overtime + b.overtime,
    overtimeOver60: a.overtimeOver60 + b.overtimeOver60,
    lateNight: a.lateNight + b.lateNight,
    legalHolidayWork: a.legalHolidayWork + b.legalHolidayWork,
    scheduledHolidayWork: a.scheduledHolidayWork + b.scheduledHolidayWork,
  };
}

/** 5区分バケットから正味労働時間（休憩差引後の実働合計・割増なし）を算出。
 *  scheduledHolidayWork は参考値（basic/overtime に含まれる）ため加算しない。 */
export function bucketNetHours(b: TimeBuckets): number {
  return b.basic + b.overtime + b.overtimeOver60 + b.legalHolidayWork;
}

// ───────────────────────────────────────────────────────────
// 割増率（労働基準法）
// ───────────────────────────────────────────────────────────

/** 法定の割増率。賃金換算に使用する。 */
export const PREMIUM_RATES = {
  /** 所定内・法定内残業（判定③）: 割増義務なし ×1.00 */
  basic: 1.0,
  /** 法定外残業（日8h超 or 週40h超）: ×1.25 */
  overtime: 1.25,
  /** 法定外残業のうち月60時間超の部分: ×1.50（中小企業も2023/4〜適用） */
  overtimeOver60: 1.5,
  /** 法定休日労働: ×1.35 */
  legalHoliday: 1.35,
  /** 深夜（22:00–05:00）: +0.25 加算（基本・残業・休日に上乗せ／排他ではない） */
  lateNightAdd: 0.25,
} as const;

/** 月60時間超で割増が1.50になる閾値（法定外残業の全職場横断・月内累計、分）。 */
export const OVERTIME_OVER60_THRESHOLD_MIN = 60 * 60;
/** 法定労働時間: 1日8時間（分） */
export const DAILY_LEGAL_MIN = 8 * 60;
/** 法定労働時間: 週40時間（分） */
export const WEEKLY_LEGAL_MIN = 40 * 60;

/**
 * バケットを「賃金換算時間（割増込み）」へ変換する。
 * 時給 × この戻り値 = その職場の総支給額（時給制）。
 * 60h超の判定は computeBucketsByWorkplace が全職場横断の月累計カウンターで
 * 分類済みなので、ここでは単純に率を乗じるだけ。
 */
export function bucketPaidHours(b: TimeBuckets): number {
  return (
    b.basic * PREMIUM_RATES.basic +
    b.overtime * PREMIUM_RATES.overtime +
    b.overtimeOver60 * PREMIUM_RATES.overtimeOver60 +
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
  const { start, end } = resolveEffectiveTimes(row, wp);
  return calcHours(start, end) > 0;
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

/** 行の有効打刻（開始・終了）を解決する。集計・出勤判定で共用。 */
function resolveEffectiveTimes(row: TimecardRow, wp: WorkplaceDef): { start: string; end: string } {
  const needsInput = row.ocrStatus === "error" || row.ocrStatus === "manual";
  const editing = needsInput || row.manualEdit;
  const start = editing
    ? (row.editStart || "--:--")
    : wp.includeEarlyOvertime ? row.ocrStart : row.stdStart;
  const end = editing ? (row.editEnd || "--:--") : row.stdEnd;
  return { start, end };
}

/** 日曜起算の週キー（"YYYY-MM-DD" = その週の日曜日）。週40h判定に使用。 */
function weekKeyOf(date: Date): string {
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  return `${sunday.getFullYear()}-${sunday.getMonth() + 1}-${sunday.getDate()}`;
}

/** 分類処理の単位: 日跨ぎ勤務は深夜0時で分割済みのセグメント。 */
interface WorkSegment {
  workplaceId: string;
  wp: WorkplaceDef;
  /** 深夜割増の判定に使う実時刻（同一日内、日跨ぎなし） */
  startMin: number;
  endMin: number;
  /** 休憩差引後の実働(分)。休憩はセグメント長に比例配分する。 */
  workMin: number;
  date: Date;
}

/**
 * タイムカード行を時系列順の分類セグメントへ変換する。
 * - 日跨ぎ勤務（終業≦始業）は深夜0時で2セグメントに分割し、
 *   後半は翌日の日付・日8h/週40h/法定休日判定に帰属させる。
 * - 休憩(分)は各セグメントの長さに比例して差し引く。
 */
function prepareSegments(
  rows: TimecardRow[],
  workplaces: Record<string, WorkplaceDef>,
): WorkSegment[] {
  const segments: WorkSegment[] = [];
  for (const row of rows) {
    const wp = workplaces[row.workplaceId];
    if (!wp) continue;
    const { start, end } = resolveEffectiveTimes(row, wp);
    const s = toMin(start);
    let e = toMin(end);
    if (s < 0 || e < 0) continue;
    if (e <= s) e += 1440; // 日跨ぎ
    const grossMin = e - s;
    if (grossMin <= 0) continue;
    const netMin = Math.max(0, grossMin - row.breakMinutes);
    const date = getRowDate(row.year, row.date);

    const push = (segStart: number, segEnd: number, segDate: Date) => {
      const segGross = segEnd - segStart;
      if (segGross <= 0) return;
      segments.push({
        workplaceId: row.workplaceId,
        wp,
        startMin: segStart,
        endMin: segEnd,
        workMin: (netMin * segGross) / grossMin,
        date: segDate,
      });
    };

    if (e <= 1440) {
      push(s, e, date);
    } else {
      // 深夜0時で分割: 前半は当日、後半は翌日（時刻は0時起点に正規化）
      push(s, 1440, date);
      const nextDate = new Date(date);
      nextDate.setDate(date.getDate() + 1);
      push(0, e - 1440, nextDate);
    }
  }
  return segments.sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.startMin - b.startMin,
  );
}

/** セグメントの22:00–05:00重なり(分)。分割済みなので同一日内で判定できる。 */
function segLateNightMin(seg: WorkSegment): number {
  const overnight = Math.max(0, Math.min(seg.endMin, 1440) - Math.max(seg.startMin, 1320));
  const earlyMorning = Math.max(0, Math.min(seg.endMin, 300) - Math.max(seg.startMin, 0));
  return overnight + earlyMorning;
}

/**
 * 前月の打刻行から「週40hカウンターへの持ち越し(分)」を算出する。
 * 月初の週が前月から跨る場合、前月末の労働時間（日8h以内・法定休日除く）を
 * 週キー別に集計して computeBucketsByWorkplace の carryIn に渡す。
 */
export function computeWeekCarryIn(
  prevRows: TimecardRow[],
  workplaces: Record<string, WorkplaceDef>,
): Record<string, number> {
  const dayWithinMin: Record<string, number> = {};
  const weekWithinMin: Record<string, number> = {};
  for (const seg of prepareSegments(prevRows, workplaces)) {
    if (detectHoliday(seg.date, seg.wp) === "legal_holiday") continue;
    const dayKey = `${seg.date.getFullYear()}-${seg.date.getMonth() + 1}-${seg.date.getDate()}`;
    const dayUsed = dayWithinMin[dayKey] ?? 0;
    const dailyWithin = Math.min(seg.workMin, Math.max(0, DAILY_LEGAL_MIN - dayUsed));
    dayWithinMin[dayKey] = dayUsed + dailyWithin;
    const wk = weekKeyOf(seg.date);
    weekWithinMin[wk] = (weekWithinMin[wk] ?? 0) + dailyWithin;
  }
  return weekWithinMin;
}

/**
 * 職場別バケット集計（残業判定フローチャート準拠）。
 *
 * 全職場のセグメント（日跨ぎは0時分割済み）を日付順に処理し、
 * 以下のカウンターを **全職場横断** で共有する:
 * - 日8hカウンター（同日複数職場勤務は通算して8h超を判定）
 * - 週40hカウンター（日曜起算。日次で既に8h超となった分と法定休日労働は除外。
 *   `weekCarryInMin` で前月末からの持ち越しを注入できる）
 * - 月60hカウンター（法定外残業の月内累計。60h超は×1.50）
 *
 * 分類結果（basic/overtime/overtimeOver60/legalHolidayWork）はその時間が発生した
 * 職場のバケットに帰属させ、職場別時給 × bucketPaidHours で総支給を出す。
 */
export function computeBucketsByWorkplace(
  rows: TimecardRow[],
  workplaces: Record<string, WorkplaceDef>,
  weekCarryInMin: Record<string, number> = {},
): Record<string, TimeBuckets> {
  const map: Record<string, TimeBuckets> = {};
  for (const id of Object.keys(workplaces)) map[id] = { ...EMPTY_BUCKETS };

  const dayWithinMin: Record<string, number> = {};  // 日付 → 当日8h以内に収まった分（全職場通算）
  const weekWithinMin: Record<string, number> = { ...weekCarryInMin }; // 週キー → 週40hカウント対象分
  let monthOvertimeMin = 0;                          // 法定外残業の月内累計（全職場通算）

  for (const seg of prepareSegments(rows, workplaces)) {
    const buckets = map[seg.workplaceId] ?? (map[seg.workplaceId] = { ...EMPTY_BUCKETS });
    const holiday = detectHoliday(seg.date, seg.wp);
    const workMin = seg.workMin;

    // 深夜（22:00–05:00）は区分に関係なく加算
    if (seg.wp.applyLateNightPremium !== false) {
      buckets.lateNight += segLateNightMin(seg) / 60;
    }

    // 判定①: 法定休日 → ×1.35。週40h・月60hカウントには含めない。
    if (holiday === "legal_holiday") {
      buckets.legalHolidayWork += workMin / 60;
      continue;
    }
    if (holiday === "scheduled_holiday") {
      buckets.scheduledHolidayWork += workMin / 60; // 参考値（分類は下の判定②へ）
    }

    // 判定②: 日8h超（同日通算）
    const dayKey = `${seg.date.getFullYear()}-${seg.date.getMonth() + 1}-${seg.date.getDate()}`;
    const dayUsed = dayWithinMin[dayKey] ?? 0;
    const dailyWithin = Math.min(workMin, Math.max(0, DAILY_LEGAL_MIN - dayUsed));
    const dailyOver = workMin - dailyWithin;
    dayWithinMin[dayKey] = dayUsed + dailyWithin;

    // 判定②: 週40h超（日次8h超分は除外してカウント）
    const wk = weekKeyOf(seg.date);
    const weekUsed = weekWithinMin[wk] ?? 0;
    const weeklyOver = Math.min(
      dailyWithin,
      Math.max(0, weekUsed + dailyWithin - WEEKLY_LEGAL_MIN),
    );
    weekWithinMin[wk] = weekUsed + dailyWithin;

    const overtimeMin = dailyOver + weeklyOver;   // 法定外残業
    const basicMin = workMin - overtimeMin;       // 判定③: 所定内・法定内残業 ×1.00

    // 月60hカウンター（全職場横断）で 1.25 / 1.50 に振り分け
    const over60 = Math.min(
      overtimeMin,
      Math.max(0, monthOvertimeMin + overtimeMin - OVERTIME_OVER60_THRESHOLD_MIN),
    );
    monthOvertimeMin += overtimeMin;

    buckets.basic += basicMin / 60;
    buckets.overtime += (overtimeMin - over60) / 60;
    buckets.overtimeOver60 += over60 / 60;
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
 * 法定外残業1.25/月60h超1.50・法定休日1.35・深夜+0.25 を反映する
 * （分類は computeBucketsByWorkplace のフローチャート判定に従う）。
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
