import type { DeductionBreakdown } from "./payroll-core";

// マルチテナント識別子（DB移行時は認証コンテキストから取得）
export const DEFAULT_TENANT_ID = "tenant-1";

/** 自社名（給与明細・帳票のヘッダー表示用。DB移行時はテナント設定から取得）。 */
export const DEFAULT_TENANT_NAME = "株式会社サンプル";

export type PayrollStatus = "確定済み" | "未確定";
export type EmployeeStatus = "在籍中" | "休職中" | "退職";
export type EmployeeColor = "blue" | "green" | "rose" | "amber" | "purple" | "teal";
export type TimecardOcrStatus = "success" | "error" | "manual";
export type RoundingType = "1min" | "15min" | "snap";
export type DayOfWeek = "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";
export type HolidayType = "weekday" | "legal_holiday" | "scheduled_holiday";
export type EmploymentType = "正社員" | "契約社員" | "アルバイト・パート";
export type SalaryType = "月給" | "日給" | "時給";
export type TaxCategory = "甲欄" | "乙欄";

// ─────────────────────────────────────────────
// 従業員マスタ DB（個人情報・労務・税金/社会保険）
// ─────────────────────────────────────────────
export interface EmployeeMaster {
  tenantId: string;
  id: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  postalCode: string;
  address: string;
  phoneNumber: string;
  pensionNumber: string;
  employmentInsuranceNumber: string;
  employmentType: EmploymentType;
  /** 所得税区分（甲欄/乙欄）。担当者が直接選択。null = 未設定（給与計算時必須） */
  taxCategory: TaxCategory | null;
  /** 扶養親族数（配偶者含む）。null = 未設定（給与計算時必須） */
  dependentsCount: number | null;
  /** 社会保険 加入/非加入。null = 未設定（給与計算時必須） */
  isSocialInsurance: boolean | null;
  /** 雇用保険 加入/非加入。null = 未設定（給与計算時必須） */
  isEmploymentInsurance: boolean | null;
  /** 育休・産休中フラグ。true = 社会保険系控除（健康・介護・厚年・支援金）を 0 にする */
  onParentalLeave: boolean;
  /**
   * 特別徴収対象外フラグ。
   * true = 住民税の特別徴収を行わない（普通徴収等）。金額 0 円とは意味が異なる。
   * 対象外の従業員は給与計算で住民税を控除せず、明細にも行を出さない。
   */
  specialCollectionExempt: boolean;
  /** 入社日 "YYYY-MM-DD"（給与計算の在籍判定に使用） */
  joinedDate: string;
  /** 退職日 "YYYY-MM-DD"（在籍中は null。退職月の社会保険料判定等に使用） */
  resignedDate: string | null;
}

// ─────────────────────────────────────────────
// 標準報酬月額 履歴 DB
// Employee の単一値保持を廃止し、効力期間つき履歴で管理する。
// 給与計算時は payroll-core の getStandardRemuneration(histories, employeeId, targetMonth)
// で「対象月に有効な1件」を引き当てる。
// ─────────────────────────────────────────────
export interface StandardRemunerationHistory {
  id: string;
  employeeId: string;
  /** 標準報酬月額（円） */
  amount: number;
  /** 効力開始年月 "YYYY-MM" */
  effectiveFrom: string;
  /** 効力終了年月 "YYYY-MM"。null = 現在有効 */
  effectiveTo: string | null;
}

/**
 * 標準報酬月額履歴の初期ダミーデータ。
 * 効力開始は各従業員の入社月（過去月へ遡っても計算結果が変わらないようにするため）。
 */
export const DEFAULT_STD_REM_HISTORIES: StandardRemunerationHistory[] = [
  { id: "srh_e1_1", employeeId: "e1", amount: 320000, effectiveFrom: "2019-04", effectiveTo: null },
  { id: "srh_e2_1", employeeId: "e2", amount: 280000, effectiveFrom: "2020-07", effectiveTo: null },
  { id: "srh_e3_1", employeeId: "e3", amount: 380000, effectiveFrom: "2018-01", effectiveTo: null },
  { id: "srh_e4_1", employeeId: "e4", amount: 220000, effectiveFrom: "2022-10", effectiveTo: null },
  { id: "srh_e5_1", employeeId: "e5", amount: 420000, effectiveFrom: "2017-06", effectiveTo: null },
];

