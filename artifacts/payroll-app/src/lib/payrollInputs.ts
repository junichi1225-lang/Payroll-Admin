// 給与確定タブ向けの計算アダプタ。
//
// PayrollTab（所得税シミュレーター）が localStorage に永続化した入力
// （給与形態 / 月給 / 職場別時給・日給 / 打刻 / 手当）をそのまま読み出し、
// timeEngine と payroll-core の純粋関数で総支給・控除を再計算する。
// これによりシミュレーターと給与確定タブの数値が常に一致する。

import {
  DEFAULT_TENANT_ID,
  DEFAULT_HOURLY_RATES,
  DEFAULT_DAILY_RATES,
  EmployeeMaster,
  SalaryType,
  AllowanceItem,
  WorkplaceDef,
  TimecardEntry,
  getTimecardEntries,
  normalizeAllowance,
} from "./dummy-data";
import {
  TimecardRow,
  DEFAULT_WP_KEY,
  seedTimecardRows,
  computeBucketsByWorkplace,
  computeHoursByWorkplace,
  countDaysByWorkplace,
  totalNetHours,
  computeHourlyGross,
  computeDailyGross,
} from "./timeEngine";
import { computePayroll, DeductionBreakdown } from "./payroll-core";

type PayType = "monthly" | "daily" | "hourly";

/** localStorage から JSON を読む。無効・未設定ならフォールバックを返す。 */
function readJson<T>(key: string, fallback: () => T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* fall through */
  }
  return fallback();
}

/** PayrollTab と同一の永続化キーを生成する。 */
function keys(employeeId: string, year: number, month: number) {
  const suffix = `${DEFAULT_TENANT_ID}_${employeeId}_${year}_${month}`;
  return {
    timecard: `timecard_${suffix}`,
    hourlyRates: `hourlyRates_${suffix}`,
    dailyRates: `dailyRates_${suffix}`,
    allowances: `allowances_${suffix}`,
    payType: `payType_${suffix}`,
    monthlySalary: `monthlySalary_${suffix}`,
  };
}

export interface MonthComputation {
  /** 給与形態（確定スナップショット用ラベル） */
  appliedSalaryType: SalaryType;
  /** 適用単価（月給=月給額 / 日給=主たる事業所の日給 / 時給=加重平均時給） */
  appliedBaseSalary: number;
  /** 全職場合計の正味労働時間（時給制のみ。月給/日給は0） */
  totalWorkingHours: number;
  /** 総支給額 */
  totalPayment: number;
  /** 控除合計 */
  totalDeduction: number;
  /** 差引支給額 */
  netPay: number;
  /** 控除内訳（両タブ共有） */
  deductions: DeductionBreakdown;
  /** 当月の手当（給与明細の支給項目内訳用） */
  allowances: AllowanceItem[];
  /** 社会保険料率の引き当てに使用した都道府県 */
  prefecture: string;
}

/**
 * 従業員・対象月の入力を localStorage から読み出し、総支給と控除を再計算する。
 * PayrollTab と同一の timeEngine / computePayroll を用いるため数値が一致する。
 */
