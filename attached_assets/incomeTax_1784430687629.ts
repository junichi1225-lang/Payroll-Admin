/**
 * 所得税（源泉徴収）計算モジュール — 令和8年分
 *
 * 【甲欄】月額表の甲欄を適用する給与等に対する源泉徴収税額の電算機計算の特例
 *         （平成24年3月31日財務省告示第116号 別表第一〜第四、
 *          令和7年4月30日財務省告示第123号改正）
 *   参照: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/denshi_01.pdf
 *
 * 【乙欄】TODO・未実装。
 *   乙欄には電算機特例の告示がなく、令和8年分月額表の乙欄列を
 *   そのままテーブル参照する必要がある（3,000円刻みの階級テーブル）。
 *   現状は105,000円未満の帯（3.063%）のみ暫定対応。
 *   参照: https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/all.pdf
 *
 * 【非課税通勤費】
 *   距離・手段別の上限判定はシステム側では行わない。
 *   非課税額はユーザー（給与担当者）が入力し、その妥当性の判定責任もユーザー側にある。
 *
 * 【端数処理】
 *   - 甲欄・電算機特例：税額は10円未満四捨五入（1円未満切り捨てではない点に注意）
 *   - 乙欄・賞与など、割合を直接乗じる方式：1円未満切り捨て
 */

// ============================================================
// 型定義
// ============================================================

export type TaxTableYear = 2026; // 令和8年分。将来年度分は同じ形で追加する

export interface IncomeTaxInput {
  /** その月の総支給額（基本給＋残業代＋各種手当のうち課税対象分の合計） */
  taxableAllowanceTotal: number;
  /** 通勤手当のうち非課税として扱う金額（ユーザー入力。上限判定・妥当性はユーザー責任） */
  nonTaxableCommutingAllowance: number;
  /** 控除する社会保険料等の合計（本人負担分：健保・介護・厚年・雇用保険・子ども子育て支援金） */
  socialInsuranceDeduction: number;
  /** 甲欄／乙欄の区分（社員マスタの自己申告に準ずる） */
  taxTableColumn: "kou" | "otsu";
  /** 源泉控除対象配偶者の有無（V1は常に false 固定でも可） */
  hasSpouseDeduction: boolean;
  /** 源泉控除対象親族の数（V1は常に 0 固定でも可） */
  dependentCount: number;
  /** 対象年度（支払日が属する年。所得税は支払日ベース） */
  taxYear: TaxTableYear;
}

export interface IncomeTaxResult {
  /** その月の社会保険料等控除後の給与等の金額（A） */
  amountAfterSocialInsurance: number;
  /** 課税給与所得金額（B）（甲欄のみ算出。乙欄は undefined） */
  taxableIncomeAmount?: number;
  /** 源泉徴収税額（復興特別所得税込み） */
  incomeTax: number;
  /** 計算に使用した方式 */
  method: "kou_denshi_tokurei" | "otsu_table_lookup_partial";
}

// ============================================================
// 令和8年分 電算機特例 マスタ（第1表〜第4表）
// ============================================================

const TABLE1_SALARY_INCOME_DEDUCTION_R8 = [
  { upTo: 158_333, calc: (_a: number) => 54_167 },
  { upTo: 299_999, calc: (a: number) => a * 0.3 + 6_667 },
  { upTo: 549_999, calc: (a: number) => a * 0.2 + 36_667 },
  { upTo: 708_330, calc: (a: number) => a * 0.1 + 91_667 },
  { upTo: Infinity, calc: (_a: number) => 162_500 },
] as const;

const TABLE2_SPOUSE_DEDUCTION_R8 = 31_667; // 配偶者控除・配偶者特別控除の額（一律）
const TABLE2_DEPENDENT_DEDUCTION_UNIT_R8 = 31_667; // 扶養控除の額（源泉控除対象親族1人あたり）

const TABLE3_BASIC_DEDUCTION_R8 = [
  { upTo: 2_120_833, amount: 48_334 },
  { upTo: 2_162_499, amount: 40_000 },
  { upTo: 2_204_166, amount: 26_667 },
  { upTo: 2_245_833, amount: 13_334 },
  { upTo: Infinity, amount: 0 },
] as const;