// ─────────────────────────────────────────────
// 住民税 履歴 DB（年度単位の2値: 6月分と7月以降）
// 特別徴収税額決定通知書は「6月分」と「7月以降の月額」が異なるため、
// 年度（6月開始）ごとに2値で保持する。
// ─────────────────────────────────────────────
export interface ResidentTaxHistory {
  id: string;
  employeeId: string;
  /** 年度（6月開始）。例: 2026 = 2026年6月〜2027年5月 */
  fiscalYear: number;
  /** 6月（初月）の月額 */
  juneAmount: number;
  /** 7月〜翌5月の月額 */
  regularAmount: number;
}

/**
 * 住民税履歴の初期ダミーデータ。
 * 旧・単一値と同額を juneAmount / regularAmount にコピーしているため、
 * どの月を計算しても従来と同じ控除額になる（計算結果を変えないための移行方針）。
 */
export const DEFAULT_RESIDENT_TAX_HISTORIES: ResidentTaxHistory[] = [
  { id: "rth_e1_1", employeeId: "e1", fiscalYear: 2019, juneAmount: 14200, regularAmount: 14200 },
  { id: "rth_e2_1", employeeId: "e2", fiscalYear: 2020, juneAmount: 8500, regularAmount: 8500 },
  { id: "rth_e3_1", employeeId: "e3", fiscalYear: 2018, juneAmount: 21800, regularAmount: 21800 },
  // e4: 新卒入社のため前年所得なし → 住民税 0（対象外フラグとは別物）
  { id: "rth_e4_1", employeeId: "e4", fiscalYear: 2022, juneAmount: 0, regularAmount: 0 },
  { id: "rth_e5_1", employeeId: "e5", fiscalYear: 2017, juneAmount: 26500, regularAmount: 26500 },
];

/**
 * 従業員マスタの初期ダミーデータ。
 * モックアップ表示のため住民税は履歴DB（DEFAULT_RESIDENT_TAX_HISTORIES）に設定済。
 * 既存 localStorage に保存済みのマスタが優先される。
 */
export const DEFAULT_EMPLOYEE_MASTERS: Record<string, EmployeeMaster> = {
  e1: {
    tenantId: DEFAULT_TENANT_ID, id: "e1",
    lastName: "山田", firstName: "太郎",
    lastNameKana: "ヤマダ", firstNameKana: "タロウ",
    birthDate: "1985-04-12",
    postalCode: "", address: "", phoneNumber: "",
    pensionNumber: "", employmentInsuranceNumber: "",
    employmentType: "正社員", taxCategory: "甲欄",
    dependentsCount: 1,
    isSocialInsurance: true,
    isEmploymentInsurance: true,
    onParentalLeave: false,
    specialCollectionExempt: false,
    joinedDate: "2019-04-01", resignedDate: null,
  },
  e2: {
    tenantId: DEFAULT_TENANT_ID, id: "e2",
    lastName: "鈴木", firstName: "花子",
    lastNameKana: "スズキ", firstNameKana: "ハナコ",
    birthDate: "1992-08-22",
    postalCode: "", address: "", phoneNumber: "",
    pensionNumber: "", employmentInsuranceNumber: "",
    employmentType: "正社員", taxCategory: "甲欄",
    dependentsCount: 0,
    isSocialInsurance: true,
    isEmploymentInsurance: true,
    onParentalLeave: false,
    specialCollectionExempt: false,
    joinedDate: "2020-07-15", resignedDate: null,
  },
  e3: {
    tenantId: DEFAULT_TENANT_ID, id: "e3",
    lastName: "田中", firstName: "一郎",
    lastNameKana: "タナカ", firstNameKana: "イチロウ",
    birthDate: "1980-02-03",
    postalCode: "", address: "", phoneNumber: "",
    pensionNumber: "", employmentInsuranceNumber: "",
    employmentType: "正社員", taxCategory: "甲欄",
    dependentsCount: 2,
    isSocialInsurance: true,
    isEmploymentInsurance: true,
    onParentalLeave: false,
    specialCollectionExempt: false,
    joinedDate: "2018-01-10", resignedDate: null,
  },
  e4: {
    tenantId: DEFAULT_TENANT_ID, id: "e4",
    lastName: "伊藤", firstName: "美咲",
    lastNameKana: "イトウ", firstNameKana: "ミサキ",
    birthDate: "2001-11-30",
    postalCode: "", address: "", phoneNumber: "",
    pensionNumber: "", employmentInsuranceNumber: "",
    employmentType: "正社員", taxCategory: "甲欄",
    dependentsCount: 0,
    isSocialInsurance: true,
    isEmploymentInsurance: true,
    onParentalLeave: false,
    specialCollectionExempt: false,
    joinedDate: "2022-10-01", resignedDate: null,
  },
  e5: {
    tenantId: DEFAULT_TENANT_ID, id: "e5",
    lastName: "渡辺", firstName: "健一",
    lastNameKana: "ワタナベ", firstNameKana: "ケンイチ",
    birthDate: "1975-09-08",
    postalCode: "", address: "", phoneNumber: "",
    pensionNumber: "", employmentInsuranceNumber: "",
    employmentType: "正社員", taxCategory: "甲欄",
    dependentsCount: 3,
    isSocialInsurance: true,
    isEmploymentInsurance: true,
    onParentalLeave: false,
    specialCollectionExempt: false,
    joinedDate: "2017-06-01", resignedDate: null,
  },
};

