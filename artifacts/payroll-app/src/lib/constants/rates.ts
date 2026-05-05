/**
 * 法定保険料率マスタ（モックアップ用ダミーデータ）
 *
 * 【目的】
 * - 都道府県別・適用開始日別の社会保険料率テーブルを単一ソースで管理する。
 * - 将来的な DB 化（rates テーブル + effective_from による履歴管理）を見据え、
 *   配列＋ effectiveFrom フィールドの形で履歴を持てる構造にしている。
 *
 * 【数値の出典】
 * - 健康保険料率（労使合計）: 全国健康保険協会（協会けんぽ）2024年度 都道府県別料率を参考。
 * - 介護保険料率（労使合計）: 全国一律。
 * - 厚生年金保険料率（労使合計）: 全国一律 18.30%（平成29年9月以降固定）。
 *
 * 実運用ではAPI/DBから当該年月の料率を取得して差し替える前提。
 * 労使折半（×0.5）は計算ロジック側で行い、本マスタは「合計料率」を保持する。
 */

import { PREFECTURE_OPTIONS } from "@/lib/dummy-data";

// ───────────────────────────────────────────────────────────
// 型定義
// ───────────────────────────────────────────────────────────

/**
 * 1件の料率レコード（適用開始日付き）。
 * DB 化時はそのまま rates テーブルの 1 行に対応する想定。
 */
export interface InsuranceRate {
  /** 都道府県名（PREFECTURE_OPTIONS と一致） */
  prefecture: string;
  /** 適用開始日 "YYYY-MM-DD"（この日付を含む月以降に適用） */
  effectiveFrom: string;
  /** 健康保険料率（労使合計）— 例: 0.0998 = 9.98% */
  healthInsuranceRate: number;
  /** 介護保険料率（労使合計／第2号被保険者のみ上乗せ）— 例: 0.0160 = 1.60% */
  nursingCareInsuranceRate: number;
  /** 厚生年金保険料率（労使合計）— 例: 0.1830 = 18.30% */
  pensionInsuranceRate: number;
}

// ───────────────────────────────────────────────────────────
// マスタデータ（2024年度・協会けんぽ参考値）
// ───────────────────────────────────────────────────────────

/** 介護保険料率（全国一律） */
const NURSING_CARE_RATE_2024 = 0.0160;

/** 厚生年金保険料率（全国一律・平成29年9月以降固定） */
const PENSION_RATE_2024 = 0.1830;

/**
 * 都道府県 × 適用開始日 のマスタテーブル。
 * 将来 effectiveFrom が異なる行を追加するだけで履歴管理に対応できる。
 */
export const INSURANCE_RATES: InsuranceRate[] = [
  // ─── 2024年度（2024-04-01〜） ─────────────────────────
  { prefecture: "東京都",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.0998, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "神奈川県", effectiveFrom: "2024-04-01", healthInsuranceRate: 0.1002, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "埼玉県",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.0978, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "千葉県",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.0977, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "大阪府",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.1034, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "愛知県",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.1002, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "京都府",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.1013, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "兵庫県",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.1018, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "福岡県",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.1035, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
  { prefecture: "北海道",   effectiveFrom: "2024-04-01", healthInsuranceRate: 0.1021, nursingCareInsuranceRate: NURSING_CARE_RATE_2024, pensionInsuranceRate: PENSION_RATE_2024 },
];

/**
 * フォールバック用の全国平均的な料率（マスタに無い都道府県を引いた場合に使用）。
 * 既存 insurance.ts の HEALTH_INSURANCE_RATE = 0.10 と同水準。
 */
export const FALLBACK_INSURANCE_RATE: Omit<InsuranceRate, "prefecture" | "effectiveFrom"> = {
  healthInsuranceRate: 0.1000,
  nursingCareInsuranceRate: NURSING_CARE_RATE_2024,
  pensionInsuranceRate: PENSION_RATE_2024,
};

// ───────────────────────────────────────────────────────────
// ルックアップヘルパー
// ───────────────────────────────────────────────────────────

/**
 * 指定都道府県・対象年月に適用される料率レコードを返す。
 *
 * 適用ルール: effectiveFrom <= 対象年月の月初 となる行のうち、最も新しいもの。
 * 該当が無ければ null。
 *
 * @param prefecture      都道府県名（"東京都" 等）
 * @param targetYearMonth 対象年月 "YYYY-MM"
 *
 * @example
 * findInsuranceRate("東京都", "2026-05")
 * // => { prefecture: "東京都", effectiveFrom: "2024-04-01",
 * //      healthInsuranceRate: 0.0998, ... }
 */
export function findInsuranceRate(
  prefecture: string,
  targetYearMonth: string,
): InsuranceRate | null {
  // タイムゾーン非依存にするため、Date を介さず "YYYY-MM" 文字列で比較する。
  const m = targetYearMonth.match(/^(\d{4})[-/](\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const targetYM = `${m[1]}-${String(month).padStart(2, "0")}`;

  const candidates = INSURANCE_RATES
    .filter((r) => r.prefecture === prefecture)
    .filter((r) => {
      // effectiveFrom の "YYYY-MM" 部分が targetYM 以下なら適用対象。
      const effYM = r.effectiveFrom.slice(0, 7).replace("/", "-");
      return effYM <= targetYM;
    })
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

  return candidates[0] ?? null;
}

/**
 * 指定都道府県・対象年月の料率を返す。マスタに無ければ全国平均フォールバックを返す。
 * 計算ロジック側で「必ず何らかの料率を得たい」場合に使用する。
 */
export function getInsuranceRateOrFallback(
  prefecture: string,
  targetYearMonth: string,
): Omit<InsuranceRate, "prefecture" | "effectiveFrom"> & { prefecture: string; effectiveFrom: string | null } {
  const found = findInsuranceRate(prefecture, targetYearMonth);
  if (found) return found;
  return {
    prefecture,
    effectiveFrom: null,
    ...FALLBACK_INSURANCE_RATE,
  };
}

// ───────────────────────────────────────────────────────────
// 開発時の整合性チェック
// ───────────────────────────────────────────────────────────

/**
 * INSURANCE_RATES に列挙された都道府県が PREFECTURE_OPTIONS に
 * 含まれているか（タイプミス防止）を起動時に軽くチェック。
 */
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
