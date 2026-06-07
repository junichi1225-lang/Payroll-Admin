// オフDOMの HTML を html2canvas-pro → jsPDF で PDF 化する共通ヘルパー。
//
// 【設計方針】
// - 日本語フォントの埋め込みは行わない。html2canvas がブラウザのレンダリング結果を
//   そのままビットマップ化するため、フォント埋め込み無しで日本語が正しく描画される
//   （PayrollTab.downloadElementAsPdf と同一の方針）。
// - 各セクション（給与明細の従業員1人分など）を 1 つ以上のページに割り付け、
//   1 つの jsPDF にまとめて出力する。

import type { jsPDF as JsPdf } from "jspdf";

export type PdfOrientation = "portrait" | "landscape";

/** A4 のおおよそのピクセル幅（96dpi 換算）。レンダリング用コンテナの幅に使う。 */
const A4_PX_WIDTH: Record<PdfOrientation, number> = {
  portrait: 794, // 210mm @ 96dpi
  landscape: 1123, // 297mm @ 96dpi
};

/** HTML 文字列をオフDOMに描画し、html2canvas でキャプチャした canvas を返す。 */
async function captureHtml(
  html: string,
  orientation: PdfOrientation,
): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas-pro");

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-100000px";
  container.style.top = "0";
  container.style.width = `${A4_PX_WIDTH[orientation]}px`;
  container.style.background = "#ffffff";
  container.style.color = "#0f172a";
  container.style.fontFamily =
    '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    return await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
  } finally {
    document.body.removeChild(container);
  }
}

/** 1 枚の canvas を A4 ページ（複数ページ対応）として pdf に追加する。 */
function addCanvasAsPages(pdf: JsPdf, canvas: HTMLCanvasElement): void {
  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * usableWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;
  pdf.addImage(imgData, "JPEG", margin, position, usableWidth, imgHeight);
  heightLeft -= pageHeight - margin * 2;
  while (heightLeft > 0) {
    position = heightLeft - imgHeight + margin;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
  }
}

/**
 * 複数の HTML セクションを 1 つの PDF にまとめて生成しダウンロードする。
 * 各セクションは新しいページから開始する（給与明細の従業員 1 人 = 1 セクション）。
 */
export async function downloadHtmlSectionsAsPdf(
  sections: string[],
  filename: string,
  orientation: PdfOrientation = "portrait",
): Promise<void> {
  if (sections.length === 0) return;
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation });

  for (let i = 0; i < sections.length; i++) {
    if (i > 0) pdf.addPage();
    const canvas = await captureHtml(sections[i], orientation);
    // addCanvasAsPages は内部で必要に応じて addPage するが、最初の 1 ページは
    // 既存ページ（上で addPage 済み / 初期ページ）に描画する。
    addCanvasAsPages(pdf, canvas);
  }

  pdf.save(filename);
}