// ─────────────────────────────────────────────
// 契約・単価マスタ DB（効力期間つき履歴。職場別の給与契約）
// 賃金形態（月給/日給/時給）は Employee 側から契約履歴へ移動した。
// 給与計算時は打刻日付で有効な契約を payroll-core の getActiveContract で引く。
// ─────────────────────────────────────────────
export type WageType = "monthly" | "daily" | "hourly";

export interface ContractMaster {
  tenantId: string;
  id: string;
  employeeId: string;
  /** 対象職場。null = 派遣先を特定しない基本契約 */
  workplaceId: string | null;
  /** 賃金形態（Employee から移動） */
  wageType: WageType;
  /** 単価（月給なら月額、日給なら日額、時給なら時間額） */
  wageAmount: number;
  /** 効力開始日 "YYYY-MM-DD" */
  effectiveFrom: string;
  /** 効力終了日 "YYYY-MM-DD"。null = 現在有効 */
  effectiveTo: string | null;
}

/** UI 表示ラベル（月給/日給/時給）↔ wageType の相互変換。 */
export const WAGE_TYPE_TO_SALARY_TYPE: Record<WageType, SalaryType> = {
  monthly: "月給", daily: "日給", hourly: "時給",
};
export const SALARY_TYPE_TO_WAGE_TYPE: Record<SalaryType, WageType> = {
  "月給": "monthly", "日給": "daily", "時給": "hourly",
};

// ─────────────────────────────────────────────
// 給与確定スナップショット DB
// 「ロック」された月の給与額を不変保存。マスタ(時給等)変更後も
// 過去金額が書き換わらないようにするための SoR(System of Record)。
// ─────────────────────────────────────────────
export type PayrollResultStatus = "draft" | "locked";

export interface PayrollResult {
  tenantId: string;
  id: string;                    // `pr_${employeeId}_${YYYY-MM}`
  employeeId: string;
  targetYearMonth: string;       // "YYYY-MM" 例: "2026-03"
  status: PayrollResultStatus;
  appliedSalaryType: SalaryType; // 確定時の給与形態（時給/月給/日給）
  appliedBaseSalary: number;     // 確定時の単価（時給制なら時給、月給制なら月額）
  totalWorkingHours: number;     // 当月の総労働時間（実働）
  totalPayment: number;          // 総支給額
  totalDeduction: number;        // 総控除額（所得税＋社保など簡易合算）
  netPay: number;                // 差引支給額（手取り）
  lockedAt: string | null;       // ISO8601。draft の場合は null
  /**
   * 確定時点の控除内訳スナップショット。
   * 帳票（給与明細PDF・給与一覧PDF）が確定値をそのまま出力できるように保持する。
   * レガシーデータ（本フィールド導入前の確定レコード）では undefined。
   */
  deductions?: DeductionBreakdown;
  /**
   * 確定時点の手当スナップショット（給与明細PDFの支給項目内訳用）。
   * レガシーデータでは undefined。
   */
  allowances?: AllowanceItem[];
  /**
   * 源泉所得税の計算前提スナップショット（税額表の年分・甲欄/乙欄・扶養等の数）。
   * どの前提で税額が計算されたかを確定後も再現できるように保持する。
   * レガシーデータでは undefined。
   */
  taxSnapshot?: PayrollTaxSnapshot;
  /**
   * 確定時に適用した料率のスナップショット（健保・介護・厚年・支援金・雇用保険）。
   * レガシーデータでは undefined。
   */
  appliedRates?: {
    healthInsuranceRate: number;
    nursingCareInsuranceRate: number;
    pensionInsuranceRate: number;
    childcareSupportRate: number;
    employmentInsuranceEmployeeRate: number;
  };
  /** 社会保険料（被保険者負担）控除後の給与額。賞与計算が前月実績として参照する */
  socialInsuranceDeductedSalary?: number;
  /** 当月の源泉徴収税額。賞与計算が前月実績として参照する */
  withheldIncomeTax?: number;
  /** 有給休暇: 前月末残日数（有給管理機能導入前の確定分は 0） */
  paidLeavePreviousBalance?: number;
  /** 有給休暇: 当月使用日数 */
  paidLeaveUsedThisMonth?: number;
  /** 有給休暇: 当月末残日数 */
  paidLeaveCurrentBalance?: number;
  /** 確定時に適用した標準報酬月額 */
  appliedStandardRemuneration?: number;
  /** 適用した標準報酬月額の履歴レコードID（該当なしは null） */
  appliedStdRemHistoryId?: string | null;
}

