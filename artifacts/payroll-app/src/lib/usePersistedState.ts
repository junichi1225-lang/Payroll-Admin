import { useEffect, useRef, useState } from "react";

/**
 * localStorage と同期する State フック（モックアップデモ用）。
 *
 * - マウント時に key から復元（無ければ initial）
 * - 値が変わるたびに JSON.stringify で書き戻し
 * - SSR セーフ（window 未定義時は initial を返す）
 */
export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") {
      return typeof initial === "function" ? (initial as () => T)() : initial;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* fall through to initial */
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota exceeded など — デモ用なので無視 */
    }
  }, [key, value]);

  return [value, setValue];
}

/**
 * 動的に変わる key（例: 月や従業員切替）に対応する localStorage 同期フック。
 *
 * - key が変わるたびに該当キーから読み出して State に反映
 * - 「読み出し済みの key」を ref で追跡し、key 切替直後の古い state を
 *   新しい key に書き戻してしまう競合を防ぐ
 * - 読み出した key と現在の key が一致するときだけ書き戻す
 */
export function useKeyedPersistedState<T>(
  key: string,
  generateInitial: () => T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return generateInitial();
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* fall through */
    }
    return generateInitial();
  });

  const loadedKeyRef = useRef<string>(key);

  // key 変更時のみ再ロード
  useEffect(() => {
    if (loadedKeyRef.current === key) return;
    let next: T;
    try {
      const raw = window.localStorage.getItem(key);
      next = raw !== null ? (JSON.parse(raw) as T) : generateInitial();
    } catch {
      next = generateInitial();
    }
    loadedKeyRef.current = key;
    setValue(next);
    // generateInitial は呼び出し側で都度クロージャされる想定なので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // value 変更時のみ書き戻し（key 切替直後の古い value を防ぐため key は依存に入れない）
  useEffect(() => {
    if (loadedKeyRef.current !== key) return;
    try {
      window.localStorage.setItem(loadedKeyRef.current, JSON.stringify(value));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return [value, setValue];
}
