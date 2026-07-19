---
name: Payroll overtime/late-night/holiday premiums
description: Flowchart-based overtime classification (判定①〜③), cross-workplace counters, and the hourly-only scope limitation.
---

# Payroll premiums (割増) — user-flowchart compliant

Classification lives in `timeEngine.ts` `computeBucketsByWorkplace`, which processes all
rows **chronologically** (overnight shifts split at midnight, breaks pro-rated per segment)
and shares these counters **across all workplaces**:
- 日8h counter (same-day multi-workplace hours are aggregated)
- 週40h counter (Sunday-start weeks; daily-over-8h minutes and legal-holiday work excluded;
  month-boundary carry-in via `computeWeekCarryIn(prevMonthRows)` — BOTH PayrollTab and
  payrollInputs must pass it or tabs diverge)
- 月60h counter (monthly cumulative 法定外残業; over 60h → ×1.50)

Decision flow (判定①→②→③):
1. 法定休日 → ×1.35 (excluded from 40h/60h counters)
2. 日8h超 OR 週40h超 → 法定外残業 ×1.25 (≤60h) / ×1.50 (>60h)
3. Otherwise (所定内・法定内残業) → ×1.00 — 所定休日 work and 朝残業 get NO automatic
   premium; they flow through 判定② like ordinary work time. `scheduledHolidayWork`
   bucket is informational only (already classified into basic/overtime; not in
   bucketNetHours or pay).

深夜 (22:00–05:00) is a separate overlap bucket, +0.25 **additive** on any category
(legal-holiday night = 1.35+0.25 = 1.60).

`bucketPaidHours` just multiplies pre-classified buckets by rates — the 60h split is done
during classification, NOT there. Buckets stay per-workplace so gross = Σ(rate ×
bucketPaidHours) per workplace, while counters are global.

Tests: `src/lib/timeEngine.test.ts` covers every flowchart branch incl. midnight split and
week carry-in.

## Scope limitation (documented SPEC)
Premiums apply to **時給制 (hourly) only**. `computeDailyGross` (日給制) and 月給制 add NO
premium — you can't derive a unique hourly unit from a daily/monthly wage in this mock.
**Why:** intentional scope cut; documented in the `computeDailyGross` doc comment.
