// 従業員関連の履歴データ（標準報酬月額など）の localStorage ロードと引き当て。
//
// - 純粋な引き当てロジックは payroll-core の getStandardRemuneration に置く
// - このモジュールは「localStorage からの読み出し + フォールバック」だけを担う
// - PayrollTab / payrollInputs / bonusCalc は必ずこのモジュール経由で
//   標準報酬月額を解決すること（直接 EmployeeMaster から読まない）

import {
  DEFAULT_STD_REM_HISTORIES,
  DEFAULT_RESIDENT_TAX_HISTORIES,
  ResidentTaxHistory,
  StandardRemunerationHistory,
} from "./dummy-data";
import { getStandardRemuneration, getResidentTax } from "./payroll-core";

export const STD_REM_HISTORY_DB_KEY = "mock_stdRemHistoryDB";
export const RESIDENT_TAX_DB_KEY = "mock_residentTaxDB";

function readJson<T>(key: string, fallback: () => T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* fall through */
  }
  return fallback();
}

/** 標準報酬月額 履歴 DB を localStorage から読み出す（未保存ならダミーデータ）。 */
export function loadStdRemHistoryDB(): StandardRemunerationHistory[] {
  const db = readJson<StandardRemunerationHistory[]>(
    STD_REM_HISTORY_DB_KEY,
    () => DEFAULT_STD_REM_HISTORIES,
  );
  return Array.isArray(db) ? db : DEFAULT_STD_REM_HISTORIES;
}

export interface ResolvedStandardRemuneration {
  /** 対象月に有効な標準報酬月額（該当なしは 0） */
  amount: number;
  /** 引き当てた履歴レコードの ID（確定スナップショット用。該当なしは null） */
  historyId: string | null;
}

/**
 * 対象年月 "YYYY-MM" に有効な標準報酬月額を解決する。
 * histories を渡さない場合は localStorage から読み出す（React 外の計算経路用）。
 */
export function resolveStandardRemuneration(
  employeeId: string,
  targetYearMonth: string,
  histories?: StandardRemunerationHistory[],
): ResolvedStandardRemuneration {
  const db = histories ?? loadStdRemHistoryDB();
  const rec = getStandardRemuneration(db, employeeId, targetYearMonth);
  return { amount: rec?.amount ?? 0, historyId: rec?.id ?? null };
}

/** 住民税 履歴 DB を localStorage から読み出す（未保存ならダミーデータ）。 */
export function loadResidentTaxDB(): ResidentTaxHistory[] {
  const db = readJson<ResidentTaxHistory[]>(
    RESIDENT_TAX_DB_KEY,
    () => DEFAULT_RESIDENT_TAX_HISTORIES,
  );
  return Array.isArray(db) ? db : DEFAULT_RESIDENT_TAX_HISTORIES;
}

export interface ResolvedResidentTax {
  /** 対象月の住民税控除額（対象外・該当なしは 0） */
  amount: number;
  /** 引き当てた履歴レコードの ID（該当なしは null） */
  historyId: string | null;
}

/**
 * 対象年月 "YYYY-MM" の住民税控除額を解決する。
 * specialCollectionExempt（特別徴収対象外）の場合は控除 0・履歴引き当てなし。
 * histories を渡さない場合は localStorage から読み出す（React 外の計算経路用）。
 */
export function resolveResidentTax(
  employeeId: string,
  targetYearMonth: string,
  specialCollectionExempt: boolean,
  histories?: ResidentTaxHistory[],
): ResolvedResidentTax {
  if (specialCollectionExempt) return { amount: 0, historyId: null };
  const db = histories ?? loadResidentTaxDB();
  const hit = getResidentTax(db, employeeId, targetYearMonth);
  return { amount: hit?.amount ?? 0, historyId: hit?.record.id ?? null };
}
