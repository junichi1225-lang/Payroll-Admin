// Task #11 受け入れ検証スクリプト（spec §8）。
// 標準報酬300,000 / 東京都 / 40-64歳 / 令和8年度 / 甲欄 / 扶養0 で、
// computePayroll が想定内訳を返すことを確認する。
// esbuild の JS API で TS をその場でバンドルして実行する。

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const require = createRequire(
  path.join(repoRoot, "node_modules/.pnpm/node_modules/noop.js"),
);
const esbuild = require("esbuild");

import fs from "node:fs";

function resolveTo(base) {
  const exts = [".ts", ".tsx", ".js", ".json"];
  for (const e of exts) if (fs.existsSync(base + e)) return base + e;
  for (const e of exts) {
    const idx = path.join(base, "index" + e);
    if (fs.existsSync(idx)) return idx;
  }
  if (fs.existsSync(base)) return base;
  return base;
}

const aliasPlugin = {
  name: "alias",
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => ({
      path: resolveTo(path.join(appRoot, "src", args.path.slice(2))),
    }));
  },
};

const entry = `
import { computePayroll, round50sen, floorYen } from "@/lib/payroll-core";
import { loadEmployeeMonthComputation } from "@/lib/payrollInputs";
import { bucketPaidHours, computeHourlyGross, EMPTY_BUCKETS } from "@/lib/timeEngine";
import { resolveRates } from "@/lib/constants/rates";
import { calculateIncomeTax } from "@/lib/taxCalculator";
globalThis.__computePayroll = computePayroll;
globalThis.__loadEmployeeMonthComputation = loadEmployeeMonthComputation;
globalThis.__round50sen = round50sen;
globalThis.__floorYen = floorYen;
globalThis.__bucketPaidHours = bucketPaidHours;
globalThis.__computeHourlyGross = computeHourlyGross;
globalThis.__EMPTY_BUCKETS = EMPTY_BUCKETS;
globalThis.__resolveRates = resolveRates;
globalThis.__calculateIncomeTax = calculateIncomeTax;
`;

