/**
 * 法定保険料率マスタ（モックアップ用ダミーデータ）
 *
 * 【目的】
 * - すべての法定料率を「適用開始日付き」の単一マスタに集約する。
 *   - 都道府県別: 健康保険・介護保険・厚生年金
 *   - 全国一律: 雇用保険（労使別）・子ども子育て支援金
 * - `resolveRates(prefecture, targetYearMonth)` が当該年月に有効な
 *   全料率を1つの束（ResolvedRates）で返す。計算コアはこの束のみ参照する。
 *
 * 【数値の出典（ユーザー確認済みの確定料率）】
 * - 健康保険料率（労使合計）: 全国健康保険協会（協会けんぽ）令和7/令和8 都道府県別。
 *   適用開始: 令和7 = 2025-03-01 / 令和8 = 2026-03-01。
 * - 介護保険料率（労使合計・全国一律）: 令和7 = 1.59% / 令和8 = 1.62%。
 * - 厚生年金保険料率（労使合計・全国一律）: 18.30%（両年度固定）。
 * - 子ども子育て支援金率（労使合計・令和8新設）: 0.23%（本人0.115%）。
 *   適用開始 = 令和8年4月分（2026-04-01）。令和7はなし。
 * - 雇用保険（労働者負担）: 令和7 = 0.55% / 令和8 = 0.50%（年度=4月始まり）。
 *
 * 労使折半（×0.5）は計算ロジック側で行い、本マスタは原則「合計料率」を保持する。
 * 雇用保険のみ「労働者負担そのものの率（折半済み）」を保持する点に注意。
 */

import { PREFECTURE_OPTIONS } from "@/lib/dummy-data";

// ───────────────────────────────────────────────────────────
// 型定義
// ───────────────────────────────────────────────────────────

/**
 * 都道府県別 1件の料率レコード（適用開始日付き）。
 */
export interface InsuranceRate {
  /** 都道府県名（PREFECTURE_OPTIONS と一致） */
  prefecture: string;
  /** 適用開始日 "YYYY-MM-DD"（この日付を含む月以降に適用） */
  effectiveFrom: string;
  /** 健康保険料率（労使合計）— 例: 0.0985 = 9.85% */
  healthInsuranceRate: number;
  /** 介護保険料率（労使合計／第2号被保険者のみ上乗せ）— 例: 0.0162 = 1.62% */
  nursingCareInsuranceRate: number;
  /** 厚生年金保険料率（労使合計）— 例: 0.1830 = 18.30% */
  pensionInsuranceRate: number;
}

/** 全国一律・雇用保険料率レコード（適用開始日付き） */
export interface EmploymentInsuranceRate {
  effectiveFrom: string;
  /** 労働者負担率（折半済み・総支給額ベース）— 例: 0.0050 = 0.50% */
  employeeRate: number;
  /** 事業主負担率（参考）— 例: 0.0085 = 0.85% */
  employerRate: number;
}

/** 全国一律・子ども子育て支援金率レコード（適用開始日付き） */
export interface ChildcareSupportRate {
  effectiveFrom: string;
  /** 労使合計率（標準報酬月額ベース）— 例: 0.0023 = 0.23% */
  totalRate: number;
}

/**
 * 指定年月に適用される全料率の束。`resolveRates` の戻り値。
 * 健康・介護・厚年・支援金は「労使合計」率（計算側で×0.5）。
 * 雇用保険は「労働者負担そのもの」の率（折半不要）。
 */
export interface ResolvedRates {
  prefecture: string;
  targetYearMonth: string;
  /** 健康保険料率（労使合計・標準報酬ベース） */
  healthInsuranceRate: number;
  /** 介護保険料率（労使合計・標準報酬ベース・第2号のみ） */
  nursingCareInsuranceRate: number;
  /** 厚生年金保険料率（労使合計・標準報酬ベース） */
  pensionInsuranceRate: number;
  /** 子ども子育て支援金率（労使合計・標準報酬ベース）。未適用月は 0。 */
  childcareSupportRate: number;
  /** 雇用保険・労働者負担率（折半済み・総支給ベース） */
  employmentInsuranceEmployeeRate: number;
  /** 各料率の適用開始日（マスタ未収載は null） */
  healthEffectiveFrom: string | null;
  employmentEffectiveFrom: string | null;
  childcareSupportEffectiveFrom: string | null;
}

// ───────────────────────────────────────────────────────────
// 都道府県別マスタ（健康・介護・厚年）
// ───────────────────────────────────────────────────────────

