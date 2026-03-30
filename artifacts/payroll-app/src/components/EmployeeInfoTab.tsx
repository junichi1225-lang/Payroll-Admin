import { useState, useRef } from "react";
import { EmployeeRecord } from "@/lib/dummy-data";
import { ChevronDown, ChevronUp, MapPin, Loader2, Check } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

/** ひらがな → カタカナ変換（Unicode 0x60 オフセット） */
function toKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

/** 郵便番号フォーマット（7桁 → XXX-XXXX） */
function formatZipcode(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 7);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

// ─────────────────────────────────────────────
// 入力フィールド共通スタイル
// ─────────────────────────────────────────────

function FieldInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
  suffix,
  className,
  onCompositionStart,
  onCompositionUpdate,
  onCompositionEnd,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  suffix?: React.ReactNode;
  className?: string;
  onCompositionStart?: (e: React.CompositionEvent<HTMLInputElement>) => void;
  onCompositionUpdate?: (e: React.CompositionEvent<HTMLInputElement>) => void;
  onCompositionEnd?: (e: React.CompositionEvent<HTMLInputElement>) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-foreground/80"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onCompositionStart={onCompositionStart}
          onCompositionUpdate={onCompositionUpdate}
          onCompositionEnd={onCompositionEnd}
          placeholder={placeholder}
          readOnly={readOnly}
          className={cn(
            "w-full px-3 py-2.5 rounded-xl border bg-background text-sm text-foreground",
            "placeholder:text-muted-foreground/40 transition-all outline-none",
            readOnly && "bg-muted/30 text-muted-foreground cursor-default",
            suffix && "pr-10"
          )}
          style={{
            borderColor: focused ? "#3b82f6" : undefined,
            boxShadow: focused ? "0 0 0 3px rgba(59,130,246,0.12)" : undefined,
          }}
        />
        {suffix && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

interface EmployeeInfoTabProps {
  employee: EmployeeRecord;
}

export function EmployeeInfoTab({ employee }: EmployeeInfoTabProps) {
  // ── 基本情報フォームの状態 ──
  const [kanjiName, setKanjiName] = useState(employee.name);
  const [furigana, setFurigana] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [zipcode, setZipcode] = useState("");
  const [address, setAddress] = useState("");

  // ── 詳細情報フォームの状態 ──
  const [phone, setPhone] = useState("");
  const [nenkinNumber, setNenkinNumber] = useState("");
  const [employmentInsurance, setEmploymentInsurance] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);

  // ── 住所検索の状態 ──
  const [zipLoading, setZipLoading] = useState(false);
  const [zipSuccess, setZipSuccess] = useState(false);
  const [zipError, setZipError] = useState("");

  // ── IME（フリガナ自動入力）── 
  const composingRef = useRef(false);
  const currentCompositionRef = useRef("");

  const handleKanjiCompositionUpdate = (e: React.CompositionEvent<HTMLInputElement>) => {
    // IME入力中のひらがなをカタカナに変換してフリガナへセット
    const katakana = toKatakana(e.data);
    if (katakana) {
      setFurigana(katakana);
      currentCompositionRef.current = katakana;
    }
  };

  const handleKanjiCompositionStart = () => {
    composingRef.current = true;
  };

  const handleKanjiCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    // 確定時も最後の変換結果を反映
    const katakana = toKatakana(e.data);
    if (katakana) setFurigana(katakana);
  };

  // ── 郵便番号 → 住所自動補完 ──
  const handleZipcodeChange = async (raw: string) => {
    const formatted = formatZipcode(raw);
    setZipcode(formatted);
    setZipError("");
    setZipSuccess(false);

    const digits = formatted.replace(/\D/g, "");
    if (digits.length !== 7) return;

    setZipLoading(true);
    try {
      const res = await fetch(
        `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`
      );
      const json = await res.json();
      if (json.results && json.results.length > 0) {
        const r = json.results[0];
        setAddress(`${r.address1}${r.address2}${r.address3}`);
        setZipSuccess(true);
        setTimeout(() => setZipSuccess(false), 2000);
      } else {
        setZipError("該当する住所が見つかりませんでした");
      }
    } catch {
      setZipError("住所の取得に失敗しました");
    } finally {
      setZipLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      {/* ── セクションタイトル ── */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-foreground border-b border-border/60 pb-2">
          基本情報
        </h3>

        {/* 氏名 2カラム */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FieldInput
            id="kanjiName"
            label="氏名（漢字）"
            value={kanjiName}
            onChange={setKanjiName}
            placeholder="山田 太郎"
            onCompositionStart={handleKanjiCompositionStart}
            onCompositionUpdate={handleKanjiCompositionUpdate}
            onCompositionEnd={handleKanjiCompositionEnd}
          />
          <FieldInput
            id="furigana"
            label="氏名（フリガナ）"
            value={furigana}
            onChange={setFurigana}
            placeholder="ヤマダ タロウ"
          />
        </div>

        {/* 生年月日 */}
        <FieldInput
          id="birthdate"
          label="生年月日"
          value={birthdate}
          onChange={setBirthdate}
          type="date"
          className="sm:max-w-[200px]"
        />

        {/* 郵便番号 + 住所 */}
        <div className="space-y-3">
          <FieldInput
            id="zipcode"
            label="郵便番号"
            value={zipcode}
            onChange={handleZipcodeChange}
            placeholder="123-4567"
            className="sm:max-w-[160px]"
            suffix={
              zipLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : zipSuccess ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : zipError ? (
                <MapPin className="w-4 h-4 text-destructive" />
              ) : (
                <MapPin className="w-4 h-4 text-muted-foreground/40" />
              )
            }
          />
          {zipError && (
            <p className="text-xs text-destructive pl-1">{zipError}</p>
          )}
          <FieldInput
            id="address"
            label="住所"
            value={address}
            onChange={setAddress}
            placeholder="東京都渋谷区…"
          />
        </div>
      </div>

      {/* ── 詳細情報アコーディオン ── */}
      <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-2 text-sm font-semibold transition-colors",
              "text-muted-foreground hover:text-foreground"
            )}
          >
            {detailOpen ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            {detailOpen ? "詳細情報を折りたたむ" : "＋ 詳細情報を入力"}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
          <div className="pt-4 space-y-4 border-t border-border/40 mt-3">
            <h3 className="text-sm font-bold text-foreground">詳細情報</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldInput
                id="phone"
                label="電話番号"
                value={phone}
                onChange={setPhone}
                placeholder="090-1234-5678"
                type="tel"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldInput
                id="nenkin"
                label="基礎年金番号"
                value={nenkinNumber}
                onChange={setNenkinNumber}
                placeholder="1234-567890"
              />
              <FieldInput
                id="employment-insurance"
                label="雇用保険被保険者番号"
                value={employmentInsurance}
                onChange={setEmploymentInsurance}
                placeholder="1234-567890-1"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── 保存ボタン ── */}
      <div className="pt-2 flex gap-3">
        <button
          className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          onClick={() => {}}
        >
          変更を保存
        </button>
        <button
          className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
          onClick={() => {
            setKanjiName(employee.name);
            setFurigana("");
            setBirthdate("");
            setZipcode("");
            setAddress("");
          }}
        >
          リセット
        </button>
      </div>
    </div>
  );
}
