import { useState, useRef, useMemo, useEffect } from "react";
import {
  EmployeeRecord, EmployeeMaster, ContractMaster, DEFAULT_TENANT_ID,
  EmploymentType, SalaryType, TaxCategory, StandardRemunerationHistory,
  ResidentTaxHistory, SALARY_TYPE_TO_WAGE_TYPE, WAGE_TYPE_TO_SALARY_TYPE,
} from "@/lib/dummy-data";
import { residentTaxFiscalYearOf } from "@/lib/payroll-core";
import { ChevronDown, ChevronUp, MapPin, Loader2, Check, IdCard, Briefcase, ShieldCheck, Save, RotateCcw, Plus, Trash2 } from "lucide-react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────
// ユーティリティ
// ─────────────────────────────────────────────

function toKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

function formatZipcode(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 7);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

// ─────────────────────────────────────────────
// useKanaInput — IME 入力中の読みをカタカナで自動補完
// ─────────────────────────────────────────────

function useKanaInput(initial = "") {
  const [kana, setKana] = useState(initial);
  const committedRef = useRef("");

  const compositionHandlers = {
    onCompositionStart: () => {
      committedRef.current = kana;
    },
    onCompositionUpdate: (e: React.CompositionEvent<HTMLInputElement>) => {
      const candidate = toKatakana(e.data);
      setKana(committedRef.current + candidate);
    },
    onCompositionEnd: () => {},
  };

  return { kana, setKana, compositionHandlers };
}

// ─────────────────────────────────────────────
// 共通入力フィールド
// ─────────────────────────────────────────────

type CompositionHandlers = {
  onCompositionStart?: (e: React.CompositionEvent<HTMLInputElement>) => void;
  onCompositionUpdate?: (e: React.CompositionEvent<HTMLInputElement>) => void;
  onCompositionEnd?: (e: React.CompositionEvent<HTMLInputElement>) => void;
};