const result = await esbuild.build({
  stdin: { contents: entry, resolveDir: appRoot, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [aliasPlugin],
  resolveExtensions: [".ts", ".tsx", ".js", ".json"],
  logLevel: "silent",
});

const code = result.outputFiles[0].text;
const dataUrl = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
await import(dataUrl);

const computePayroll = globalThis.__computePayroll;

// ── 受け入れケース ──
const input = {
  targetYearMonth: "2026-04", // 令和8年度（4月起算）
  prefecture: "東京都",
  gross: 300_000,
  nonTaxableAllowanceTotal: 0,
  employee: {
    isSocialInsurance: true,
    standardRemuneration: 300_000,
    birthDate: "1980-01-01", // 40-64歳
    residentTax: 0,
  },
};

const out = computePayroll(input);
const d = out.deductions;

const expected = {
  health: 14_775, // 300000 * 0.0985 * 0.5 = 14775
  nursingCare: 2_430, // 300000 * 0.0162 * 0.5 = 2430
  pension: 27_450, // 300000 * 0.1830 * 0.5 = 27450
  childcare: 345, // 300000 * 0.0023 * 0.5 = 345
  labor: 1_500, // 300000 * 0.0050 = 1500
  socialInsuranceTotal: 46_500,
  taxBase: 253_500, // 300000 - 0 - 46500
};

const checks = [
  ["健康保険", d.health, expected.health],
  ["介護保険", d.nursingCare, expected.nursingCare],
  ["厚生年金", d.pension, expected.pension],
  ["子ども子育て支援金", d.childcare, expected.childcare],
  ["雇用保険", d.labor, expected.labor],
  ["社会保険料合計", d.socialInsuranceTotal, expected.socialInsuranceTotal],
];

let ok = true;
console.log("=== Task #11 受け入れ検証 (300k/東京/40-64/R8/甲/扶養0) ===");
for (const [label, got, exp] of checks) {
  const pass = got === exp;
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} ${label}: ${got}　(期待 ${exp})`);
}
console.log(`  介護第2号該当: ${d.isNursingCareTarget}`);
console.log(`  所得税(課税ベース${expected.taxBase}基準): ${d.incomeTax}`);
console.log(`  住民税: ${d.residentTax}`);
console.log(`  控除合計: ${d.total}`);
console.log(`  総支給: ${out.gross} / 差引支給: ${out.netPay}`);

// 控除合計の内訳整合
const recomputedTotal = d.socialInsuranceTotal + d.incomeTax + d.residentTax;
const totalOk = recomputedTotal === d.total;
console.log(`${totalOk ? "✓" : "✗"} 控除合計整合: ${d.total} === 社保${d.socialInsuranceTotal}+所得税${d.incomeTax}+住民税${d.residentTax}`);
ok = ok && totalOk && d.isNursingCareTarget === true;

// ───────────────────────────────────────────────────────────
// A. 割増（時間外・深夜・休日）の賃金換算
// ───────────────────────────────────────────────────────────
const bucketPaidHours = globalThis.__bucketPaidHours;
const computeHourlyGross = globalThis.__computeHourlyGross;
const EMPTY = globalThis.__EMPTY_BUCKETS;
const RATE = 1_500;
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

console.log("\n=== A. 割増（時給1,500円）===");
const aChecks = [
  // 法定外残業2h → 1500×1.25×2 = 3750
  ["法定外残業2h", computeHourlyGross({ w: { ...EMPTY, overtime: 2 } }, { w: String(RATE) }), 3_750],
  // 上記うち深夜1h重複 → さらに 1500×0.25×1 = 375 加算（合計4125）
  ["残業2h+深夜1h", computeHourlyGross({ w: { ...EMPTY, overtime: 2, lateNight: 1 } }, { w: String(RATE) }), 4_125],
  // 法定休日労働8h → 1500×1.35×8 = 16200
  ["法定休日8h", computeHourlyGross({ w: { ...EMPTY, legalHolidayWork: 8 } }, { w: String(RATE) }), 16_200],
  // 法定休日8h かつ全時間深夜 → 1500×(1.35+0.25)×8 = 19200
  ["法定休日8h+深夜8h", computeHourlyGross({ w: { ...EMPTY, legalHolidayWork: 8, lateNight: 8 } }, { w: String(RATE) }), 19_200],
  // 月60時間超の法定外残業61h → 60×1.25 + 1×1.50 = 76.5h相当 → ×1500 = 114750
  ["法定外残業61h(60h超)", computeHourlyGross({ w: { ...EMPTY, overtime: 61 } }, { w: String(RATE) }), 114_750],
  // 所定休日8h → 時間外扱い1.25 → 1500×1.25×8 = 15000
  ["所定休日8h", computeHourlyGross({ w: { ...EMPTY, scheduledHolidayWork: 8 } }, { w: String(RATE) }), 15_000],
  // 基本8h → 割増なし → 1500×8 = 12000
  ["基本8h", computeHourlyGross({ w: { ...EMPTY, basic: 8 } }, { w: String(RATE) }), 12_000],
];
for (const [label, got, exp] of aChecks) {
  const pass = got === exp;
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} ${label}: ${got}　(期待 ${exp})`);
}
// bucketPaidHours 単体: 残業2h+深夜1h = 2×1.25 + 1×0.25 = 2.75h
{
  const got = bucketPaidHours({ ...EMPTY, overtime: 2, lateNight: 1 });
  const pass = approx(got, 2.75);
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} bucketPaidHours(残業2h+深夜1h): ${got}　(期待 2.75)`);
}

// ───────────────────────────────────────────────────────────
// C. 端数処理（50銭ルール・円未満切捨）境界値
// ───────────────────────────────────────────────────────────
const round50sen = globalThis.__round50sen;
const floorYen = globalThis.__floorYen;
console.log("\n=== C. 端数処理 境界値 ===");
const cChecks = [
  ["round50sen(100.50)=切捨100", round50sen(100.5), 100],
  ["round50sen(100.51)=切上101", round50sen(100.51), 101],
  ["round50sen(100.00)=100", round50sen(100), 100],
  ["round50sen(0.5)=切捨0", round50sen(0.5), 0],
  ["floorYen(6674.9)=6674", floorYen(6674.9), 6674],
  ["floorYen(-5)=0", floorYen(-5), 0],
];
for (const [label, got, exp] of cChecks) {
  const pass = got === exp;
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} ${label}: ${got}`);
}

