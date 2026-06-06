// マルチテナント識別子（DB移行時は認証コンテキストから取得）
export const DEFAULT_TENANT_ID = "tenant-1";

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
  taxCategory: TaxCategory;
  dependentsCount: number;
  isSocialInsurance: boolean;
  standardRemuneration: number;
  isEmploymentInsurance: boolean;
  /**
   * 住民税額（月額・円）
   * 自治体から届く特別徴収税額決定通知書の月額をそのまま登録する運用。
   * 前年所得が無い新卒・退職者等は 0 を設定する。
   */
  residentTax: number;
  /** 入社日 "YYYY-MM-DD"（給与計算の在籍判定に使用） */
  joinedDate: string;
  /** 退職日 "YYYY-MM-DD"（在籍中は null。退職月の社会保険料判定等に使用） */
  resignedDate: string | null;
}

/**
 * 従業員マスタの初期ダミーデータ。
 * モックアップ表示のため住民税額のみ予め設定済（その他は社員情報フォームから入力する想定）。
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
    isSocialInsurance: true, standardRemuneration: 320000,
    isEmploymentInsurance: true,
    residentTax: 14200,
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
    isSocialInsurance: true, standardRemuneration: 280000,
    isEmploymentInsurance: true,
    residentTax: 8500,
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
    isSocialInsurance: true, standardRemuneration: 380000,
    isEmploymentInsurance: true,
    residentTax: 21800,
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
    isSocialInsurance: true, standardRemuneration: 220000,
    isEmploymentInsurance: true,
    // 新卒入社のため前年所得なし → 1年目の住民税は 0
    residentTax: 0,
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
    isSocialInsurance: true, standardRemuneration: 420000,
    isEmploymentInsurance: true,
    residentTax: 26500,
    joinedDate: "2017-06-01", resignedDate: null,
  },
};

// ─────────────────────────────────────────────
// 契約・単価マスタ DB（職場別の給与契約）
// ─────────────────────────────────────────────
export interface ContractMaster {
  tenantId: string;
  id: string;
  employeeId: string;
  workplaceId: string;   // 既定契約は 'default'
  salaryType: SalaryType;
  baseSalary: number;
}

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
  /** 支給額（円） */
  amount: number;
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