export function loadEmployeeMonthComputation(
  employeeId: string,
  year: number,
  month: number,
  workplaces: Record<string, WorkplaceDef>,
  employee: EmployeeMaster | undefined,
): MonthComputation {
  const k = keys(employeeId, year, month);

  // ── 入力の読み出し（PayrollTab の初期値ロジックと一致させる） ──
  const payType = readJson<PayType>(k.payType, () => "monthly");
  const monthlySalaryInput = readJson<string>(k.monthlySalary, () => "");

  const workplaceRates = readJson<Record<string, string>>(k.hourlyRates, () => {
    const init: Record<string, string> = {};
    for (const id of Object.keys(workplaces)) {
      const def = DEFAULT_HOURLY_RATES[id];
      init[id] = def ? String(def) : "";
    }
    return init;
  });

  const workplaceDailyRates = readJson<Record<string, string>>(k.dailyRates, () => {
    const init: Record<string, string> = {};
    for (const id of Object.keys(workplaces)) {
      const def = DEFAULT_DAILY_RATES[id];
      init[id] = def ? String(def) : "";
    }
    return init;
  });

  const timecardRows = readJson<TimecardRow[]>(k.timecard, () => {
    const entries: TimecardEntry[] = getTimecardEntries(employeeId, year, month);
    return seedTimecardRows(entries, workplaces);
  });

  const allowances = readJson<AllowanceItem[]>(k.allowances, () => []).map((a) =>
    normalizeAllowance(a),
  );

  // ── 総支給の算出（PayrollTab と同一の純粋関数を使用） ──
  const bucketsByWorkplace = computeBucketsByWorkplace(timecardRows, workplaces);
  const hoursByWorkplace = computeHoursByWorkplace(bucketsByWorkplace);
  const daysByWorkplace = countDaysByWorkplace(timecardRows, workplaces);
  const totalHours = totalNetHours(hoursByWorkplace);
  const hourlyGross = computeHourlyGross(bucketsByWorkplace, workplaceRates);
  const dailyGross = computeDailyGross(daysByWorkplace, workplaceDailyRates);

  const allowancesTotal = allowances.reduce((s, a) => s + (a.amount || 0), 0);
  const nonTaxableAllowanceTotal = allowances.reduce(
    (s, a) => s + (a.taxable ? 0 : a.amount || 0),
    0,
  );

  const monthlyRaw = parseInt(monthlySalaryInput.replace(/[^0-9]/g, ""), 10) || 0;
  const effectiveHourlyRate = totalHours > 0 ? Math.round(hourlyGross / totalHours) : 0;
  const primaryDailyId = workplaces[DEFAULT_WP_KEY] ? DEFAULT_WP_KEY : Object.keys(workplaces)[0];
  const primaryDailyRate =
    parseInt((workplaceDailyRates[primaryDailyId] ?? "").replace(/[^0-9]/g, ""), 10) || 0;

  const grossAmount =
    payType === "monthly"
      ? monthlyRaw + allowancesTotal
      : payType === "daily"
        ? dailyGross + allowancesTotal
        : hourlyGross + allowancesTotal;

  // ── 料率引き当て都道府県（PayrollTab と同一: 実働最長の事業所→既定→先頭） ──
  let topId: string | null = null;
  let topHours = 0;
  for (const [id, h] of Object.entries(hoursByWorkplace)) {
    if (h > topHours) {
      topHours = h;
      topId = id;
    }
  }
  const primaryWp =
    (topId ? workplaces[topId] : undefined) ??
    workplaces[DEFAULT_WP_KEY] ??
    Object.values(workplaces)[0];
  const primaryPrefecture = primaryWp?.prefecture ?? "東京都";

  const yyyymm = `${year}-${String(month).padStart(2, "0")}`;
  const computation = computePayroll({
    targetYearMonth: yyyymm,
    prefecture: primaryPrefecture,
    gross: grossAmount,
    nonTaxableAllowanceTotal,
    employee: employee
      ? {
          isSocialInsurance: employee.isSocialInsurance,
          standardRemuneration: employee.standardRemuneration,
          birthDate: employee.birthDate,
          residentTax: employee.residentTax,
        }
      : undefined,
  });

  const appliedSalaryType: SalaryType =
    payType === "monthly" ? "月給" : payType === "daily" ? "日給" : "時給";
  const appliedBaseSalary =
    payType === "monthly" ? monthlyRaw : payType === "daily" ? primaryDailyRate : effectiveHourlyRate;

  return {
    appliedSalaryType,
    appliedBaseSalary,
    totalWorkingHours: payType === "hourly" ? Math.round(totalHours * 100) / 100 : 0,
    totalPayment: grossAmount,
    totalDeduction: computation.deductions.total,
    netPay: computation.netPay,
    deductions: computation.deductions,
    allowances,
    prefecture: primaryPrefecture,
  };
}
