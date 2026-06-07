// 給与一覧PDF生成（会計士・社労士への共有用）。
//
// 確定（ロック）済みの給与スナップショットから、全従業員の支給・控除・差引を
// 1 枚の一覧表（横向き A4）として PDF 生成しダウンロードする。
// 日本語はフォント埋め込み無しで描画される（htmlToPdf 参照）。

import { downloadHtmlSectionsAsPdf } from "./pdf/htmlToPdf";

/** 一覧 1 行分（従業員 1 人）の入力データ。 */
export interface PayrollSummaryRow {
  employeeNumber: string;
  name: string;
  totalPayment: number;
  health: number;
  nursingCare: number;
  pension: number;
  labor: number;
  incomeTax: number;
  residentTax: number;
  netPay: number;
}

export interface GeneratePayrollSummaryPDFInput {
  companyName: string;
  /** 対象年月 "YYYY-MM" */
  yearMonth: string;
  rows: PayrollSummaryRow[];
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

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

const TH =
  'style="padding:6px 8px;border:1px solid #cbd5e1;background:#f1f5f9;font-weight:700;font-size:11px;white-space:nowrap;"';
const TD =
  'style="padding:6px 8px;border:1px solid #e2e8f0;text-align:right;font-size:11px;white-space:nowrap;"';
const TD_L =
  'style="padding:6px 8px;border:1px solid #e2e8f0;text-align:left;font-size:11px;white-space:nowrap;"';

function summarySection(input: GeneratePayrollSummaryPDFInput): string {
  const ym = formatYearMonth(input.yearMonth);

  const totals = input.rows.reduce(
    (acc, r) => {
      acc.totalPayment += r.totalPayment;
      acc.health += r.health;
      acc.nursingCare += r.nursingCare;
      acc.pension += r.pension;
      acc.labor += r.labor;
      acc.incomeTax += r.incomeTax;
      acc.residentTax += r.residentTax;
      acc.netPay += r.netPay;
      return acc;
    },
    {
      totalPayment: 0,
      health: 0,
      nursingCare: 0,
      pension: 0,
      labor: 0,
      incomeTax: 0,
      residentTax: 0,
      netPay: 0,
    },
  );

  const bodyRows = input.rows
    .map(
      (r) => `
    <tr>
      <td ${TD_L}>${escapeHtml(r.employeeNumber)}</td>
      <td ${TD_L}>${escapeHtml(r.name)}</td>
      <td ${TD}>${yen(r.totalPayment)}</td>
      <td ${TD}>${yen(r.health)}</td>
      <td ${TD}>${yen(r.nursingCare)}</td>
      <td ${TD}>${yen(r.pension)}</td>
      <td ${TD}>${yen(r.labor)}</td>
      <td ${TD}>${yen(r.incomeTax)}</td>
      <td ${TD}>${yen(r.residentTax)}</td>
      <td ${TD}><strong>${yen(r.netPay)}</strong></td>
    </tr>`,
    )
    .join("");

  const totalTd =
    'style="padding:7px 8px;border:1px solid #cbd5e1;text-align:right;font-size:11px;font-weight:700;background:#f8fafc;white-space:nowrap;"';
  const totalTdL =
    'style="padding:7px 8px;border:1px solid #cbd5e1;text-align:left;font-size:11px;font-weight:700;background:#f8fafc;white-space:nowrap;"';

  return `
<div style="padding:24px 28px;font-size:12px;color:#0f172a;box-sizing:border-box;width:100%;">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0f172a;padding-bottom:10px;margin-bottom:16px;">
    <div>
      <div style="font-size:18px;font-weight:700;">給与支給一覧表</div>
      <div style="font-size:12px;color:#475569;margin-top:3px;">${ym.label}分</div>
    </div>
    <div style="text-align:right;font-size:13px;font-weight:700;">${escapeHtml(input.companyName)}</div>
  </div>

  <table style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        <th ${TH} style="padding:6px 8px;border:1px solid #cbd5e1;background:#f1f5f9;font-weight:700;font-size:11px;text-align:left;white-space:nowrap;">従業員番号</th>
        <th ${TH} style="padding:6px 8px;border:1px solid #cbd5e1;background:#f1f5f9;font-weight:700;font-size:11px;text-align:left;white-space:nowrap;">氏名</th>
        <th ${TH}>総支給額</th>
        <th ${TH}>健康保険料</th>
        <th ${TH}>介護保険料</th>
        <th ${TH}>厚生年金</th>
        <th ${TH}>雇用保険</th>
        <th ${TH}>所得税</th>
        <th ${TH}>住民税</th>
        <th ${TH}>差引支給額</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr>
        <td ${totalTdL} colspan="2">合計（${input.rows.length}名）</td>
        <td ${totalTd}>${yen(totals.totalPayment)}</td>
        <td ${totalTd}>${yen(totals.health)}</td>
        <td ${totalTd}>${yen(totals.nursingCare)}</td>
        <td ${totalTd}>${yen(totals.pension)}</td>
        <td ${totalTd}>${yen(totals.labor)}</td>
        <td ${totalTd}>${yen(totals.incomeTax)}</td>
        <td ${totalTd}>${yen(totals.residentTax)}</td>
        <td ${totalTd}>${yen(totals.netPay)}</td>
      </tr>
    </tbody>
  </table>

  <div style="margin-top:18px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px;">
    本一覧は確定（ロック）時点のスナップショットに基づいて作成されています。
  </div>
</div>`;
}

/**
 * 全従業員の給与一覧 PDF を生成しダウンロードする。
 * @returns 生成した PDF のファイル名
 */
export async function generatePayrollSummaryPDF(
  input: GeneratePayrollSummaryPDFInput,
): Promise<string> {
  const ym = formatYearMonth(input.yearMonth);
  const filename = `給与一覧_${ym.year}${ym.month}.pdf`;
  await downloadHtmlSectionsAsPdf([summarySection(input)], filename, "landscape");
  return filename;
}
