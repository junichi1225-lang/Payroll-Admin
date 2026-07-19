// 残業判定フローチャート（3-1）準拠の timeEngine テスト。
// 判定①法定休日 / 判定②日8h超・週40h超（日次超過分は週カウント除外、
// 月60hカウンターは全職場横断）/ 判定③法定内は×1.00 を検証する。
import { describe, expect, it } from "vitest";
import type { TimecardEntry, WorkplaceDef } from "@/lib/dummy-data";
import {
  bucketPaidHours,
  computeBucketsByWorkplace,
  computeWeekCarryIn,
  TimecardRow,
} from "./timeEngine";

const YEAR = 2026;

function wp(overrides: Partial<WorkplaceDef> = {}): WorkplaceDef {
  return {
    tenantId: "t1",
    id: "w1",
    name: "テスト職場",
    color: "",
    prefecture: "東京都",
    defaultStartTime: "09:00",
    defaultEndTime: "18:00",
    defaultRestMinutes: 0,
    roundingRule: "none" as WorkplaceDef["roundingRule"],
    legalHoliday: "Sunday",
    scheduledHoliday: ["Saturday"],
    includeEarlyOvertime: false,
    applyLateNightPremium: true,
    ...overrides,
  };
}

// 2026年7月: 7/1=水, 7/5=日, 7/11=土, 7/12=日
function row(
  id: string,
  date: string, // "M/D"
  start: string,
  end: string,
  workplaceId = "w1",
  breakMinutes = 0,
): TimecardRow {
  const entry: TimecardEntry = {
    tenantId: "t1",
    id,
    date,
    year: YEAR,
    month: parseInt(date.split("/")[0], 10),
    ocrStatus: "success",
    ocrStart: start,
    ocrEnd: end,
    stdStart: start,
    stdEnd: end,
    isRestManuallyEdited: false,
  };
  return {
    ...entry,
    editStart: "",
    editEnd: "",
    workplaceId,
    breakMinutes,
    timeManuallyEdited: false,
    manualEdit: false,
    isDayConfirmed: false,
  };
}