/** 厚生年金保険料率（全国一律・平成29年9月以降固定） */
const PENSION_RATE = 0.1830;

/** 介護保険料率（労使合計・全国一律） */
const NURSING_CARE_RATE_2024 = 0.0160;
const NURSING_CARE_RATE_R7 = 0.0159; // 令和7年度
const NURSING_CARE_RATE_R8 = 0.0162; // 令和8年度

const EFFECTIVE_2024 = "2024-04-01";
const EFFECTIVE_R7 = "2025-03-01"; // 令和7年度（3月分〜）
const EFFECTIVE_R8 = "2026-03-01"; // 令和8年度（3月分〜）

/** 令和7年度 健康保険料率（労使合計） */
const HEALTH_R7: Record<string, number> = {
  北海道: 0.1031, 埼玉県: 0.0976, 千葉県: 0.0979, 東京都: 0.0991, 神奈川県: 0.0992,
  愛知県: 0.1003, 京都府: 0.1003, 大阪府: 0.1024, 兵庫県: 0.1016, 福岡県: 0.1031,
};

/** 令和8年度 健康保険料率（労使合計） */
const HEALTH_R8: Record<string, number> = {
  北海道: 0.1028, 埼玉県: 0.0967, 千葉県: 0.0973, 東京都: 0.0985, 神奈川県: 0.0992,
  愛知県: 0.0991, 京都府: 0.1011, 大阪府: 0.1013, 兵庫県: 0.1012, 福岡県: 0.1011,
};

/** 令和6年度（履歴として残す）健康保険料率（労使合計） */
const HEALTH_2024: Record<string, number> = {
  東京都: 0.0998, 神奈川県: 0.1002, 埼玉県: 0.0978, 千葉県: 0.0977, 大阪府: 0.1034,
  愛知県: 0.1002, 京都府: 0.1013, 兵庫県: 0.1018, 福岡県: 0.1035, 北海道: 0.1021,
};

function buildPrefectureRecords(): InsuranceRate[] {
  const rows: InsuranceRate[] = [];
  for (const [prefecture, healthInsuranceRate] of Object.entries(HEALTH_2024)) {
    rows.push({ prefecture, effectiveFrom: EFFECTIVE_2024, healthInsuranceRate, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE });
  }
  for (const [prefecture, healthInsuranceRate] of Object.entries(HEALTH_R7)) {
    rows.push({ prefecture, effectiveFrom: EFFECTIVE_R7, healthInsuranceRate, nursingCareInsuranceRate: NURSING_CARE_RATE_R7, pensionInsuranceRate: PENSION_RATE });
  }
  for (const [prefecture, healthInsuranceRate] of Object.entries(HEALTH_R8)) {
    rows.push({ prefecture, effectiveFrom: EFFECTIVE_R8, healthInsuranceRate, nursingCareInsuranceRate: NURSING_CARE_RATE_R8, pensionInsuranceRate: PENSION_RATE });
  }
  return rows;
}

/**
 * 都道府県 × 適用開始日 のマスタテーブル。
 * effectiveFrom が異なる行を追加するだけで履歴管理に対応できる。
 */
export const INSURANCE_RATES: InsuranceRate[] = buildPrefectureRecords();

// ───────────────────────────────────────────────────────────
// 全国一律マスタ（雇用保険・子ども子育て支援金）
// ───────────────────────────────────────────────────────────

/** 雇用保険料率（全国一律・年度=4月始まり） */
export const EMPLOYMENT_INSURANCE_RATES: EmploymentInsuranceRate[] = [
  { effectiveFrom: "2025-04-01", employeeRate: 0.0055, employerRate: 0.0090 }, // 令和7年度
  { effectiveFrom: "2026-04-01", employeeRate: 0.0050, employerRate: 0.0085 }, // 令和8年度
];

/** 子ども子育て支援金率（令和8新設・2026-04分〜）。令和7以前はレコードなし=0。 */
export const CHILDCARE_SUPPORT_RATES: ChildcareSupportRate[] = [
  { effectiveFrom: "2026-04-01", totalRate: 0.0023 }, // 全体0.23%（本人0.115%）
];

/**
 * フォールバック用の全国平均的な料率（マスタに無い都道府県を引いた場合）。
 */
export const FALLBACK_INSURANCE_RATE: Omit<InsuranceRate, "prefecture" | "effectiveFrom"> = {
  healthInsuranceRate: 0.1000,
  nursingCareInsuranceRate: NURSING_CARE_RATE_R8,
  pensionInsuranceRate: PENSION_RATE,
};