function FieldInput({
  id, label, value, onChange, placeholder, type = "text",
  suffix, prefix, className, compositionHandlers, min, step, inputMode,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void;
  placeholder?: string; type?: string;
  suffix?: React.ReactNode; prefix?: React.ReactNode;
  className?: string;
  compositionHandlers?: CompositionHandlers;
  min?: number; step?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-semibold text-foreground/80">
        {label}
      </label>
      <div className="relative">
        {prefix && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none pointer-events-none">
            {prefix}
          </div>
        )}
        <input
          id={id} type={type} value={value} min={min} step={step} inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={placeholder}
          {...compositionHandlers}
          className={cn(
            "w-full px-3 py-2.5 rounded-xl border bg-background text-sm text-foreground",
            "placeholder:text-muted-foreground/40 transition-all outline-none",
            suffix && "pr-10", prefix && "pl-7",
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

function FieldSelect<T extends string>({
  id, label, value, onChange, options, className,
}: {
  id: string; label: string; value: T;
  onChange: (v: T) => void;
  options: readonly T[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-semibold text-foreground/80">
        {label}
      </label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full h-[42px] rounded-xl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SectionHeading({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="w-3.5 h-3.5" />
      </div>
      <h4 className="text-xs font-bold text-foreground tracking-wide">{label}</h4>
    </div>
  );
}

// ─────────────────────────────────────────────
// メインコンポーネント
// ─────────────────────────────────────────────

const EMPLOYMENT_OPTIONS: readonly EmploymentType[] = ["正社員", "契約社員", "アルバイト・パート"];
const SALARY_OPTIONS: readonly SalaryType[] = ["月給", "日給", "時給"];
const TAX_OPTIONS: readonly TaxCategory[] = ["甲欄", "乙欄"];

interface EmployeeInfoTabProps {
  employee: EmployeeRecord;
  savedMaster?: EmployeeMaster;
  /** この従業員の契約・単価履歴（契約DBから絞り込み済み） */
  contractHistories: ContractMaster[];
  /** この従業員の標準報酬月額履歴（履歴DBから絞り込み済み） */
  stdRemHistories: StandardRemunerationHistory[];
  /** この従業員の住民税履歴（履歴DBから絞り込み済み） */
  residentTaxHistories: ResidentTaxHistory[];
  onSave: (
    master: EmployeeMaster,
    contracts: ContractMaster[],
    stdRemHistories: StandardRemunerationHistory[],
    residentTaxHistories: ResidentTaxHistory[],
  ) => void;
}

/** 履歴編集用のドラフト行（入力途中の文字列を保持） */
interface StdRemDraftRow {
  id: string;
  amount: string;      // カンマ区切り表示
  effectiveFrom: string; // "YYYY-MM"
  effectiveTo: string;   // "YYYY-MM" or ""（現在有効）
}

function toDraftRows(histories: StandardRemunerationHistory[]): StdRemDraftRow[] {
  return [...histories]
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .map((h) => ({
      id: h.id,
      amount: h.amount > 0 ? h.amount.toLocaleString("ja-JP") : "",
      effectiveFrom: h.effectiveFrom,
      effectiveTo: h.effectiveTo ?? "",
    }));
}

/** 契約履歴編集用のドラフト行（基本契約 workplaceId=null のみ編集対象） */
interface ContractDraftRow {
  id: string;
  salaryType: SalaryType;   // UI 表示は 月給/日給/時給（保存時に wageType へ変換）
  amount: string;           // カンマ区切り表示
  effectiveFrom: string;    // "YYYY-MM-DD"
  effectiveTo: string;      // "YYYY-MM-DD" or ""（現在有効）
}

function toContractDraftRows(contracts: ContractMaster[]): ContractDraftRow[] {
  return contracts
    .filter((c) => c.workplaceId == null)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .map((c) => ({
      id: c.id,
      salaryType: WAGE_TYPE_TO_SALARY_TYPE[c.wageType],
      amount: c.wageAmount > 0 ? c.wageAmount.toLocaleString("ja-JP") : "",
      effectiveFrom: c.effectiveFrom,
      effectiveTo: c.effectiveTo ?? "",
    }));
}

/** 契約履歴の期間重複チェック（同一 workplaceId 内のみエラー）。 */
function validateContractRows(rows: ContractDraftRow[]): string | null {
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effectiveFrom)) return "契約の開始日が未入力の行があります";
    if (r.effectiveTo && r.effectiveTo < r.effectiveFrom) return "契約の終了日が開始日より前の行があります";
  }
  const sorted = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const nxt = sorted[i + 1];
    if (cur.effectiveTo === "" || nxt.effectiveFrom <= cur.effectiveTo) {
      return `契約の効力期間が重複しています（${cur.effectiveFrom} 開始の行と ${nxt.effectiveFrom} 開始の行）`;
    }
  }
  return null;
}

/** 期間重複チェック。重複があればエラーメッセージ、なければ null を返す。 */
function validateStdRemRows(rows: StdRemDraftRow[]): string | null {
  for (const r of rows) {
    if (!/^\d{4}-\d{2}$/.test(r.effectiveFrom)) return "開始年月が未入力の行があります";
    if (r.effectiveTo && r.effectiveTo < r.effectiveFrom) return "終了年月が開始年月より前の行があります";
  }
  const sorted = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const nxt = sorted[i + 1];
    if (cur.effectiveTo === "" || nxt.effectiveFrom <= cur.effectiveTo) {
      return `効力期間が重複しています（${cur.effectiveFrom} 開始の行と ${nxt.effectiveFrom} 開始の行）`;
    }
  }
  return null;
}

export function EmployeeInfoTab({ employee, savedMaster, contractHistories, stdRemHistories, residentTaxHistories, onSave }: EmployeeInfoTabProps) {
  // 直近年度の住民税レコード（編集対象）
  const latestResidentTaxRecord = useMemo(
    () =>
      residentTaxHistories.length > 0
        ? residentTaxHistories.reduce((a, b) => (b.fiscalYear > a.fiscalYear ? b : a))
        : null,
    [residentTaxHistories],
  );

  // ── 既定値計算 (saved があれば優先、なければ EmployeeRecord から推定) ──
  const initialValues = useMemo(() => {
    if (savedMaster) {
      return {
        lastName: savedMaster.lastName, firstName: savedMaster.firstName,
        lastNameKana: savedMaster.lastNameKana, firstNameKana: savedMaster.firstNameKana,
        birthDate: savedMaster.birthDate, postalCode: savedMaster.postalCode,
        address: savedMaster.address, phoneNumber: savedMaster.phoneNumber,
        pensionNumber: savedMaster.pensionNumber,
        employmentInsuranceNumber: savedMaster.employmentInsuranceNumber,
        employmentType: savedMaster.employmentType,
        taxCategory: savedMaster.taxCategory,
        dependentsCount: savedMaster.dependentsCount == null ? "" : String(savedMaster.dependentsCount),
        residentTaxJune:
          latestResidentTaxRecord && latestResidentTaxRecord.juneAmount > 0
            ? latestResidentTaxRecord.juneAmount.toLocaleString("ja-JP")
            : "",
        residentTaxRegular:
          latestResidentTaxRecord && latestResidentTaxRecord.regularAmount > 0
            ? latestResidentTaxRecord.regularAmount.toLocaleString("ja-JP")
            : "",
        specialCollectionExempt: savedMaster.specialCollectionExempt,
        isSocialInsurance: savedMaster.isSocialInsurance,
        isEmploymentInsurance: savedMaster.isEmploymentInsurance,
        onParentalLeave: savedMaster.onParentalLeave,
        joinedDate: savedMaster.joinedDate,
        resignedDate: savedMaster.resignedDate ?? "",
      };
    }
    const parts = employee.name.split(/\s+/);
    return {
      lastName: parts[0] ?? "", firstName: parts.slice(1).join(" "),
      lastNameKana: "", firstNameKana: "",
      birthDate: "", postalCode: "", address: "",
      phoneNumber: "", pensionNumber: "", employmentInsuranceNumber: "",
      employmentType: "正社員" as EmploymentType,
      taxCategory: null as TaxCategory | null,
      dependentsCount: "",
      residentTaxJune: "",
      residentTaxRegular: "",
      specialCollectionExempt: false,
      isSocialInsurance: null as boolean | null,
      isEmploymentInsurance: null as boolean | null,
      onParentalLeave: false,
      joinedDate: "",
      resignedDate: "",
    };
  }, [employee.name, savedMaster, latestResidentTaxRecord]);

  // ── 基本情報 state ──
  const [lastName, setLastName] = useState(initialValues.lastName);
  const [firstName, setFirstName] = useState(initialValues.firstName);
  const lastNameKana = useKanaInput(initialValues.lastNameKana);
  const firstNameKana = useKanaInput(initialValues.firstNameKana);
  const [birthdate, setBirthdate] = useState(initialValues.birthDate);
  const [zipcode, setZipcode] = useState(initialValues.postalCode);
  const [address, setAddress] = useState(initialValues.address);

  // ── 詳細情報 state ──
  const [phone, setPhone] = useState(initialValues.phoneNumber);
  const [nenkinNumber, setNenkinNumber] = useState(initialValues.pensionNumber);
  const [employmentInsurance, setEmploymentInsurance] = useState(initialValues.employmentInsuranceNumber);
  const [employmentType, setEmploymentType] = useState<EmploymentType>(initialValues.employmentType);
  const [contractRows, setContractRows] = useState<ContractDraftRow[]>(() => toContractDraftRows(contractHistories));
  const [contractError, setContractError] = useState("");
  const [taxCategory, setTaxCategory] = useState<TaxCategory | null>(initialValues.taxCategory);
  const [dependentsCount, setDependentsCount] = useState(initialValues.dependentsCount);
  const [residentTaxJune, setResidentTaxJune] = useState(initialValues.residentTaxJune);
  const [residentTaxRegular, setResidentTaxRegular] = useState(initialValues.residentTaxRegular);
  const [specialCollectionExempt, setSpecialCollectionExempt] = useState(initialValues.specialCollectionExempt);
  const [isSocialInsurance, setIsSocialInsurance] = useState(initialValues.isSocialInsurance);
  const [stdRemRows, setStdRemRows] = useState<StdRemDraftRow[]>(() => toDraftRows(stdRemHistories));
  const [stdRemError, setStdRemError] = useState("");
  const [isEmploymentInsurance, setIsEmploymentInsurance] = useState(initialValues.isEmploymentInsurance);
  const [onParentalLeave, setOnParentalLeave] = useState(initialValues.onParentalLeave);
  const [joinedDate, setJoinedDate] = useState(initialValues.joinedDate);
  const [resignedDate, setResignedDate] = useState(initialValues.resignedDate);
  const [regError, setRegError] = useState("");

  const [detailOpen, setDetailOpen] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  // ── 郵便番号検索 state ──
  const [zipLoading, setZipLoading] = useState(false);
  const [zipSuccess, setZipSuccess] = useState(false);
  const [zipError, setZipError] = useState("");

  // 既存保存データありなら詳細を最初から開く
  useEffect(() => {
    if (savedMaster) setDetailOpen(true);
  }, [savedMaster]);

  // ── 郵便番号 → 住所自動補完 ──
  const handleZipcodeChange = async (raw: string) => {
    const formatted = formatZipcode(raw);
    setZipcode(formatted);
    setZipError(""); setZipSuccess(false);
    const digits = formatted.replace(/\D/g, "");
    if (digits.length !== 7) return;
    setZipLoading(true);
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`);
      const json = await res.json();
      if (json.results?.length > 0) {
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

  // ── リセット ──
  const handleReset = () => {
    setLastName(initialValues.lastName);
    setFirstName(initialValues.firstName);
    lastNameKana.setKana(initialValues.lastNameKana);
    firstNameKana.setKana(initialValues.firstNameKana);
    setBirthdate(initialValues.birthDate);
    setZipcode(initialValues.postalCode);
    setAddress(initialValues.address);
    setPhone(initialValues.phoneNumber);
    setNenkinNumber(initialValues.pensionNumber);
    setEmploymentInsurance(initialValues.employmentInsuranceNumber);
    setEmploymentType(initialValues.employmentType);
    setContractRows(toContractDraftRows(contractHistories));
    setContractError("");
    setTaxCategory(initialValues.taxCategory);
    setDependentsCount(initialValues.dependentsCount);
    setResidentTaxJune(initialValues.residentTaxJune);
    setResidentTaxRegular(initialValues.residentTaxRegular);
    setSpecialCollectionExempt(initialValues.specialCollectionExempt);
    setIsSocialInsurance(initialValues.isSocialInsurance);
    setStdRemRows(toDraftRows(stdRemHistories));
    setStdRemError("");
    setIsEmploymentInsurance(initialValues.isEmploymentInsurance);
    setJoinedDate(initialValues.joinedDate);
    setResignedDate(initialValues.resignedDate);
  };

  // ── 契約・単価 履歴編集（基本契約のみ。職場別契約は保存時にそのまま引き継ぐ） ──
  const updateContractRow = (id: string, patch: Partial<ContractDraftRow>) => {
    setContractRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setContractError("");
  };
  const addContractRow = () => {
    // 新規行の開始日 = 今日。直近の開いた行（終了日空欄）は前日で自動クローズする。
    setContractRows((prev) => {
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const sorted = [...prev].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      const last = sorted[sorted.length - 1];
      const next = prev.map((r) =>
        last && r.id === last.id && r.effectiveTo === "" && r.effectiveFrom < fmt(today)
          ? { ...r, effectiveTo: fmt(yesterday) }
          : r,
      );
      return [
        ...next,
        {
          id: `c_${employee.id}_${Date.now()}`,
          salaryType: (last?.salaryType ?? "月給") as SalaryType,
          amount: "",
          effectiveFrom: fmt(today),
          effectiveTo: "",
        },
      ];
    });
    setContractError("");
  };
  const removeContractRow = (id: string) => {
    setContractRows((prev) => prev.filter((r) => r.id !== id));
    setContractError("");
  };

  // ── 標準報酬月額 履歴編集 ──
  const updateStdRemRow = (id: string, patch: Partial<StdRemDraftRow>) => {
    setStdRemRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setStdRemError("");
  };
  const addStdRemRow = () => {
    // 直近の行（開始年月が最大）の翌月を新規行の開始に、直近行の終了をその前月に自動設定
    setStdRemRows((prev) => {
      const sorted = [...prev].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      const last = sorted[sorted.length - 1];
      let newFrom = "";
      const next = [...prev];
      if (last && /^\d{4}-\d{2}$/.test(last.effectiveFrom)) {
        const [y, m] = last.effectiveFrom.split("-").map((s) => parseInt(s, 10));
        const nextMonth = new Date(y, m, 1); // m は 1-12 → Date月インデックスで翌月
        newFrom = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;
        if (last.effectiveTo === "") {
          // 直近行の終了 = 新規行開始の前月（= 直近行の開始月）で自動クローズ
          const idx = next.findIndex((r) => r.id === last.id);
          next[idx] = { ...next[idx], effectiveTo: last.effectiveFrom };
        }
      }
      return [
        ...next,
        { id: `srh_${employee.id}_${Date.now()}`, amount: "", effectiveFrom: newFrom, effectiveTo: "" },
      ];
    });
    setStdRemError("");
  };
  const removeStdRemRow = (id: string) => {
    setStdRemRows((prev) => prev.filter((r) => r.id !== id));
    setStdRemError("");
  };

  // ── 保存（DB分離: employeeMaster + contractMaster へ ） ──
  const handleSave = () => {
    // 登録時必須バリデーション（3区分バリデーションの「登録時必須」）
    {
      const missing: string[] = [];
      if (lastName.trim() === "") missing.push("姓（漢字）");
      if (firstName.trim() === "") missing.push("名（漢字）");
      if (lastNameKana.kana.trim() === "") missing.push("セイ（カタカナ）");
      if (firstNameKana.kana.trim() === "") missing.push("メイ（カタカナ）");
      if (birthdate.trim() === "") missing.push("生年月日");
      if (joinedDate.trim() === "") missing.push("入社日");
      if (missing.length > 0) {
        setRegError(`必須項目が未入力です: ${missing.join("、")}`);
        setDetailOpen(true);
        return;
      }
      setRegError("");
    }
    {
      const err = validateContractRows(contractRows);
      if (err) {
        setContractError(err);
        setDetailOpen(true);
        return;
      }
    }
    if (isSocialInsurance) {
      const err = validateStdRemRows(stdRemRows);
      if (err) {
        setStdRemError(err);
        setDetailOpen(true);
        return;
      }
    }
    const master: EmployeeMaster = {
      tenantId: DEFAULT_TENANT_ID,
      id: employee.id,
      lastName, firstName,
      lastNameKana: lastNameKana.kana,
      firstNameKana: firstNameKana.kana,
      birthDate: birthdate,
      postalCode: zipcode,
      address,
      phoneNumber: phone,
      pensionNumber: nenkinNumber,
      employmentInsuranceNumber: employmentInsurance,
      employmentType,
      taxCategory,
      dependentsCount: dependentsCount.trim() === "" ? null : parseInt(dependentsCount, 10) || 0,
      specialCollectionExempt,
      isSocialInsurance,
      isEmploymentInsurance,
      onParentalLeave,
      joinedDate,
      resignedDate: resignedDate.trim() === "" ? null : resignedDate,
    };
    // 契約履歴: 編集した基本契約（workplaceId=null）+ 職場別契約はそのまま引き継ぐ
    const nextContracts: ContractMaster[] = [
      ...contractHistories.filter((c) => c.workplaceId != null),
      ...contractRows.map((r) => ({
        tenantId: DEFAULT_TENANT_ID,
        id: r.id,
        employeeId: employee.id,
        workplaceId: null,
        wageType: SALARY_TYPE_TO_WAGE_TYPE[r.salaryType],
        wageAmount: parseInt(r.amount.replace(/[^0-9]/g, ""), 10) || 0,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo === "" ? null : r.effectiveTo,
      })),
    ];
    const histories: StandardRemunerationHistory[] = stdRemRows.map((r) => ({
      id: r.id,
      employeeId: employee.id,
      amount: parseInt(r.amount.replace(/[^0-9]/g, ""), 10) || 0,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo === "" ? null : r.effectiveTo,
    }));
    // 住民税履歴: 直近年度のレコードを更新（無ければ現在年度で新規作成）
    const juneAmount = parseInt(residentTaxJune.replace(/[^0-9]/g, ""), 10) || 0;
    const regularAmount = parseInt(residentTaxRegular.replace(/[^0-9]/g, ""), 10) || 0;
    let nextResidentTaxHistories: ResidentTaxHistory[];
    if (latestResidentTaxRecord) {
      nextResidentTaxHistories = residentTaxHistories.map((h) =>
        h.id === latestResidentTaxRecord.id ? { ...h, juneAmount, regularAmount } : h,
      );
    } else {
      const now = new Date();
      const fy = residentTaxFiscalYearOf(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      );
      nextResidentTaxHistories = [
        ...residentTaxHistories,
        { id: `rth_${employee.id}_${Date.now()}`, employeeId: employee.id, fiscalYear: fy, juneAmount, regularAmount },
      ];
    }
    onSave(master, nextContracts, histories, nextResidentTaxHistories);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-xl">
      {/* ── 基本情報セクション ── */}
      <div className="space-y-5">
        <h3 className="text-sm font-bold text-foreground border-b border-border/60 pb-2">基本情報</h3>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <FieldInput id="lastName" label="姓（漢字）" value={lastName} onChange={setLastName}
              placeholder="山田" compositionHandlers={lastNameKana.compositionHandlers} />
            <FieldInput id="firstName" label="名（漢字）" value={firstName} onChange={setFirstName}
              placeholder="太郎" compositionHandlers={firstNameKana.compositionHandlers} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldInput id="lastNameKana" label="セイ（カタカナ）" value={lastNameKana.kana}
              onChange={lastNameKana.setKana} placeholder="ヤマダ" />
            <FieldInput id="firstNameKana" label="メイ（カタカナ）" value={firstNameKana.kana}
              onChange={firstNameKana.setKana} placeholder="タロウ" />
          </div>
          <p className="text-[11px] text-muted-foreground/60 pl-0.5">
            ※ 漢字欄でIME入力すると、読み（カタカナ）が自動補完されます。
          </p>
        </div>

        <FieldInput id="birthdate" label="生年月日" value={birthdate} onChange={setBirthdate}
          type="date" className="sm:max-w-[200px]" />

        <div className="space-y-3">
          <FieldInput id="zipcode" label="郵便番号" value={zipcode} onChange={handleZipcodeChange}
            placeholder="123-4567" className="sm:max-w-[160px]"
            suffix={
              zipLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              : zipSuccess ? <Check className="w-4 h-4 text-green-500" />
              : zipError ? <MapPin className="w-4 h-4 text-destructive" />
              : <MapPin className="w-4 h-4 text-muted-foreground/40" />
            } />
          {zipError && <p className="text-xs text-destructive pl-1">{zipError}</p>}
          <FieldInput id="address" label="住所" value={address} onChange={setAddress}
            placeholder="東京都渋谷区…" />
        </div>
      </div>

      {/* ── 詳細情報アコーディオン ── */}
      <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
            {detailOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {detailOpen ? "詳細情報を折りたたむ" : "＋ 詳細情報を入力"}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
          <div className="pt-4 space-y-5 border-t border-border/40 mt-3">

            {/* ─ 基本労務情報 ─ */}
            <SectionHeading icon={IdCard} label="基本労務情報" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldInput id="phone" label="電話番号" value={phone} onChange={setPhone}
                placeholder="090-1234-5678" type="tel" />
              <FieldInput id="nenkin" label="基礎年金番号" value={nenkinNumber} onChange={setNenkinNumber}
                placeholder="1234-567890" />
              <FieldInput id="employment-insurance" label="雇用保険被保険者番号"
                value={employmentInsurance} onChange={setEmploymentInsurance}
                placeholder="1234-567890-1" className="sm:col-span-2" />
            </div>

            {/* ─ 給与・契約情報 ─ */}
            <SectionHeading icon={Briefcase} label="給与・契約情報" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldSelect id="employmentType" label="雇用形態"
                value={employmentType} onChange={(v) => setEmploymentType(v as EmploymentType)} options={EMPLOYMENT_OPTIONS} />
              <FieldInput id="joinedDate" label="入社日"
                value={joinedDate} onChange={setJoinedDate} type="date" />
              <FieldInput id="resignedDate" label="退職日（在籍中は空欄）"
                value={resignedDate} onChange={setResignedDate} type="date" />
            </div>

            {/* ─ 契約・単価 履歴（基本契約） ─ */}
            <div className="space-y-2 px-3 py-3 rounded-xl border border-border bg-muted/10" data-testid="contract-history-editor">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-foreground">契約・単価（履歴）</p>
                <button
                  type="button"
                  onClick={addContractRow}
                  data-testid="contract-add-row"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />期間を追加
                </button>
              </div>
              {contractRows.length === 0 && (
                <p className="text-[11px] text-muted-foreground">契約がありません。「期間を追加」から登録してください。</p>
              )}
              {contractRows.map((row) => (
                <div key={row.id} className="flex flex-wrap items-end gap-2" data-testid={`contract-row-${row.id}`}>
                  <FieldSelect id={`c-type-${row.id}`} label="給与形態"
                    value={row.salaryType}
                    onChange={(v) => updateContractRow(row.id, { salaryType: v as SalaryType })}
                    options={SALARY_OPTIONS} className="w-[110px]" />
                  <FieldInput id={`c-amount-${row.id}`} label="単価"
                    value={row.amount} onChange={(v) => {
                      const d = v.replace(/[^0-9]/g, "");
                      updateContractRow(row.id, { amount: d ? parseInt(d, 10).toLocaleString("ja-JP") : "" });
                    }}
                    placeholder={row.salaryType === "時給" ? "1,200" : row.salaryType === "日給" ? "12,000" : "300,000"}
                    inputMode="numeric" prefix="¥" className="w-[130px]" />
                  <FieldInput id={`c-from-${row.id}`} label="効力開始日"
                    value={row.effectiveFrom} onChange={(v) => updateContractRow(row.id, { effectiveFrom: v })}
                    type="date" className="w-[150px]" />
                  <FieldInput id={`c-to-${row.id}`} label="終了日（現在有効は空欄）"
                    value={row.effectiveTo} onChange={(v) => updateContractRow(row.id, { effectiveTo: v })}
                    type="date" className="w-[170px]" />
                  <button
                    type="button"
                    onClick={() => removeContractRow(row.id)}
                    aria-label="この契約行を削除"
                    className="p-2 mb-0.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {contractError && (
                <p className="text-xs text-destructive" data-testid="contract-error">{contractError}</p>
              )}
              <p className="text-[11px] text-muted-foreground/70">
                ※ 派遣先を特定しない基本契約の履歴です。同一職場内で効力期間が重複するとエラーになります。
              </p>
            </div>

            {/* ─ 税金・社会保険情報 ─ */}
            <SectionHeading icon={ShieldCheck} label="税金・社会保険情報" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldSelect id="taxCategory" label="所得税区分"
                value={taxCategory ?? "未設定"}
                onChange={(v) => setTaxCategory(v === "未設定" ? null : (v as TaxCategory))}
                options={["未設定", ...TAX_OPTIONS]} />
              <FieldInput id="dependents" label="扶養親族数（未設定は空欄）"
                value={dependentsCount} onChange={(v) => setDependentsCount(v.replace(/[^0-9]/g, ""))}
                type="number" min={0} step={1} inputMode="numeric" />
              <div className="sm:col-span-2 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-semibold text-foreground">住民税 特別徴収の対象外</p>
                  <p className="text-[11px] text-muted-foreground">普通徴収等で給与から住民税を控除しない場合にオン</p>
                </div>
                <Switch checked={specialCollectionExempt} onCheckedChange={setSpecialCollectionExempt}
                  data-testid="special-collection-exempt"
                  className="data-[state=checked]:bg-primary" />
              </div>
              {!specialCollectionExempt && (
                <>
                  <FieldInput id="residentTaxJune" label="住民税額 6月分（円）"
                    value={residentTaxJune} onChange={(v) => {
                      const d = v.replace(/[^0-9]/g, "");
                      setResidentTaxJune(d ? parseInt(d, 10).toLocaleString("ja-JP") : "");
                    }}
                    placeholder="14,600" inputMode="numeric" prefix="¥" />
                  <FieldInput id="residentTaxRegular" label="住民税額 7月以降（円）"
                    value={residentTaxRegular} onChange={(v) => {
                      const d = v.replace(/[^0-9]/g, "");
                      setResidentTaxRegular(d ? parseInt(d, 10).toLocaleString("ja-JP") : "");
                    }}
                    placeholder="14,200" inputMode="numeric" prefix="¥" />
                </>
              )}
            </div>
            {!specialCollectionExempt && (
              <p className="text-[11px] text-muted-foreground/70 -mt-2 pl-0.5">
                ※ 自治体から届く「特別徴収税額決定通知書」の「6月分」と「7月以降」の月額をそのまま入力してください。
                前年所得の無い新卒等は 0 を設定します。
              </p>
            )}

            {/* 社会保険トグル */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-semibold text-foreground">社会保険加入</p>
                  <p className="text-[11px] text-muted-foreground">健康保険・厚生年金の被保険者</p>
                </div>
                <FieldSelect id="isSocialInsurance" label=""
                  value={isSocialInsurance == null ? "未設定" : isSocialInsurance ? "加入" : "非加入"}
                  onChange={(v) => setIsSocialInsurance(v === "未設定" ? null : v === "加入")}
                  options={["未設定", "加入", "非加入"]} className="w-[110px]" />
              </div>
              {isSocialInsurance === true && (
                <div className="space-y-2 px-3 py-3 rounded-xl border border-border bg-muted/10" data-testid="std-rem-history-editor">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-foreground">標準報酬月額（履歴）</p>
                    <button
                      type="button"
                      onClick={addStdRemRow}
                      data-testid="std-rem-add-row"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />改定を追加
                    </button>
                  </div>
                  {stdRemRows.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">履歴がありません。「改定を追加」から登録してください。</p>
                  )}
                  {stdRemRows.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-end gap-2" data-testid={`std-rem-row-${row.id}`}>
                      <FieldInput id={`srh-amount-${row.id}`} label="月額"
                        value={row.amount} onChange={(v) => {
                          const d = v.replace(/[^0-9]/g, "");
                          updateStdRemRow(row.id, { amount: d ? parseInt(d, 10).toLocaleString("ja-JP") : "" });
                        }}
                        placeholder="300,000" inputMode="numeric" prefix="¥" className="w-[130px]" />
                      <FieldInput id={`srh-from-${row.id}`} label="適用開始"
                        value={row.effectiveFrom} onChange={(v) => updateStdRemRow(row.id, { effectiveFrom: v })}
                        type="month" className="w-[140px]" />
                      <FieldInput id={`srh-to-${row.id}`} label="適用終了（現在有効は空欄）"
                        value={row.effectiveTo} onChange={(v) => updateStdRemRow(row.id, { effectiveTo: v })}
                        type="month" className="w-[170px]" />
                      <button
                        type="button"
                        onClick={() => removeStdRemRow(row.id)}
                        aria-label="この履歴行を削除"
                        className="p-2 mb-0.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {stdRemError && (
                    <p className="text-xs text-destructive" data-testid="std-rem-error">{stdRemError}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground/70">
                    ※ 給与計算では対象月に有効な履歴の月額が自動で適用されます（定時決定・随時改定に対応）。
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-semibold text-foreground">雇用保険加入</p>
                  <p className="text-[11px] text-muted-foreground">失業給付等の対象</p>
                </div>
                <FieldSelect id="isEmploymentInsurance" label=""
                  value={isEmploymentInsurance == null ? "未設定" : isEmploymentInsurance ? "加入" : "非加入"}
                  onChange={(v) => setIsEmploymentInsurance(v === "未設定" ? null : v === "加入")}
                  options={["未設定", "加入", "非加入"]} className="w-[110px]" />
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-semibold text-foreground">産休・育休中</p>
                  <p className="text-[11px] text-muted-foreground">オンの間は社会保険料（健保・介護・厚年・子育て拠出）を免除</p>
                </div>
                <Switch checked={onParentalLeave} onCheckedChange={setOnParentalLeave}
                  data-testid="on-parental-leave"
                  className="data-[state=checked]:bg-primary" />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {regError && (
        <p className="text-xs text-destructive" data-testid="registration-error">{regError}</p>
      )}

      {/* ── 保存・リセットボタン ── */}
      <div className="pt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Save className="w-4 h-4" />変更を保存
        </button>
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />リセット
        </button>
        {savedToast && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1.5">
            <Check className="w-3 h-3" />保存しました（従業員DB / 契約DB に分離して登録）
          </span>
        )}
      </div>
    </div>
  );
}