const TABLE4_TAX_RATE_R8 = [
  { upTo: 162_500, calc: (b: number) => b * 0.05105 },
  { upTo: 275_000, calc: (b: number) => b * 0.1021 - 8_296 },
  { upTo: 579_166, calc: (b: number) => b * 0.2042 - 36_374 },
  { upTo: 750_000, calc: (b: number) => b * 0.23483 - 54_113 },
  { upTo: 1_500_000, calc: (b: number) => b * 0.33693 - 130_688 },
  { upTo: 3_333_333, calc: (b: number) => b * 0.4084 - 237_893 },
  { upTo: Infinity, calc: (b: number) => b * 0.45945 - 408_061 },
] as const;

// ============================================================
// ヘルパー
// ============================================================

function lookupBracket<T extends { upTo: number }>(
  tables: readonly T[],
  amount: number
): T {
  const found = tables.find((t) => amount <= t.upTo);
  if (!found) {
    throw new Error(`税額表の区分が見つかりません: amount=${amount}`);
  }
  return found;
}

/** 10円未満四捨五入（電算機特例・第4表の注記による） */
function roundToNearest10(amount: number): number {
  return Math.round(amount / 10) * 10;
}

/** 1円未満切り捨て（乙欄・賞与など、割合を直接乗じる方式で使用） */
function floorYen(amount: number): number {
  return Math.floor(amount);
}

// ============================================================
// 甲欄：電算機計算の特例
// ============================================================

function calculateKouTax(
  amountAfterSI: number,
  hasSpouseDeduction: boolean,
  dependentCount: number
): { taxableIncomeAmount: number; incomeTax: number } {
  const a = amountAfterSI;

  // Step1: 給与所得控除額（第1表） ※1円未満端数は切り上げ
  const bracket1 = lookupBracket(TABLE1_SALARY_INCOME_DEDUCTION_R8, a);
  const salaryIncomeDeduction = Math.ceil(bracket1.calc(a));

  // Step2: 配偶者控除・扶養控除額（第2表）
  const spouseDeduction = hasSpouseDeduction ? TABLE2_SPOUSE_DEDUCTION_R8 : 0;
  const dependentDeduction = TABLE2_DEPENDENT_DEDUCTION_UNIT_R8 * dependentCount;

  // Step3: 基礎控除額（第3表）
  const bracket3 = lookupBracket(TABLE3_BASIC_DEDUCTION_R8, a);
  const basicDeduction = bracket3.amount;

  // Step4: 課税給与所得金額（B）
  const taxableIncomeAmount = Math.max(
    0,
    a - salaryIncomeDeduction - spouseDeduction - dependentDeduction - basicDeduction
  );

  // Step5: 税額（第4表）※10円未満四捨五入
  const bracket4 = lookupBracket(TABLE4_TAX_RATE_R8, taxableIncomeAmount);
  const rawTax = bracket4.calc(taxableIncomeAmount);
  const incomeTax = roundToNearest10(rawTax);

  return { taxableIncomeAmount, incomeTax };
}

// ============================================================
// 乙欄：暫定実装（105,000円未満のみ対応）
// ============================================================

function calculateOtsuTax(amountAfterSI: number): { incomeTax: number } {
  if (amountAfterSI < 105_000) {
    // 令和8年分月額表：105,000円未満の帯は「社保控除後金額×3.063%」（1円未満切り捨て）
    return { incomeTax: floorYen(amountAfterSI * 0.03063) };
  }
  // TODO: 105,000円以上の帯は令和8年分月額表・乙欄の階級テーブル（3,000円刻み）を
  // マスタ投入した上で実装する。電算機特例は乙欄には適用できないため算式化不可。
  throw new Error(
    "乙欄の105,000円以上の帯は未実装です。令和8年分月額表・乙欄のテーブルマスタ投入が必要です（別タスク）。"
  );
}

// ============================================================
// エントリーポイント
// ============================================================

