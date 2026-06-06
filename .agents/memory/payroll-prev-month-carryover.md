---
name: Payroll previous-month carry-over (rate & attendance)
description: How "前月と同様 / 前月の出勤日数を引き継ぐ" sources prior-month data and how daily-rate attendance carry-over clones rows.
---

# Previous-month carry-over (payroll-app PayrollTab)

## Source of prior-month reference data
- All "前月" reference values read the previous month's localStorage first, then fall back to dummy/default data when that month was never opened:
  - daily/hourly rate → prev `dailyRates_*` / `hourlyRates_*`, else `DEFAULT_DAILY_RATES` / `DEFAULT_HOURLY_RATES`.
  - attendance days (日給制) → prev `timecard_*` rows, else `seedRows(getTimecardEntries(prevYear, prevMonth))`.
- **Why:** carry-over must work even for months the user hasn't visited; the demo persists per-month state only on visit. Keep the localStorage→dummy fallback consistent across every prior-month source, or some carry-overs silently go blank.

## Daily-rate attendance carry-over
- "前月の出勤日数を引き継ぐ" clones ONLY the prev-month rows that count as worked (实働>0, via the shared `rowWorked`), so the carried day count equals the displayed 前月 day count.
- Cloned rows: date label remapped to the current month's same day-of-month (clamped to month length, weekday recomputed) and IDs regenerated with `newRowId()`; the target workplace's existing rows are replaced (same pattern as OCR/CSV import).
- Day counting for both current and prior month goes through the single `countDaysByWorkplace` / `rowWorked` helpers — never duplicate the worked-day predicate, or the 前月 reference and the live subtotal can disagree.
