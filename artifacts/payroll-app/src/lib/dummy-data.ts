export type PayrollStatus = "確定済み" | "未確定";
export type EmployeeStatus = "在籍中" | "休職中" | "退職";
export type EmployeeColor = "blue" | "green" | "rose" | "amber" | "purple" | "teal";

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
