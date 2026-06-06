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
import { computePayroll } from "@/lib/payroll-core";
import { loadEmployeeMonthComputation } from "@/lib/payrollInputs";
globalThis.__computePayroll = computePayroll;
globalThis.__loadEmployeeMonthComputation = loadEmployeeMonthComputation;
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

console.log(ok ? "\nRESULT: PASS ✅" : "\nRESULT: FAIL ❌");
process.exit(ok ? 0 : 1);