/** 源泉所得税の計算前提スナップショット。 */
export interface PayrollTaxSnapshot {
  /** 適用した税額表の年分（例: 2026 = 令和8年分） */
  taxYear: number;
  /** 適用した税額表の欄区分 */
  taxCategory: TaxCategory;
  /** 計算に使用した源泉控除対象親族の数（V1 は常に 0） */
  dependentCount: number;
}

// ─────────────────────────────────────────────
// 賞与（賞与回 / 賞与確定レコード）
//
// 月次給与とは独立したエンティティ。賞与は月次の PayrollResult /
// timecard 等の構造には一切混在させない（賞与専用の DB キーで永続化）。
//   - mock_bonusRunDB:    BonusRun[]    （賞与の支給回。支給日＋名称）
//   - mock_bonusResultDB: BonusResult[] （従業員×賞与回の確定スナップショット）
// ─────────────────────────────────────────────

export type BonusRunStatus = "draft" | "locked";

/** 賞与の支給回（例: 2026年 夏季賞与）。月次給与とは独立。 */
export interface BonusRun {
  tenantId: string;
  id: string;              // `br_${YYYYMMDD}_${seq}` 等の一意ID
  name: string;            // 例: "2026年 夏季賞与"
  paymentDate: string;     // 支給日 "YYYY-MM-DD"（前月給与の特定・料率引き当てに使用）
  status: BonusRunStatus;  // draft=編集可 / locked=全従業員確定済み
  createdAt: string;       // ISO8601
  // 賞与回作成時点の対象従業員IDスナップショット。以降に従業員を追加・削除しても
  // この賞与回の対象（＝全員確定判定の母集団）は固定される。
  employeeIds: string[];
}

export type BonusResultStatus = "draft" | "locked";

/** 賞与源泉所得税の計算方式（算出率表 / 特例1 / 特例2）。 */
export type BonusTaxMethodSnapshot = "rate-table" | "special-no-prev-salary" | "special-over-10x";

/**
 * 賞与計算時に引き当てた料率・前提のスナップショット。
 * 確定後に料率マスタが変わっても帳票が確定値を再現できるよう保持する。
 */
export interface BonusAppliedRatesSnapshot {
  prefecture: string;
  /** 料率引き当てに使った年月 "YYYY-MM"（支給日の年月） */
  targetYearMonth: string;
  healthInsuranceRate: number;
  nursingCareInsuranceRate: number;
  pensionInsuranceRate: number;
  childcareSupportRate: number;
  employmentInsuranceEmployeeRate: number;
  /** 源泉所得税の計算方式 */
  taxMethod: BonusTaxMethodSnapshot;
  /** 算出率表を使った場合の率(%)。特例の場合は null。 */
  bonusTaxRate: number | null;
  /** 率引き当て／特例判定に使った前月の社保控除後給与（円） */
  prevMonthSalaryAfterSocialInsurance: number;
  /** 前月給与情報が暫定（前月分が未ロックで現マスタから再計算）か */
  prevMonthProvisional: boolean;
}

/** 従業員×賞与回の確定スナップショット。 */
export interface BonusResult {
  tenantId: string;
  id: string;                   // `bres_${bonusRunId}_${employeeId}`
  bonusRunId: string;
  employeeId: string;
  status: BonusResultStatus;
  grossBonus: number;           // 賞与総支給額（社会保険料控除前）
  standardBonusAmount: number;  // 標準賞与額（1,000円未満切捨て）
  /** 健保系（健康・介護・支援金）の標準賞与額。年度573万円累計でカット後 */
  healthBaseStandardBonus: number;
  /** 厚年系の標準賞与額。1回150万円でカット後 */
  pensionBaseStandardBonus: number;
  healthInsurance: number;      // 健康保険料（被保険者負担）
  nursingCare: number;          // 介護保険料（第2号該当のみ）
  childSupport: number;         // 子ども子育て支援金（被保険者負担）
  pension: number;              // 厚生年金保険料（被保険者負担）
  employmentInsurance: number;  // 雇用保険料（賞与総額ベース）
  incomeTax: number;            // 賞与の源泉所得税（住民税は賞与にかからない）
  socialInsuranceTotal: number; // 社会保険料（被保険者負担）合計
  totalDeduction: number;       // 控除合計
  netBonus: number;             // 差引支給額
  lockedAt: string | null;      // ISO8601。draft は null
  /** 計算時に引き当てた料率・前提のスナップショット */
  appliedRates: BonusAppliedRatesSnapshot;
}

