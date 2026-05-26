import { useState, useRef, useMemo, useEffect } from "react";
import {
  EmployeeRecord, EmployeeMaster, ContractMaster, DEFAULT_TENANT_ID,
  EmploymentType, SalaryType, TaxCategory,
} from "@/lib/dummy-data";
import { ChevronDown, ChevronUp, MapPin, Loader2, Check, IdCard, Briefcase, ShieldCheck, Save, RotateCcw } from "lucide-react";
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
  savedContract?: ContractMaster;
  onSave: (master: EmployeeMaster, contract: Pick<ContractMaster, "salaryType" | "baseSalary">) => void;
}

export function EmployeeInfoTab({ employee, savedMaster, savedContract, onSave }: EmployeeInfoTabProps) {
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
        dependentsCount: String(savedMaster.dependentsCount),
        residentTax: savedMaster.residentTax > 0 ? String(savedMaster.residentTax) : "",
        isSocialInsurance: savedMaster.isSocialInsurance,
        standardRemuneration: savedMaster.standardRemuneration > 0 ? String(savedMaster.standardRemuneration) : "",
        isEmploymentInsurance: savedMaster.isEmploymentInsurance,
        joinedDate: savedMaster.joinedDate,
        resignedDate: savedMaster.resignedDate ?? "",
        salaryType: savedContract?.salaryType ?? ("月給" as SalaryType),
        baseSalary: savedContract && savedContract.baseSalary > 0 ? String(savedContract.baseSalary) : "",
      };
    }
    const parts = employee.name.split(/\s+/);
    return {
      lastName: parts[0] ?? "", firstName: parts.slice(1).join(" "),
      lastNameKana: "", firstNameKana: "",
      birthDate: "", postalCode: "", address: "",
      phoneNumber: "", pensionNumber: "", employmentInsuranceNumber: "",
      employmentType: "正社員" as EmploymentType,
      taxCategory: "甲欄" as TaxCategory,
      dependentsCount: "0",
      residentTax: "",
      isSocialInsurance: false,
      standardRemuneration: "",
      isEmploymentInsurance: false,
      joinedDate: "",
      resignedDate: "",
      salaryType: "月給" as SalaryType,
      baseSalary: "",
    };
  }, [employee.name, savedMaster, savedContract]);

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
  const [salaryType, setSalaryType] = useState<SalaryType>(initialValues.salaryType);
  const [baseSalary, setBaseSalary] = useState(initialValues.baseSalary);
  const [taxCategory, setTaxCategory] = useState<TaxCategory>(initialValues.taxCategory);
  const [dependentsCount, setDependentsCount] = useState(initialValues.dependentsCount);
  const [residentTax, setResidentTax] = useState(initialValues.residentTax);
  const [isSocialInsurance, setIsSocialInsurance] = useState(initialValues.isSocialInsurance);
  const [standardRemuneration, setStandardRemuneration] = useState(initialValues.standardRemuneration);
  const [isEmploymentInsurance, setIsEmploymentInsurance] = useState(initialValues.isEmploymentInsurance);
  const [joinedDate, setJoinedDate] = useState(initialValues.joinedDate);
  const [resignedDate, setResignedDate] = useState(initialValues.resignedDate);

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
    setSalaryType(initialValues.salaryType);
    setBaseSalary(initialValues.baseSalary);
    setTaxCategory(initialValues.taxCategory);
    setDependentsCount(initialValues.dependentsCount);
    setResidentTax(initialValues.residentTax);
    setIsSocialInsurance(initialValues.isSocialInsurance);
    setStandardRemuneration(initialValues.standardRemuneration);
    setIsEmploymentInsurance(initialValues.isEmploymentInsurance);
    setJoinedDate(initialValues.joinedDate);
    setResignedDate(initialValues.resignedDate);
  };

  // ── 保存（DB分離: employeeMaster + contractMaster へ ） ──
  const handleSave = () => {
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
      dependentsCount: parseInt(dependentsCount, 10) || 0,
      residentTax: parseInt(residentTax.replace(/[^0-9]/g, ""), 10) || 0,
      isSocialInsurance,
      standardRemuneration: isSocialInsurance
        ? (parseInt(standardRemuneration.replace(/[^0-9]/g, ""), 10) || 0)
        : 0,
      isEmploymentInsurance,
      joinedDate,
      resignedDate: resignedDate.trim() === "" ? null : resignedDate,
    };
    const contractInput = {
      salaryType,
      baseSalary: parseInt(baseSalary.replace(/[^0-9]/g, ""), 10) || 0,
    };
    onSave(master, contractInput);
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
              <FieldSelect id="salaryType" label="給与形態"
                value={salaryType} onChange={(v) => setSalaryType(v as SalaryType)} options={SALARY_OPTIONS} />
              <FieldInput id="baseSalary" label="基本給与額"
                value={baseSalary} onChange={(v) => {
                  const d = v.replace(/[^0-9]/g, "");
                  setBaseSalary(d ? parseInt(d, 10).toLocaleString("ja-JP") : "");
                }}
                placeholder={salaryType === "時給" ? "1,200" : salaryType === "日給" ? "12,000" : "300,000"}
                inputMode="numeric" prefix="¥" className="sm:col-span-2 sm:max-w-[260px]" />
              <FieldInput id="joinedDate" label="入社日"
                value={joinedDate} onChange={setJoinedDate} type="date" />
              <FieldInput id="resignedDate" label="退職日（在籍中は空欄）"
                value={resignedDate} onChange={setResignedDate} type="date" />
            </div>

            {/* ─ 税金・社会保険情報 ─ */}
            <SectionHeading icon={ShieldCheck} label="税金・社会保険情報" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldSelect id="taxCategory" label="所得税区分"
                value={taxCategory} onChange={(v) => setTaxCategory(v as TaxCategory)} options={TAX_OPTIONS} />
              <FieldInput id="dependents" label="扶養親族数"
                value={dependentsCount} onChange={(v) => setDependentsCount(v.replace(/[^0-9]/g, ""))}
                type="number" min={0} step={1} inputMode="numeric" />
              <FieldInput id="residentTax" label="住民税額（円）"
                value={residentTax} onChange={(v) => {
                  const d = v.replace(/[^0-9]/g, "");
                  setResidentTax(d ? parseInt(d, 10).toLocaleString("ja-JP") : "");
                }}
                placeholder="14,200" inputMode="numeric" prefix="¥"
                className="sm:col-span-2 sm:max-w-[260px]" />
            </div>
            <p className="text-[11px] text-muted-foreground/70 -mt-2 pl-0.5">
              ※ 自治体から届く「特別徴収税額決定通知書」の月額をそのまま入力してください。
              前年所得の無い新卒等は 0 を設定します。
            </p>

            {/* 社会保険トグル */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-semibold text-foreground">社会保険加入</p>
                  <p className="text-[11px] text-muted-foreground">健康保険・厚生年金の被保険者</p>
                </div>
                <Switch checked={isSocialInsurance} onCheckedChange={setIsSocialInsurance}
                  className="data-[state=checked]:bg-primary" />
              </div>
              {isSocialInsurance && (
                <FieldInput id="standardRemuneration" label="標準報酬月額"
                  value={standardRemuneration} onChange={(v) => {
                    const d = v.replace(/[^0-9]/g, "");
                    setStandardRemuneration(d ? parseInt(d, 10).toLocaleString("ja-JP") : "");
                  }}
                  placeholder="300,000" inputMode="numeric" prefix="¥"
                  className="sm:max-w-[260px]" />
              )}
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20">
                <div>
                  <p className="text-sm font-semibold text-foreground">雇用保険加入</p>
                  <p className="text-[11px] text-muted-foreground">失業給付等の対象</p>
                </div>
                <Switch checked={isEmploymentInsurance} onCheckedChange={setIsEmploymentInsurance}
                  className="data-[state=checked]:bg-primary" />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

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