export function calculateIncomeTax(input: IncomeTaxInput): IncomeTaxResult {
  const amountAfterSocialInsurance = Math.max(
    0,
    input.taxableAllowanceTotal -
      input.nonTaxableCommutingAllowance -
      input.socialInsuranceDeduction
  );

  if (input.taxTableColumn === "kou") {
    const { taxableIncomeAmount, incomeTax } = calculateKouTax(
      amountAfterSocialInsurance,
      input.hasSpouseDeduction,
      input.dependentCount
    );
    return {
      amountAfterSocialInsurance,
      taxableIncomeAmount,
      incomeTax,
      method: "kou_denshi_tokurei",
    };
  }

  const { incomeTax } = calculateOtsuTax(amountAfterSocialInsurance);
  return {
    amountAfterSocialInsurance,
    incomeTax,
    method: "otsu_table_lookup_partial",
  };
}

// ============================================================
// 検証用テスト（国税庁公表の計算例と、これまでの検討過程で使った例に基づく）
// ============================================================

function assertEqual(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    throw new Error(`❌ ${label}: 期待値=${expected}, 実際=${actual}`);
  }
  console.log(`✅ ${label}: ${actual}円`);
}

function runSelfTests() {
  // 例1（国税庁公表の計算例）：A=175,000円、配偶者あり・扶養親族1人 → 210円
  assertEqual(
    calculateIncomeTax({
      taxableAllowanceTotal: 175_000,
      nonTaxableCommutingAllowance: 0,
      socialInsuranceDeduction: 0,
      taxTableColumn: "kou",
      hasSpouseDeduction: true,
      dependentCount: 1,
      taxYear: 2026,
    }).incomeTax,
    210,
    "国税庁計算例1（A=175,000円・扶養2人相当）"
  );

  // 例2（国税庁公表の計算例）：A=446,000円、配偶者あり・扶養親族7人 → 940円
  assertEqual(
    calculateIncomeTax({
      taxableAllowanceTotal: 446_000,
      nonTaxableCommutingAllowance: 0,
      socialInsuranceDeduction: 0,
      taxTableColumn: "kou",
      hasSpouseDeduction: true,
      dependentCount: 7,
      taxYear: 2026,
    }).incomeTax,
    940,
    "国税庁計算例2（A=446,000円・扶養8人相当）"
  );

  // 例3（国税庁公表の計算例）：A=775,200円、配偶者あり・扶養親族2人 → 59,470円
  assertEqual(
    calculateIncomeTax({
      taxableAllowanceTotal: 775_200,
      nonTaxableCommutingAllowance: 0,
      socialInsuranceDeduction: 0,
      taxTableColumn: "kou",
      hasSpouseDeduction: true,
      dependentCount: 2,
      taxYear: 2026,
    }).incomeTax,
    59_470,
    "国税庁計算例3（A=775,200円・扶養3人相当）"
  );

  // 例4（V1想定：甲欄・扶養0人）：総支給300,000円、社保控除0円 → 7,910円
  assertEqual(
    calculateIncomeTax({
      taxableAllowanceTotal: 300_000,
      nonTaxableCommutingAllowance: 0,
      socialInsuranceDeduction: 0,
      taxTableColumn: "kou",
      hasSpouseDeduction: false,
      dependentCount: 0,
      taxYear: 2026,
    }).incomeTax,
    7_910,
    "V1想定例（A=300,000円・扶養0人）"
  );

  // 例5：乙欄・105,000円未満の帯 → 給与80,750円 → 2,473円
  assertEqual(
    calculateIncomeTax({
      taxableAllowanceTotal: 80_750,
      nonTaxableCommutingAllowance: 0,
      socialInsuranceDeduction: 0,
      taxTableColumn: "otsu",
      hasSpouseDeduction: false,
      dependentCount: 0,
      taxYear: 2026,
    }).incomeTax,
    2_473,
    "乙欄・国税庁計算例（A=80,750円）"
  );

  console.log("\nすべてのテストが成功しました。");
}

// Replit等で直接実行した場合にテストを走らせる
if (require.main === module) {
  runSelfTests();
}