// ─────────────────────────────────────────────
// 職場マスタ DB
// ─────────────────────────────────────────────

/** 主要都道府県（社会保険料率の都道府県別計算用 — モックアップでは主要数件のみ） */
export const PREFECTURE_OPTIONS = [
  "東京都",
  "神奈川県",
  "埼玉県",
  "千葉県",
  "大阪府",
  "愛知県",
  "京都府",
  "兵庫県",
  "福岡県",
  "北海道",
] as const;

export interface WorkplaceDef {
  tenantId: string;                 // マルチテナント識別子
  id: string;                       // 'w1', 'w2', 'wp_xxx'
  name: string;                     // 職場名
  color: string;                    // Tailwind classes
  prefecture: string;               // 都道府県（社会保険料率の都道府県別計算用）
  defaultStartTime: string;         // 所定始業 "09:00"
  defaultEndTime: string;           // 所定終業 "18:00"
  defaultRestMinutes: number;       // 既定休憩(分)
  roundingRule: RoundingType;
  legalHoliday: DayOfWeek;          // 法定休日(週1日)
  scheduledHoliday: DayOfWeek[];    // 所定休日
  includeEarlyOvertime: boolean;    // 始業前の打刻を朝残業として算入するか
  applyLateNightPremium: boolean;   // 22:00以降の深夜割増を適用するか
}

export const DEFAULT_WORKPLACES: Record<string, WorkplaceDef> = {
  w1: {
    tenantId: DEFAULT_TENANT_ID,
    id: "w1", name: "職場A",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    prefecture: "東京都",
    defaultStartTime: "09:00", defaultEndTime: "18:00",
    defaultRestMinutes: 60, roundingRule: "1min",
    legalHoliday: "Sunday", scheduledHoliday: ["Saturday"],
    includeEarlyOvertime: false, applyLateNightPremium: true,
  },
  w2: {
    tenantId: DEFAULT_TENANT_ID,
    id: "w2", name: "職場B",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    prefecture: "神奈川県",
    defaultStartTime: "10:00", defaultEndTime: "19:00",
    defaultRestMinutes: 45, roundingRule: "15min",
    legalHoliday: "Sunday", scheduledHoliday: ["Saturday"],
    includeEarlyOvertime: true, applyLateNightPremium: true,
  },
};

// 事業所ごとの既定時給（モックアップのシード値）。時給制シミュレーターの初期表示に使用。
export const DEFAULT_HOURLY_RATES: Record<string, number> = {
  w1: 1200,
  w2: 1300,
};

// 事業所ごとの既定日給（モックアップのシード値）。日給制シミュレーターの初期表示に使用。
export const DEFAULT_DAILY_RATES: Record<string, number> = {
  w1: 10000,
  w2: 12000,
};

// ─────────────────────────────────────────────
// 手当（支給項目）
// 時給制シミュレーターで総支給額に加算する手当項目。
// 通勤手当・役職手当などを従業員/月 単位で localStorage に永続化する。
// ─────────────────────────────────────────────
export interface AllowanceItem {
  id: string;
  /** 手当の種類（例: 通勤手当・役職手当） */
  type: string;
  /** 課税額（円）。所得税の課税ベースに含める金額。 */
  taxableAmount: number;
  /**
   * 非課税額（円）。所得税の課税ベースから除く金額（例: 通勤手当の非課税部分）。
   * 非課税限度額の上限判定はシステムでは行わない。金額の妥当性は
   * 入力者（給与担当者）の責任とする。
   */
  nonTaxableAmount: number;
}

/** 手当1件の支給額（課税額＋非課税額）。 */
export function allowanceTotal(a: AllowanceItem): number {
  return (a.taxableAmount || 0) + (a.nonTaxableAmount || 0);
}

/** 手当リストの支給額合計。 */
export function allowancesSum(items: AllowanceItem[]): number {
  return items.reduce((s, a) => s + allowanceTotal(a), 0);
}

