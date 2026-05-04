/**
 * 社会保険料 計算ユーティリティ
 *
 * 介護保険第2号被保険者（40歳以上65歳未満）の判定を含む。
 *
 * 【法的根拠】
 * - 年齢計算ニ関スル法律（明治35年法律第50号）：
 *   満年齢に達するのは「誕生日の前日」とする。
 * - 介護保険法第9条第2号：40歳以上65歳未満の医療保険加入者は
 *   第2号被保険者となり、介護保険料が健康保険料に上乗せされる。
 * - 健康保険組合の実務上、「40歳に達した日（＝誕生日前日）の
 *   属する月」から介護保険料の徴収が開始される。
 */

// ───────────────────────────────────────────────────────────
// 料率（2024年度・協会けんぽ全国平均ベースのサンプル値）
// 実運用では都道府県別・年度別に料率テーブルを差し替える。
// ───────────────────────────────────────────────────────────

/** 健康保険料率（労使合計） */
export const HEALTH_INSURANCE_RATE = 0.1000; // 10.00%

/** 介護保険料率（労使合計／第2号被保険者のみ上乗せ） */
export const NURSING_CARE_INSURANCE_RATE = 0.0160; // 1.60%

/** 労働者負担割合（労使折半） */
const EMPLOYEE_SHARE = 0.5;

// ───────────────────────────────────────────────────────────
// 判定ユーティリティ
// ───────────────────────────────────────────────────────────

/**
 * 「YYYY-MM-DD」または「YYYY/MM/DD」の文字列を {y, m, d} に分解する。
 * 不正値は null を返す。
 */
function parseYMD(s: string): { y: number; m: number; d: number } | null {
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  // 実在日チェック（例: 2026-02-30 を弾く）
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

/**
 * 「YYYY-MM」または「YYYY/MM」の文字列を {y, m} に分解する。
 */
function parseYM(s: string): { y: number; m: number } | null {
  const m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y: Number(m[1]), m: mo };
}

/**
 * 満40歳到達日（年齢計算ニ関スル法律に基づく＝40歳の誕生日の前日）
 * を Date で返す。
 *
 * @example
 * getNursingCareEligibilityDate("1986-05-02")
 *   // → 2026-05-01 (40歳誕生日 2026-05-02 の前日)
 *
 * getNursingCareEligibilityDate("1986-12-01")
 *   // → 2026-11-30 (40歳誕生日 2026-12-01 の前日)
 */
export function getNursingCareEligibilityDate(birthDate: string): Date | null {
  const b = parseYMD(birthDate);
  if (!b) return null;
  // 「40歳の誕生日」をローカル日付で構築
  const fortiethBirthday = new Date(b.y + 40, b.m - 1, b.d);
  // その「前日」が満40歳到達日
  const eligibility = new Date(fortiethBirthday);
  eligibility.setDate(eligibility.getDate() - 1);
  return eligibility;
}

/**
 * 介護保険第2号被保険者として、対象年月において保険料徴収対象か判定する。
 *
 * 【ルール】
 * - 満40歳に達する日（＝40歳の誕生日の前日）の属する月から徴収対象。
 * - 満65歳に達する日（＝65歳の誕生日の前日）の属する月から対象外（第1号へ移行）。
 *
 * @param birthDate       生年月日 "YYYY-MM-DD"
 * @param targetYearMonth 対象年月 "YYYY-MM"
 * @returns その月に介護保険料の徴収対象なら true
 *
 * @example
 * isNursingCareInsuranceTarget("1986-05-02", "2026-05") // => true
 *   // 到達日 2026-05-01 が 2026-05 に属する
 *
 * isNursingCareInsuranceTarget("1986-12-01", "2026-11") // => true
 *   // 到達日 2026-11-30（前月へズレ）が 2026-11 に属する
 *
 * isNursingCareInsuranceTarget("1986-05-02", "2026-04") // => false
 *   // 到達日が翌月にあるためまだ対象外
 */
export function isNursingCareInsuranceTarget(
  birthDate: string,
  targetYearMonth: string,
): boolean {
  const target = parseYM(targetYearMonth);
  if (!target) return false;

  const eligibility = getNursingCareEligibilityDate(birthDate);
  if (!eligibility) return false;

  // 対象年月の「月初」と「翌月初」を計算（ローカル）
  const targetStart = new Date(target.y, target.m - 1, 1);
  const targetEnd = new Date(target.y, target.m, 1); // 翌月1日

  // 到達日が「対象月の開始以降」なら徴収開始済みかは「対象月以前に到達」
  // ＝ 到達日 < 翌月1日 で「対象月の月末まで（含む）」に到達している
  const reached = eligibility.getTime() < targetEnd.getTime();
  if (!reached) return false;

  // 65歳到達月以降は第2号被保険者から外れる
  const b = parseYMD(birthDate);
  if (!b) return false;
  const sixtyFifth = new Date(b.y + 65, b.m - 1, b.d);
  const exitDate = new Date(sixtyFifth);
  exitDate.setDate(exitDate.getDate() - 1);
  // exitDate の属する月の「月初」以降は対象外
  const exitMonthStart = new Date(
    exitDate.getFullYear(),
    exitDate.getMonth(),
    1,
  );
  if (targetStart.getTime() >= exitMonthStart.getTime()) return false;

  return true;
}

// ───────────────────────────────────────────────────────────
// 健康保険料 計算（介護保険上乗せ対応）
// ───────────────────────────────────────────────────────────

export interface HealthInsuranceInput {
  /** 標準報酬月額（円） */
  standardRemuneration: number;
  /** 社会保険加入フラグ（従業員マスタ isSocialInsurance） */
  isSocialInsurance: boolean;
  /** 生年月日 "YYYY-MM-DD" */
  birthDate: string;
  /** 対象年月 "YYYY-MM" */
  targetYearMonth: string;
}

export interface HealthInsuranceResult {
  /** 介護保険第2号被保険者該当か */
  isNursingCareTarget: boolean;
  /** 適用料率（労使合計） */
  appliedRate: number;
  /** 労使合計の保険料（円） */
  totalPremium: number;
  /** 従業員負担額（円・労使折半） */
  employeePremium: number;
}

/**
 * 健康保険料（介護保険第2号該当時は上乗せ）を計算する。
 *
 * isSocialInsurance が false の場合は全 0 を返す。
 *
 * @example
 * calculateHealthInsurance({
 *   standardRemuneration: 300_000,
 *   isSocialInsurance: true,
 *   birthDate: "1986-05-02",
 *   targetYearMonth: "2026-05",
 * })
 * // => { isNursingCareTarget: true, appliedRate: 0.116,
 * //      totalPremium: 34_800, employeePremium: 17_400 }
 */
export function calculateHealthInsurance(
  input: HealthInsuranceInput,
): HealthInsuranceResult {
  if (!input.isSocialInsurance || input.standardRemuneration <= 0) {
    return {
      isNursingCareTarget: false,
      appliedRate: 0,
      totalPremium: 0,
      employeePremium: 0,
    };
  }

  const isNursingCareTarget = isNursingCareInsuranceTarget(
    input.birthDate,
    input.targetYearMonth,
  );

  const appliedRate =
    HEALTH_INSURANCE_RATE +
    (isNursingCareTarget ? NURSING_CARE_INSURANCE_RATE : 0);

  const totalPremium = Math.floor(input.standardRemuneration * appliedRate);
  const employeePremium = Math.floor(totalPremium * EMPLOYEE_SHARE);

  return {
    isNursingCareTarget,
    appliedRate,
    totalPremium,
    employeePremium,
  };
}