// ───────────────────────────────────────────────────────────
// D. effectiveFrom 境界（令和7 / 令和8 の引き当て）
// ───────────────────────────────────────────────────────────
const resolveRates = globalThis.__resolveRates;
console.log("\n=== D. 料率 effectiveFrom 境界 ===");
const r7 = resolveRates("東京都", "2026-02"); // 令和7
const r8 = resolveRates("東京都", "2026-04"); // 令和8
const dChecks = [
  ["2026-02 東京健保=9.91%", r7.healthInsuranceRate, 0.0991],
  ["2026-02 介護=1.59%", r7.nursingCareInsuranceRate, 0.0159],
  ["2026-02 雇用=0.55%", r7.employmentInsuranceEmployeeRate, 0.0055],
  ["2026-02 支援金=0%(未適用)", r7.childcareSupportRate, 0],
  ["2026-04 東京健保=9.85%", r8.healthInsuranceRate, 0.0985],
  ["2026-04 介護=1.62%", r8.nursingCareInsuranceRate, 0.0162],
  ["2026-04 雇用=0.50%", r8.employmentInsuranceEmployeeRate, 0.0050],
  ["2026-04 支援金=0.23%", r8.childcareSupportRate, 0.0023],
];
for (const [label, got, exp] of dChecks) {
  const pass = approx(got, exp);
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} ${label}: ${got}`);
}

// ───────────────────────────────────────────────────────────
// B. 所得税（令和8年分・月額表 甲欄・扶養0）1円単位一致
//    入力は「その月の社会保険料等控除後の給与等の金額」
// ───────────────────────────────────────────────────────────
const calculateIncomeTax = globalThis.__calculateIncomeTax;
console.log("\n=== B. 所得税 令和8年分 月額表(甲・扶養0) ===");
const bChecks = [
  ["100,000(105,000未満)", calculateIncomeTax(100_000), 0],
  ["106,000(105,000〜107,000)", calculateIncomeTax(106_000), 170],
  ["150,000", calculateIncomeTax(150_000), 2_420],
  ["200,000", calculateIncomeTax(200_000), 4_340],
  ["250,000", calculateIncomeTax(250_000), 6_110],
  ["300,000", calculateIncomeTax(300_000), 7_930],
  ["350,000", calculateIncomeTax(350_000), 11_730],
  ["400,000", calculateIncomeTax(400_000), 15_650],
  ["450,000", calculateIncomeTax(450_000), 19_860],
  ["500,000", calculateIncomeTax(500_000), 28_190],
  ["600,000", calculateIncomeTax(600_000), 45_390],
  ["700,000", calculateIncomeTax(700_000), 63_590],
];
for (const [label, got, exp] of bChecks) {
  const pass = got === exp;
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} ${label}: ${got}　(期待 ${exp})`);
}
// 区分切替の境界（以上〜未満 と 月額表↔電算機特例 の切替）
const boundaryChecks = [
  ["104,999(非課税側)", calculateIncomeTax(104_999), 0],
  ["105,000(月額表 先頭)", calculateIncomeTax(105_000), 170],
  ["739,999(月額表 末尾)", calculateIncomeTax(739_999), 71_380],
  ["740,000(電算機特例 開始)", calculateIncomeTax(740_000), 71_680],
];
for (const [label, got, exp] of boundaryChecks) {
  const pass = got === exp;
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} 境界 ${label}: ${got}　(期待 ${exp})`);
}
// 受け入れケース(300k/東京)の課税ベース253,500 → 月額表 [251,000〜254,000)=6,220
{
  const got = calculateIncomeTax(253_500);
  const pass = got === 6_220;
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} 課税ベース253,500(300k東京の例): ${got}　(期待 6,220)`);
}
// 740,000円以上は電算機特例。800,000円の算出根拠を確認:
//   別表第一: A≥708,331 → 給与所得控除 162,500
//   別表第三: 基礎控除 48,333
//   B = 800,000 - 162,500 - 48,333 = 589,167（別表第四 579,167〜750,000 帯）
//   税額 = 589,167×0.23483 - 54,113 = 84,241.09 → 10円四捨五入 = 84,240
{
  const got = calculateIncomeTax(800_000);
  const pass = got === 84_240;
  ok = ok && pass;
  console.log(`${pass ? "✓" : "✗"} 800,000(電算機特例): ${got}　(期待 84,240)`);
}

console.log(ok ? "\nRESULT: PASS ✅" : "\nRESULT: FAIL ❌");
process.exit(ok ? 0 : 1);
