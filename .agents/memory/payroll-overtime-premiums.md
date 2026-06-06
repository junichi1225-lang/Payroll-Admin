---
name: Payroll overtime/late-night/holiday premiums
description: How legal wage premiums (割増) are applied to gross, the 60h rule, and the hourly-only scope limitation.
---

# Payroll premiums (割増) in gross calc

Hourly gross is NOT a flat Σ(rate×hours). It is `rate × bucketPaidHours(buckets)` where
`bucketPaidHours` (in `timeEngine.ts`) converts the 6 time buckets into premium-weighted
"賃金換算時間":
- basic ×1.00
- 法定外残業 (overtime + earlyOvertime): first 60h ×1.25, hours over 60 ×1.50
- 所定休日労働 (scheduledHolidayWork) ×1.25 (treated as 時間外)
- 法定休日労働 (legalHolidayWork) ×1.35
- 深夜 (lateNight) ×0.25 **additive** — it is a separate overlap bucket (22:00–05:00) layered
  on top of basic/overtime/holiday, so holiday+深夜 = 1.35+0.25 = 1.60 automatically.

**60h rule:** judged on the **monthly per-workplace** 法定外残業 total. Because the premium is
linear, `min(pool,60)×1.25 + max(0,pool−60)×1.50` is exact regardless of chronological order.
法定休日労働 hours do NOT count toward the 60h overtime pool.

**Why earlyOvertime is in the 法定外 pool:** this app treats 朝残業 (clock-in before scheduled
start) as 時間外 by design (`includeEarlyOvertime` per workplace), so it gets 1.25 and joins the
60h pool.

## Scope limitation (documented SPEC)
Premiums apply to **時給制 (hourly) only**. `computeDailyGross` (日給制) and 月給制 add NO
premium — you can't derive a unique hourly unit from a daily/monthly wage in this mock.
**Why:** intentional scope cut; documented in the `computeDailyGross` doc comment. If daily/monthly
premiums are ever needed, define an hourly-equivalent from 所定労働時間 first.

## computeHourlyGross signature
Takes `bucketsByWorkplace` (NOT pre-summed net hours) so premiums can be computed. Both
PayrollTab and `payrollInputs.ts` must pass `bucketsByWorkplace`. `bucketNetHours` still exists
for display of actual worked hours (no premium).