/** 手当リストの非課税額合計（所得税の課税ベースから除く金額）。 */
export function nonTaxableAllowancesSum(items: AllowanceItem[]): number {
  return items.reduce((s, a) => s + (a.nonTaxableAmount || 0), 0);
}

/** 手当の種類プリセット（入力補助用のサジェスト候補） */
export const ALLOWANCE_TYPE_PRESETS = [
  "通勤手当",
  "役職手当",
  "資格手当",
  "住宅手当",
  "家族手当",
  "皆勤手当",
  "その他手当",
] as const;

/** 旧形式（〜v2）の手当レコード。localStorage 上のレガシーデータ読込にのみ使用。 */
interface LegacyAllowanceItem {
  id: string;
  type: string;
  amount: number;
  taxable?: boolean;
  taxableTouched?: boolean;
}

/**
 * 手当 1件を正規化する（旧データ migration）。
 * - 新形式（taxableAmount / nonTaxableAmount）はそのまま返す。
 * - 旧形式（amount + taxable フラグ）は、保存済みの taxable フラグに従って
 *   全額を課税額または非課税額に振り分ける。フラグ未設定の最古データのみ、
 *   旧仕様の既定値（種類名に「通勤」を含む＝非課税）を移行時に限り適用する。
 *   ※ 名称による課税/非課税判定は移行処理以外では行わない。
 */
export function normalizeAllowance(
  a: Partial<AllowanceItem> & Partial<LegacyAllowanceItem> & { id: string; type: string },
): AllowanceItem {
  if (typeof a.taxableAmount === "number" || typeof a.nonTaxableAmount === "number") {
    return {
      id: a.id,
      type: a.type,
      taxableAmount: a.taxableAmount || 0,
      nonTaxableAmount: a.nonTaxableAmount || 0,
    };
  }
  const amount = typeof a.amount === "number" ? a.amount : 0;
  const legacyTaxable =
    typeof a.taxable === "boolean" ? a.taxable : !a.type.includes("通勤");
  return {
    id: a.id,
    type: a.type,
    taxableAmount: legacyTaxable ? amount : 0,
    nonTaxableAmount: legacyTaxable ? 0 : amount,
  };
}

export const NEW_WORKPLACE_COLORS = [
  "text-pink-600 bg-pink-50 border-pink-200",
  "text-emerald-600 bg-emerald-50 border-emerald-200",
  "text-orange-600 bg-orange-50 border-orange-200",
  "text-cyan-600 bg-cyan-50 border-cyan-200",
  "text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200",
];

// ─────────────────────────────────────────────
// 従業員マスタ（月が変わっても変化しない情報）
// ─────────────────────────────────────────────

export interface EmployeeRecord {
  id: string;
  employeeNumber: string;
  name: string;
  department: string;
  position: string;
  joinDate: string;
  status: EmployeeStatus;
  avatarUrl?: string;
  color: EmployeeColor;
}

// ─────────────────────────────────────────────
// 給与レコード
// ─────────────────────────────────────────────

export interface PayrollRecord {
  id: string;
  employeeId: string;
  name: string;
  baseSalary: number;
  allowances: number;
  deductions: number;
  netPay: number;
  status: PayrollStatus;
}

// ─────────────────────────────────────────────
// タイムカード打刻エントリ（月次トランザクション）
// キー: `${employeeId}_${year}_${month}`
// ─────────────────────────────────────────────

export interface TimecardEntry {
  tenantId: string;          // マルチテナント識別子
  id: string;
  date: string;              // 表示用ラベル "3/2（月）" など
  year: number;
  month: number;             // 1〜12
  ocrStatus: TimecardOcrStatus;
  ocrStart: string;          // OCR読取開始 "08:55"（errorのとき空文字）
  ocrEnd: string;            // OCR読取終了（同上）
  stdStart: string;          // 計上開始（丸め後）"09:00"（errorのとき"--:--"）
  stdEnd: string;            // 計上終了（同上）
  /** 休憩時間が手動編集されたか（マスタ既定値との差分判定の代替） */
  isRestManuallyEdited: boolean;
}

// ─────────────────────────────────────────────
// ダミーデータ生成ヘルパー
// ─────────────────────────────────────────────

function entry(
  id: string, date: string, year: number, month: number,
  ocrStart: string, ocrEnd: string, stdStart: string, stdEnd: string,
  ocrStatus: TimecardOcrStatus = "success"
): TimecardEntry {
  return {
    tenantId: DEFAULT_TENANT_ID,
    id, date, year, month, ocrStatus, ocrStart, ocrEnd, stdStart, stdEnd,
    isRestManuallyEdited: false,
  };
}

