---
name: 協会けんぽ health-rate verification sources
description: Where to get authoritative 健康保険料率 values and why AI/web summaries must not be trusted for them.
---

# 協会けんぽ 健保料率: trust only primary per-prefecture PDFs

When verifying/setting 健康保険料率 in `rates.ts`, the ONLY reliable source is the
official 協会けんぽ per-prefecture 保険料額表 PDF, e.g.
`https://www.kyoukaikenpo.or.jp/assets/13tokyo_7.pdf` (R7),
`14kanagawa_7.pdf`, `27osaka_7.pdf` … (NN = JIS prefecture code, `_7` = 令和7年度).
Index of all PDFs: the R7 「保険料額表」 page lists every prefecture's PDF link.

**Why:** AI web-search summaries and 社労士 blogs of these rates are routinely WRONG
and even contradict each other (observed: two summaries gave 埼玉 9.80 / 千葉 9.80 and
神奈川 9.99, all false; primary PDFs give 埼玉 9.76, 千葉 9.79, 神奈川 9.92). Same
lesson as the 賞与算出率表 transcription. Do not change a rate based on summaries.

**How to apply:** Fetch the per-prefecture PDF and read the 健康保険料率 header (or
the SR-300,000 half-premium row). webFetch sometimes only extracts a PDF's 任意継続
前納 tables (column-misaligned, NOT usable for deriving the rate) — if so, the rate
isn't machine-verifiable via this tool; REPORT it as unverified rather than guess.

## Verified-correct R7 (令和7年度) 健保料率 in code (confirmed vs primary PDFs)
北海道 10.31 / 埼玉 9.76 / 千葉 9.79 / 東京 9.91 / 神奈川 9.92 / 愛知 10.03 /
京都 10.03 / 大阪 10.24 / 福岡 10.31. (兵庫 code=10.16 could NOT be machine-extracted
from 28hyogo_7.pdf — needs manual eyeball; AI summaries claimed 10.18 but are untrusted.)
神奈川 R7=R8=9.92 (特例据置, confirmed via official R8 神奈川 PDF). 東京 R7 9.91 (NOT 9.87).
