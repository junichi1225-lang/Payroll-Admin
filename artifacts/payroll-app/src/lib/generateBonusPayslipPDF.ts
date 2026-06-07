// 賞与明細PDF生成。
//
// 確定（ロック）済みの賞与スナップショット（BonusResult）から、従業員ごとの
// 賞与明細を1つのPDFにまとめて生成しダウンロードする。月次の給与明細とは別様式。
// 住民税は賞与にはかからないため控除項目に含めない。

import { downloadHtmlSectionsAsPdf } from "./pdf/htmlToPdf";

/** 賞与明細1人分の入力データ（確定スナップショット由来）。 */
export interface BonusPayslipEmployeeData {
  employeeNumber: string;
  employeeName: string;
  /** 賞与総支給額 */
  grossBonus: number;
  /** 標準賞与額（1,000円未満切捨て） */
  standardBonusAmount: number;
  /** 控除内訳 */
  deductions: {
    health: number;
    nursingCare: number;
    pension: number;
    childSupport: number;
    employment: number;
    incomeTax: number;
    total: number;
  };
  /** 差引支給額 */
  netBonus: number;
}

export interface GenerateBonusPayslipPDFInput {
  companyName: string;
  /** 賞与回名称（例: 2026年 夏季賞与） */
  bonusName: string;
  /** 支給日 "YYYY-MM-DD" */
  paymentDate: string;
  employees: BonusPayslipEmployeeData[];
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "YYYY-MM-DD" → "YYYY年MM月DD日" */
function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y}年${m}月${d}日`;
}

function deductionRows(emp: BonusPayslipEmployeeData): string {
  const d = emp.deductions;
  const items: [string, number][] = [
    ["健康保険料", d.health],
    ["介護保険料", d.nursingCare],
    ["厚生年金保険料", d.pension],
    ["子ども・子育て拠出金", d.childSupport],
    ["雇用保険料", d.employment],
    ["源泉所得税", d.incomeTax],
  ];
  return items
    .map(
      ([label, val]) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${label}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${val > 0 ? `-${yen(val)}` : yen(0)}</td></tr>`,
    )
    .join("");
}

function bonusPayslipSection(
  companyName: string,
  bonusName: string,
  paymentDate: string,
  emp: BonusPayslipEmployeeData,
): string {
  return `
<div style="padding:28px 32px;font-size:13px;line-height:1.6;color:#0f172a;box-sizing:border-box;width:100%;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:18px;">
    <div>
      <div style="font-size:20px;font-weight:700;">賞与明細書</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">${escapeHtml(bonusName)}（支給日：${formatDate(paymentDate)}）</div>
    </div>
    <div style="text-align:right;font-size:12px;color:#475569;">
      <div style="font-weight:700;color:#0f172a;font-size:14px;">${escapeHtml(companyName)}</div>
    </div>
  </div>

  <div style="display:flex;gap:24px;margin-bottom:18px;font-size:13px;">
    <div><span style="color:#64748b;">従業員番号：</span>${escapeHtml(emp.employeeNumber)}</div>
    <div><span style="color:#64748b;">氏名：</span><span style="font-weight:700;">${escapeHtml(emp.employeeName)} 様</span></div>
  </div>

  <div style="display:flex;gap:20px;align-items:stretch;">
    <div style="flex:1;">
      <div style="background:#f1f5f9;font-weight:700;padding:6px 10px;border:1px solid #e2e8f0;">支給</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none;">
        <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">賞与</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${yen(emp.grossBonus)}</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;">（標準賞与額）</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;color:#64748b;">${yen(emp.standardBonusAmount)}</td></tr>
        <tr><td style="padding:8px 10px;font-weight:700;background:#f8fafc;">総支給額</td><td style="padding:8px 10px;text-align:right;font-weight:700;background:#f8fafc;">${yen(emp.grossBonus)}</td></tr>
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
      <span style="font-size:22px;font-weight:700;">${yen(emp.netBonus)}</span>
    </div>
  </div>

  <div style="margin-top:24px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px;">
    本明細は確定（ロック）時点のスナップショットに基づいて作成されています。住民税は賞与にはかかりません。
  </div>
</div>`;
}

/**
 * 全従業員分の賞与明細をまとめたPDFを生成しダウンロードする。
 * @returns 生成したPDFのファイル名
 */
export async function generateBonusPayslipPDF(input: GenerateBonusPayslipPDFInput): Promise<string> {
  const sections = input.employees.map((emp) =>
    bonusPayslipSection(input.companyName, input.bonusName, input.paymentDate, emp),
  );
  const compact = input.paymentDate.replace(/-/g, "");
  const filename = `賞与明細_${compact}.pdf`;
  await downloadHtmlSectionsAsPdf(sections, filename, "portrait");
  return filename;
}