describe("残業判定フローチャート", () => {
  it("判定③: 日8h以内・週40h以内は全て×1.00（basic）", () => {
    const wps = { w1: wp() };
    // 月〜金 7h ずつ = 35h
    const rows = ["7/6", "7/7", "7/8", "7/9", "7/10"].map((d, i) =>
      row(`r${i}`, d, "09:00", "16:00"),
    );
    const b = computeBucketsByWorkplace(rows, wps).w1;
    expect(b.basic).toBeCloseTo(35);
    expect(b.overtime).toBe(0);
    expect(b.overtimeOver60).toBe(0);
  });

  it("判定②: 日8h超は法定外残業×1.25", () => {
    const wps = { w1: wp() };
    const b = computeBucketsByWorkplace([row("r1", "7/6", "09:00", "19:00")], wps).w1; // 10h
    expect(b.basic).toBeCloseTo(8);
    expect(b.overtime).toBeCloseTo(2);
  });

  it("判定②: 週40h超は日8h以内でも法定外残業（日次超過分は週カウント除外）", () => {
    const wps = { w1: wp({ legalHoliday: "Sunday", scheduledHoliday: [] }) };
    // 月〜金 8h = 40h、土曜（所定休日でない平日扱い）にさらに 6h → 週40h超で全て残業
    const rows = [
      ...["7/6", "7/7", "7/8", "7/9", "7/10"].map((d, i) => row(`r${i}`, d, "09:00", "17:00")),
      row("r5", "7/11", "09:00", "15:00"),
    ];
    const b = computeBucketsByWorkplace(rows, wps).w1;
    expect(b.basic).toBeCloseTo(40);
    expect(b.overtime).toBeCloseTo(6);
  });

  it("所定休日労働は判定②を通る（週40h以内なら×1.00、参考値に計上）", () => {
    const wps = { w1: wp() }; // 土曜=所定休日
    const b = computeBucketsByWorkplace([row("r1", "7/11", "09:00", "14:00")], wps).w1; // 土5h
    expect(b.basic).toBeCloseTo(5);
    expect(b.overtime).toBe(0);
    expect(b.scheduledHolidayWork).toBeCloseTo(5);
    // 支給換算にも×1.00でのみ寄与（参考値の二重計上なし）
    expect(bucketPaidHours(b)).toBeCloseTo(5);
  });

  it("判定①: 法定休日は×1.35、週40hカウントに含めない", () => {
    const wps = { w1: wp() }; // 日曜=法定休日
    const rows = [
      ...["7/6", "7/7", "7/8", "7/9", "7/10"].map((d, i) => row(`r${i}`, d, "09:00", "17:00")), // 40h
      row("r5", "7/12", "09:00", "14:00"), // 日曜 5h
      row("r6", "7/13", "09:00", "12:00"), // 翌週月曜 3h（新しい週 → basic）
    ];
    const b = computeBucketsByWorkplace(rows, wps).w1;
    expect(b.legalHolidayWork).toBeCloseTo(5);
    expect(b.overtime).toBe(0);
    expect(b.basic).toBeCloseTo(43);
    expect(bucketPaidHours(b)).toBeCloseTo(43 + 5 * 1.35);
  });

  it("日8h判定は同日・複数職場を通算する", () => {
    const wps = { w1: wp(), w2: wp({ id: "w2" }) };
    const rows = [
      row("a", "7/6", "09:00", "15:00", "w1"), // 6h
      row("b", "7/6", "15:00", "20:00", "w2"), // 5h → 2h within, 3h over
    ];
    const m = computeBucketsByWorkplace(rows, wps);
    expect(m.w1.basic).toBeCloseTo(6);
    expect(m.w1.overtime).toBe(0);
    expect(m.w2.basic).toBeCloseTo(2);
    expect(m.w2.overtime).toBeCloseTo(3);
  });

  it("月60hカウンターは全職場横断で1.50へ切替", () => {
    const wps = { w1: wp({ scheduledHoliday: [] }), w2: wp({ id: "w2", scheduledHoliday: [] }) };
    // 毎平日 8h(basic) + 6h(残業) を職場交互に。法定外残業計 60h 超を作る:
    // 平日10日 × 6h残業 = 60h ちょうど → 11日目の残業から1.50
    const dates = ["7/6", "7/7", "7/8", "7/9", "7/10", "7/13", "7/14", "7/15", "7/16", "7/17", "7/20"];
    const rows = dates.flatMap((d, i) => [
      row(`a${i}`, d, "06:00", "14:00", i % 2 === 0 ? "w1" : "w2"), // 8h
      row(`b${i}`, d, "14:00", "20:00", i % 2 === 0 ? "w2" : "w1"), // 6h 残業
    ]);
    const m = computeBucketsByWorkplace(rows, wps);
    const totalOver60 = m.w1.overtimeOver60 + m.w2.overtimeOver60;
    const totalUpTo60 = m.w1.overtime + m.w2.overtime;
    expect(totalUpTo60).toBeCloseTo(60);
    expect(totalOver60).toBeCloseTo(6); // 11日目の6hが1.50
  });

  it("日跨ぎ勤務は0時で分割し、後半は翌日の判定に帰属する（土23時→日曜=法定休日）", () => {
    const wps = { w1: wp() }; // 日曜=法定休日、土曜=所定休日
    // 土 20:00 → 日 02:00（6h）: 土曜分4h（判定②→basic）、日曜分2h（法定休日1.35）
    const b = computeBucketsByWorkplace([row("r1", "7/11", "20:00", "02:00")], wps).w1;
    expect(b.basic).toBeCloseTo(4);
    expect(b.legalHolidayWork).toBeCloseTo(2);
    expect(b.lateNight).toBeCloseTo(4); // 22:00–02:00
    expect(b.scheduledHolidayWork).toBeCloseTo(4);
  });

  it("週40hの月跨ぎ持ち越し: 前月末の労働時間が月初週のカウントに算入される", () => {
    const wps = { w1: wp({ scheduledHoliday: [] }) };
    // 2026/6/29(月)・6/30(火) 各8h = 16h（7/1の週は 6/28(日)起算）
    const prevRows = [
      row("p1", "6/29", "09:00", "17:00"),
      row("p2", "6/30", "09:00", "17:00"),
    ];
    const carry = computeWeekCarryIn(prevRows, wps);
    // 7/1(水)〜7/4(土) 各8h = 32h。持ち越し16h + 32h = 48h → 8h が週40h超の残業
    const rows = ["7/1", "7/2", "7/3", "7/4"].map((d, i) => row(`r${i}`, d, "09:00", "17:00"));
    const withCarry = computeBucketsByWorkplace(rows, wps, carry).w1;
    expect(withCarry.basic).toBeCloseTo(24);
    expect(withCarry.overtime).toBeCloseTo(8);
    // 持ち越しなしなら全て basic
    const withoutCarry = computeBucketsByWorkplace(rows, wps).w1;
    expect(withoutCarry.basic).toBeCloseTo(32);
    expect(withoutCarry.overtime).toBe(0);
  });

  it("深夜は区分に関係なく+0.25加算（法定休日深夜=実質1.60）", () => {
    const wps = { w1: wp() };
    const b = computeBucketsByWorkplace([row("r1", "7/12", "20:00", "24:00")], wps).w1; // 日曜 20-24時
    expect(b.legalHolidayWork).toBeCloseTo(4);
    expect(b.lateNight).toBeCloseTo(2); // 22-24時
    expect(bucketPaidHours(b)).toBeCloseTo(4 * 1.35 + 2 * 0.25); // 深夜帯2hは実質1.60
  });
});