function errorEntry(id: string, date: string, year: number, month: number): TimecardEntry {
  return {
    tenantId: DEFAULT_TENANT_ID,
    id, date, year, month, ocrStatus: "error",
    ocrStart: "", ocrEnd: "", stdStart: "--:--", stdEnd: "--:--",
    isRestManuallyEdited: false,
  };
}

// ─────────────────────────────────────────────
// 月次タイムカードデータ（全従業員）
// ─────────────────────────────────────────────

export const DUMMY_TIMECARD_DATA: Record<string, TimecardEntry[]> = {

  // ── 山田 太郎（e1）──
  "e1_2026_3": [
    entry("e1_3_1", "3/2（月）", 2026, 3, "08:58", "17:45", "09:00", "17:45"),
    entry("e1_3_2", "3/3（火）", 2026, 3, "09:02", "18:30", "09:02", "18:30"),
    entry("e1_3_3", "3/4（水）", 2026, 3, "08:47", "18:00", "09:00", "18:00"),
    entry("e1_3_4", "3/5（木）", 2026, 3, "09:00", "19:15", "09:00", "19:15"),
    entry("e1_3_5", "3/6（金）", 2026, 3, "08:55", "17:30", "09:00", "17:30"),
  ],
  "e1_2026_4": [
    entry("e1_4_1", "4/1（火）", 2026, 4, "08:55", "18:00", "09:00", "18:00"),
    errorEntry("e1_4_2", "4/2（水）", 2026, 4),
    entry("e1_4_3", "4/3（木）", 2026, 4, "09:00", "17:30", "09:00", "17:30"),
    entry("e1_4_4", "4/4（金）", 2026, 4, "08:51", "19:30", "09:00", "19:30"),
  ],

  // ── 鈴木 花子（e2）──
  "e2_2026_3": [
    entry("e2_3_1", "3/2（月）", 2026, 3, "09:00", "18:05", "09:00", "18:05"),
    entry("e2_3_2", "3/3（火）", 2026, 3, "08:52", "17:45", "09:00", "17:45"),
    entry("e2_3_3", "3/4（水）", 2026, 3, "09:01", "18:00", "09:01", "18:00"),
    entry("e2_3_4", "3/5（木）", 2026, 3, "09:00", "18:30", "09:00", "18:30"),
  ],
  "e2_2026_4": [
    entry("e2_4_1", "4/1（火）", 2026, 4, "08:59", "18:00", "09:00", "18:00"),
    entry("e2_4_2", "4/2（水）", 2026, 4, "09:00", "17:30", "09:00", "17:30"),
    entry("e2_4_3", "4/3（木）", 2026, 4, "08:50", "18:15", "09:00", "18:15"),
    entry("e2_4_4", "4/4（金）", 2026, 4, "09:05", "18:00", "09:05", "18:00"),
    entry("e2_4_5", "4/7（月）", 2026, 4, "09:00", "19:00", "09:00", "19:00"),
  ],

  // ── 田中 一郎（e3）──
  "e3_2026_3": [
    entry("e3_3_1", "3/2（月）", 2026, 3, "08:45", "18:00", "09:00", "18:00"),
    errorEntry("e3_3_2", "3/3（火）", 2026, 3),
    entry("e3_3_3", "3/4（水）", 2026, 3, "09:00", "20:00", "09:00", "20:00"),
    entry("e3_3_4", "3/5（木）", 2026, 3, "08:58", "18:00", "09:00", "18:00"),
    entry("e3_3_5", "3/6（金）", 2026, 3, "09:00", "17:30", "09:00", "17:30"),
  ],
  "e3_2026_4": [
    entry("e3_4_1", "4/1（火）", 2026, 4, "08:55", "18:00", "09:00", "18:00"),
    entry("e3_4_2", "4/2（水）", 2026, 4, "09:00", "18:30", "09:00", "18:30"),
    entry("e3_4_3", "4/3（木）", 2026, 4, "08:48", "17:55", "09:00", "17:55"),
    entry("e3_4_4", "4/4（金）", 2026, 4, "09:00", "18:00", "09:00", "18:00"),
  ],

  // ── 伊藤 美咲（e4）──
  "e4_2026_3": [
    entry("e4_3_1", "3/2（月）", 2026, 3, "09:00", "17:30", "09:00", "17:30"),
    entry("e4_3_2", "3/3（火）", 2026, 3, "08:57", "18:00", "09:00", "18:00"),
    entry("e4_3_3", "3/4（水）", 2026, 3, "09:00", "17:45", "09:00", "17:45"),
    entry("e4_3_4", "3/6（金）", 2026, 3, "09:00", "18:00", "09:00", "18:00"),
  ],
  "e4_2026_4": [
    entry("e4_4_1", "4/1（火）", 2026, 4, "08:56", "18:00", "09:00", "18:00"),
    entry("e4_4_2", "4/2（水）", 2026, 4, "09:00", "17:30", "09:00", "17:30"),
    errorEntry("e4_4_3", "4/3（木）", 2026, 4),
    entry("e4_4_4", "4/4（金）", 2026, 4, "08:52", "19:00", "09:00", "19:00"),
  ],

  // ── 渡辺 健一（e5）──
  "e5_2026_3": [
    entry("e5_3_1", "3/2（月）", 2026, 3, "09:00", "18:00", "09:00", "18:00"),
    entry("e5_3_2", "3/3（火）", 2026, 3, "08:50", "19:00", "09:00", "19:00"),
    entry("e5_3_3", "3/4（水）", 2026, 3, "09:00", "18:30", "09:00", "18:30"),
    entry("e5_3_4", "3/5（木）", 2026, 3, "09:02", "17:45", "09:02", "17:45"),
    entry("e5_3_5", "3/6（金）", 2026, 3, "08:59", "18:00", "09:00", "18:00"),
  ],
  "e5_2026_4": [
    entry("e5_4_1", "4/1（火）", 2026, 4, "09:00", "18:00", "09:00", "18:00"),
    entry("e5_4_2", "4/2（水）", 2026, 4, "08:53", "19:15", "09:00", "19:15"),
    entry("e5_4_3", "4/3（木）", 2026, 4, "09:00", "17:30", "09:00", "17:30"),
    errorEntry("e5_4_4", "4/4（金）", 2026, 4),
    entry("e5_4_5", "4/7（月）", 2026, 4, "09:00", "18:00", "09:00", "18:00"),
  ],
};

