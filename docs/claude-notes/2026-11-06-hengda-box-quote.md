# Hengda corrugated box quote added to packaging costing (Nov 6, 2026)

- Source: Henan Hengda Paper Co. (Mark, mark@hd-paper.com) quote 2026-CN0910 dated Sep 10, 2026, to Veejay. EXW, valid 7 days (expired), 30/70 payment, production 3 days after deposit.
- Board: 3-layer C flute 4 mm, 160 gsm kraft face, 160 gsm medium, 130 gsm kraft liner, logo both sides. Others quoted B flute.
- Sizes in cm. Mapped to RFQ inches: 46x31x31=18x12x12, 46x31x26=18x12x10, 46x31x21=18x12x8, 36x26x26=14x10x10, 31x26x16=12x10x6,
  31x26x18=12x10x7, 26x16x16=10x6x6, 51x26x21=20x10x8. Mismatches: 36x26x16 cm (14.2x10.2x6.3 in) vs 16x10x6, 36x26x8 cm vs 14x11x3.
- At RFQ quantities: Zhuori 4,664.05, Yalan 5,160.85, Hengda 5,449.35, Wan Jia 6,912.00 USD. Hengda never lowest (ties Yalan on 14x11x3).
- Workbook: ~/Downloads/beyondGREEN_Packaging_Costing.xlsx. Added column F (Hengda), lowest/supplier/extended moved to G/H/I,
  Landed Estimate refs updated to 'Box Comparison'!I15 and G5, conditional format rule C5=$G5, Supplier Log row 13.
- Learned: openpyxl column moves do not update other-sheet refs or conditional-format formulas; fix both by hand and recalc.
