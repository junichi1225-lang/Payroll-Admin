// 給与明細PDF生成。
//
// 確定（ロック）済みの給与スナップショットから、従業員ごとの給与明細を
// 1 つの PDF（従業員 1 人 = 1 ページ以上）にまとめて生成しダウンロードする。
// 日本語は html2canvas のレンダリング結果をそのまま画像化するため、
// フォント埋め込み無しで正しく描画される（htmlToPdf 参照）。

import { downloadHtmlSectionsAsPdf } from "./pdf/htmlToPdf";

/** 給与明細 1 人分の入力データ（確定スナップショット由来）。 */
export interface PayslipEmployeeData {
  employeeNumber: string;
  employeeName: string;
  /** 給与形態ラベル（月給/日給/時給） */
  salaryType: string;
  /** 基本給（適用単価） */
  baseSalary: number;
  /** 手当一覧 */
  allowances: { type: string; amount: number }[];
  /** 総支給額 */
  totalPayment: number;
  /** 控除内訳 */
  deductions: {
    health: number;
    nursingCare: number;
    pension: number;
    childcare: number;
    labor: number;
    incomeTax: number;
    residentTax: number;
    total: number;
    isNursingCareTarget: boolean;
  };
  /** 差引支給額 */
  netPay: number;
}

export interface GeneratePayslipPDFInput {
  companyName: string;
  /** 対象年月 "YYYY-MM" */
  yearMonth: string;
  employees: PayslipEmployeeData[];
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

/** "YYYY-MM" → "YYYY年MM月" */
function formatYearMonth(yyyymm: string): { year: string; month: string; label: string } {
  const [y, m] = yyyymm.split("-");
  return { year: y, month: m, label: `${y}年${m}月` };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 支給項目テーブルの行 HTML。 */
function paymentRows(emp: PayslipEmployeeData): string {
  const rows: string[] = [
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">基本給</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${yen(emp.baseSalary)}</td></tr>`,
  ];
  for (const a of emp.allowances) {
    rows.push(
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${escapeHtml(a.type || "手当")}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${yen(a.amount)}</td></tr>`,
    );
  }
  return rows.join("");
}

/** 控除項目テーブルの行 HTML。 */
function deductionRows(emp: PayslipEmployeeData): string {
  const d = emp.deductions;
  const items: [string, number][] = [
    ["健康保険料", d.health],
    ["介護保険料", d.nursingCare],
    ["厚生年金保険料", d.pension],
    ["子ども・子育て拠出金", d.childcare],
    ["雇用保険料", d.labor],
    ["所得税", d.incomeTax],
    ["住民税", d.residentTax],
  ];
  return items
    .map(
      ([label, val]) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${label}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${val > 0 ? `-${yen(val)}` : yen(0)}</td></tr>`,
    )
    .join("");
}

/** 給与明細 1 人分の HTML セクション。 */
function payslipSection(companyName: string, yyyymm: string, emp: PayslipEmployeeData): string {
  const ym = formatYearMonth(yyyymm);
  return `
<div style="padding:28px 32px;font-size:13px;line-height:1.6;color:#0f172a;box-sizing:border-box;width:100%;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:18px;">
    <div>
      <div style="font-size:20px;font-weight:700;">給与明細書</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">${ym.label}分</div>
    </div>
    <div style="text-align:right;font-size:12px;color:#475569;">
      <div style="font-weight:700;color:#0f172a;font-size:14px;">${escapeHtml(companyName)}</div>
    </div>
  </div>

  <div style="display:flex;gap:24px;margin-bottom:18px;font-size:13px;">
    <div><span style="color:#64748b;">従業員番号：</span>${escapeHtml(emp.employeeNumber)}</div>
    <div><span style="color:#64748b;">氏名：</span><span style="font-weight:700;">${escapeHtml(emp.employeeName)} 様</span></div>
    <div><span style="color:#64748b;">給与形態：</span>${escapeHtml(emp.salaryType)}</div>
  </div>

  <div style="display:flex;gap:20px;align-items:stretch;">
    <div style="flex:1;">
      <div style="background:#f1f5f9;font-weight:700;padding:6px 10px;border:1px solid #e2e8f0;">支給</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none;">
        ${paymentRows(emp)}
        <tr><td style="padding:8px 10px;font-weight:700;background:#f8fafc;">総支給額</td><td style="padding:8px 10px;text-align:right;font-weight:700;background:#f8fafc;">${yen(emp.totalPayment)}</td></tr>
      </table>
    </div>
    <div style="flex:1;">
      <div style="background:#f1f5f9;font-weight:700;padding:6px 10px;border:1px solid #e2e8f0;">控除</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none;">
        ${deductionRows(emp)}
        <tr><td style="padding:8px 10px;font-weight:700;background:#f8fafc;">控除合計</td><td style="padding:8px 10px;text-align:right;font-weight:700;background:#f8fafc;color:#b91c1c;">-${yen(emp.deductions.total)}</td></tr>
      </table>
    </div>
  </div>

  <div style="margin-top:20px;display:flex;justify-content:flex-end;">
    <div style="background:#0f172a;color:#ffffff;padding:12px 24px;border-radius:8px;display:flex;align-items:center;gap:16px;">
      <span style="font-size:13px;">差引支給額</span>
      <span style="font-size:22px;font-weight:700;">${yen(emp.netPay)}</span>
    </div>
  </div>

  <div style="margin-top:24px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px;">
    本明細は確定（ロック）時点のスナップショットに基づいて作成されています。
  </div>
</div>`;
}

/**
 * 全従業員分の給与明細をまとめた PDF を生成しダウンロードする。
 * @returns 生成した PDF のファイル名
 */
export async function generatePayslipPDF(input: GeneratePayslipPDFInput): Promise<string> {
  const ym = formatYearMonth(input.yearMonth);
  const sections = input.employees.map((emp) =>
    payslipSection(input.companyName, input.yearMonth, emp),
  );
  const filename = `給与明細_${ym.year}${ym.month}.pdf`;
  await downloadHtmlSectionsAsPdf(sections, filename, "portrait");
  return filename;
}