// ───────────────────────────────────────────────────────────
// ルックアップヘルパー
// ───────────────────────────────────────────────────────────

/** "YYYY-MM" / "YYYY/MM" を正規化した "YYYY-MM" にする。不正なら null。 */
function normalizeYM(targetYearMonth: string): string | null {
  const m = targetYearMonth.match(/^(\d{4})[-/](\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${String(month).padStart(2, "0")}`;
}

/** effectiveFrom <= 対象年月 の中で最も新しいレコードを返す汎用関数。 */
function pickEffective<T extends { effectiveFrom: string }>(
  records: T[],
  targetYM: string,
): T | null {
  const candidates = records
    .filter((r) => r.effectiveFrom.slice(0, 7).replace("/", "-") <= targetYM)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates[0] ?? null;
}

/**
 * 指定都道府県・対象年月に適用される都道府県別料率レコードを返す。該当なしは null。
 */
export function findInsuranceRate(
  prefecture: string,
  targetYearMonth: string,
): InsuranceRate | null {
  const targetYM = normalizeYM(targetYearMonth);
  if (!targetYM) return null;
  return pickEffective(
    INSURANCE_RATES.filter((r) => r.prefecture === prefecture),
    targetYM,
  );
}

/**
 * 指定都道府県・対象年月の都道府県別料率を返す。マスタに無ければ全国平均フォールバック。
 */
export function getInsuranceRateOrFallback(
  prefecture: string,
  targetYearMonth: string,
): Omit<InsuranceRate, "prefecture" | "effectiveFrom"> & { prefecture: string; effectiveFrom: string | null } {
  const found = findInsuranceRate(prefecture, targetYearMonth);
  if (found) return found;
  return { prefecture, effectiveFrom: null, ...FALLBACK_INSURANCE_RATE };
}

/**
 * 指定都道府県・対象年月に有効な全料率を1つの束で返す（計算コアの単一参照点）。
 *
 * - 健康・介護・厚年: 都道府県別マスタ（無ければフォールバック）。
 * - 雇用保険: 全国一律マスタの労働者負担率。
 * - 子ども子育て支援金: 全国一律マスタ（適用前月は 0）。
 *
 * @example
 * resolveRates("東京都", "2026-04")
 * // => { healthInsuranceRate: 0.0985, nursingCareInsuranceRate: 0.0162,
 * //      pensionInsuranceRate: 0.1830, childcareSupportRate: 0.0023,
 * //      employmentInsuranceEmployeeRate: 0.0050, ... }
 */
export function resolveRates(
  prefecture: string,
  targetYearMonth: string,
): ResolvedRates {
  const targetYM = normalizeYM(targetYearMonth) ?? targetYearMonth;
  const pref = findInsuranceRate(prefecture, targetYearMonth);
  const employment = pickEffective(EMPLOYMENT_INSURANCE_RATES, targetYM);
  const childcare = pickEffective(CHILDCARE_SUPPORT_RATES, targetYM);

  return {
    prefecture,
    targetYearMonth: targetYM,
    healthInsuranceRate: pref?.healthInsuranceRate ?? FALLBACK_INSURANCE_RATE.healthInsuranceRate,
    nursingCareInsuranceRate: pref?.nursingCareInsuranceRate ?? FALLBACK_INSURANCE_RATE.nursingCareInsuranceRate,
    pensionInsuranceRate: pref?.pensionInsuranceRate ?? FALLBACK_INSURANCE_RATE.pensionInsuranceRate,
    childcareSupportRate: childcare?.totalRate ?? 0,
    employmentInsuranceEmployeeRate: employment?.employeeRate ?? 0,
    healthEffectiveFrom: pref?.effectiveFrom ?? null,
    employmentEffectiveFrom: employment?.effectiveFrom ?? null,
    childcareSupportEffectiveFrom: childcare?.effectiveFrom ?? null,
  };
}

// ───────────────────────────────────────────────────────────
// 開発時の整合性チェック
// ───────────────────────────────────────────────────────────

if (import.meta.env?.DEV) {
  const known = new Set<string>(PREFECTURE_OPTIONS);
  for (const r of INSURANCE_RATES) {
    if (!known.has(r.prefecture)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[rates.ts] "${r.prefecture}" is not listed in PREFECTURE_OPTIONS. ` +
        `This row will never be matched from the workplace UI.`,
      );
    }
  }
}
