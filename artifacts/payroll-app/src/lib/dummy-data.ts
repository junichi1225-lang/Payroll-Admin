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
}

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
  },
  w2: {
    tenantId: DEFAULT_TENANT_ID,
    id: "w2", name: "職場B",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    prefecture: "神奈川県",
    defaultStartTime: "10:00", defaultEndTime: "19:00",
    defaultRestMinutes: 45, roundingRule: "15min",
    legalHoliday: "Sunday", scheduledHoliday: ["Saturday"],
  },
};

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
