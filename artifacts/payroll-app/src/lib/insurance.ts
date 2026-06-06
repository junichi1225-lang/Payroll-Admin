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

// 料率は constants/rates.ts の resolveRates() を単一ソースとして参照する
// （都道府県別・年度別の実効日付テーブル）。このモジュールは介護保険
// 第2号被保険者の「徴収対象期間」判定（年齢計算）のみを担う。

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