// ─────────────────────────────────────────────
// 月次タイムカードデータを取得するヘルパー
// ─────────────────────────────────────────────

export function getTimecardEntries(
  employeeId: string,
  year: number,
  month: number
): TimecardEntry[] {
  return DUMMY_TIMECARD_DATA[`${employeeId}_${year}_${month}`] ?? [];
}

// ─────────────────────────────────────────────
// 既存ダミーデータ
// ─────────────────────────────────────────────

export const DUMMY_PAYROLL_DATA: PayrollRecord[] = [
  { id: "p1", employeeId: "e1", name: "山田 太郎", baseSalary: 300000, allowances: 30000, deductions: 60000, netPay: 270000, status: "確定済み" },
  { id: "p2", employeeId: "e2", name: "鈴木 花子", baseSalary: 280000, allowances: 20000, deductions: 55000, netPay: 245000, status: "確定済み" },
  { id: "p3", employeeId: "e3", name: "田中 一郎", baseSalary: 320000, allowances: 40000, deductions: 70000, netPay: 290000, status: "未確定" },
  { id: "p4", employeeId: "e4", name: "伊藤 美咲", baseSalary: 260000, allowances: 15000, deductions: 50000, netPay: 225000, status: "確定済み" },
  { id: "p5", employeeId: "e5", name: "渡辺 健一", baseSalary: 350000, allowances: 50000, deductions: 85000, netPay: 315000, status: "未確定" },
];

export const DUMMY_EMPLOYEE_DATA: EmployeeRecord[] = [
  { id: "e1", employeeNumber: "EMP001", name: "山田 太郎", department: "営業部", position: "主任", joinDate: "2019年04月01日", status: "在籍中", color: "blue" },
  { id: "e2", employeeNumber: "EMP002", name: "鈴木 花子", department: "人事部", position: "リーダー", joinDate: "2020年07月15日", status: "在籍中", color: "green" },
  { id: "e3", employeeNumber: "EMP003", name: "田中 一郎", department: "開発部", position: "マネージャー", joinDate: "2018年01月10日", status: "在籍中", color: "rose" },
  { id: "e4", employeeNumber: "EMP004", name: "伊藤 美咲", department: "マーケティング部", position: "スタッフ", joinDate: "2022年10月01日", status: "在籍中", color: "amber" },
  { id: "e5", employeeNumber: "EMP005", name: "渡辺 健一", department: "経理部", position: "リーダー", joinDate: "2017年06月01日", status: "在籍中", color: "purple" },
];
