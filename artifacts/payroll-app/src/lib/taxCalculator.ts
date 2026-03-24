/**
 * 給与所得の源泉徴収税額計算（甲欄・扶養親族0人）
 *
 * 国税庁「給与所得の源泉徴収税額表（月額表）」
 * 電算機計算の特例に基づく実装
 *
 * 計算手順:
 * 1. 月給 × 12 で年収換算
 * 2. 給与所得控除を差し引き「給与所得金額」を算出
 * 3. 基礎控除（48万円）を差し引き「課税所得金額」を算出
 * 4. 累進税率を適用して年間所得税を算出
 * 5. 復興特別所得税（2.1%）を加算
 * 6. 12で割り月額源泉徴収税額を算出
 */

/**
 * 給与所得控除額を計算する（令和6年分）
 * @param annualSalary 年収（円）
 */
function calcEmploymentIncomeDeduction(annualSalary: number): number {
  if (annualSalary <= 1_625_000) return 550_000;
  if (annualSalary <= 1_800_000) return Math.floor(annualSalary * 0.4) - 100_000;
  if (annualSalary <= 3_600_000) return Math.floor(annualSalary * 0.3) + 80_000;
  if (annualSalary <= 6_600_000) return Math.floor(annualSalary * 0.2) + 440_000;
  if (annualSalary <= 8_500_000) return Math.floor(annualSalary * 0.1) + 1_100_000;
  return 1_950_000;
}

/**
 * 基礎控除額を計算する（令和6年分）
 * @param annualSalary 年収（合計所得金額の近似値として使用）
 */
function calcBasicDeduction(annualSalary: number): number {
  if (annualSalary <= 24_000_000) return 480_000;
  if (annualSalary <= 24_500_000) return 320_000;
  if (annualSalary <= 25_000_000) return 160_000;
  return 0;
}

/**
 * 累進税率で所得税額（基本税額）を計算する
 * 所得税法別表第二「税率表」に基づく
 * @param taxableIncome 課税所得金額（円、千円未満切り捨て済み）
 */
function calcProgressiveTax(taxableIncome: number): number {
  if (taxableIncome <= 0)           return 0;
  if (taxableIncome <= 1_949_000)   return Math.floor(taxableIncome * 0.05);
  if (taxableIncome <= 3_299_000)   return Math.floor(taxableIncome * 0.10) - 97_500;
  if (taxableIncome <= 6_949_000)   return Math.floor(taxableIncome * 0.20) - 427_500;
  if (taxableIncome <= 8_999_000)   return Math.floor(taxableIncome * 0.23) - 636_000;
  if (taxableIncome <= 17_999_000)  return Math.floor(taxableIncome * 0.33) - 1_536_000;
  if (taxableIncome <= 39_999_000)  return Math.floor(taxableIncome * 0.40) - 2_796_000;
  return Math.floor(taxableIncome * 0.45) - 4_796_000;
}

/**
 * 月給から月額源泉徴収税額（甲欄・扶養親族0人）を計算する
 *
 * @param monthlySalary 月給（円）※社会保険料控除前の総支給額
 * @returns 源泉徴収税額（円）
 *
 * @example
 * calculateIncomeTax(300_000) // => 8,420 など
 */
export function calculateIncomeTax(monthlySalary: number): number {
  // 月額 88,000 円未満は源泉徴収なし（月額表の規定による）
  if (monthlySalary < 88_000) return 0;

  // ① 年収換算
  const annualSalary = monthlySalary * 12;

  // ② 給与所得控除額
  const employmentDeduction = calcEmploymentIncomeDeduction(annualSalary);

  // ③ 給与所得金額（1,000円未満切り捨て）
  const employmentIncome = Math.floor((annualSalary - employmentDeduction) / 1_000) * 1_000;

  // ④ 基礎控除額
  const basicDeduction = calcBasicDeduction(annualSalary);

  // ⑤ 課税所得金額（1,000円未満切り捨て）
  const taxableIncome = Math.max(0, Math.floor((employmentIncome - basicDeduction) / 1_000) * 1_000);

  // ⑥ 基本所得税額（累進税率）
  const baseTax = calcProgressiveTax(taxableIncome);

  // ⑦ 復興特別所得税を加算（2.1%）して年間税額確定（円未満切り捨て）
  const annualTax = Math.floor(baseTax * 1.021);

  // ⑧ 月額源泉徴収税額（円未満切り捨て）
  const monthlyTax = Math.floor(annualTax / 12);

  return monthlyTax;
}

/**
 * 実効税率（%）を返す
 * @param monthlySalary 月給（円）
 */
export function calcEffectiveRate(monthlySalary: number): number {
  if (monthlySalary <= 0) return 0;
  return (calculateIncomeTax(monthlySalary) / monthlySalary) * 100;
}
