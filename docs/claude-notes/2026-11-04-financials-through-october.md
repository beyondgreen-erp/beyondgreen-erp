# Financial package updated through October 2026 (Nov 4, 2026)

## What was asked
Aashish's valuation team wanted the last financials sent to Aashish; Rudy then asked to update them with the
October 2026 unaudited P&L (`Unaudited_Pl_October2026.xlsx`, dated Nov 4, 2026).

## What was produced
- `beyondGREEN_Growth_Report_Oct2026.xlsx`: same six-tab layout as the August growth report, Source Data
  extended to January through October 2026 (September keyed from `UNAUDITED INTERIM P&L SEPT 2026.xlsx`,
  finance department email of Oct 8). All other tabs are formulas off Source Data; recalculated, 483 formulas, 0 errors.
- `beyondGREEN_Investor_Brief_Nov2026.pdf`: same ReportLab design as the October brief (build script in
  the Oct 9 chat "September update email to Aashish Shah"; logo pulled from that PDF). Four pages: October
  results, year to date, orders and the Walmart expansion (Oct 9 to Nov 4), outlook and projection.
- Both saved to `~/Downloads/Valuation Docs 2026-11-04/` on Rudy's iMac with the other valuation documents.

## Figures that must tie (checked)
- October 2026: revenue 438,312.78; COGS 256,886.14; gross profit 181,426.64 (41.4%); operating expense
  213,205.23; other expense 5,850.61 (late charges and penalties 5,350.61; moving 500); net income (37,629.20).
- September 2026: revenue 485,660.13; COGS 254,474.63; opex 210,518.21; net income 20,667.29 (ties to the Oct brief).
- Jan-Oct 2026: revenue 3,591,744.73; COGS 1,905,386.27; GP 1,686,358.46 (47.0%); opex 2,242,996.17;
  net income (562,488.32). Jan-Oct 2025: revenue 1,986,074.49; net income (2,659,808.67).
- Q4 2025 gross margin is negative (58.1%) because December 2025 COGS carried 584,637 (year-end inventory adjustment).

## How "Net Other Income" is used in Source Data
One row per year. 2025 has small positive other income; October 2026 is the first 2026 month with an
other-expense line, entered as a negative (−5,850.61) so Net Income = GP − OpEx + Net Other ties to QuickBooks.

## Projection method in the brief
The September credit model only states Q4 monthly revenue per case (Oct/Nov/Dec: Downside 572,986 / 564,776 /
526,876; Mid 656,369 / 733,647 / 784,472; Management 656,369 / 933,647 / 984,472). Its monthly net income is a
linear function of revenue (slope 0.19993, fixed 134,860 a month), back-solved exactly from the three FY2026
cases in the October brief. Updated FY2026 = Jan-Oct actual + model Nov and Dec: Downside 4,683,397 /
(613,960); Mid 5,109,864 / (528,699); Management 5,509,864 / (448,728). Shown rounded to the nearest thousand.

## Sources used for the business-update page (all verifiable)
- Walmart: Rudy's `bG Weekly Update WK 40 11.04.26` email to Cora Cochran (service 1,025,070 units / 501 POs /
  37 weeks at 100%; POS $133K LW; supply plan 104,210 units/week; 24ct spoon and fork expansion to ~1,500 stores,
  swap WK44, through WK20; manual orders 47,048 each), the Carmen Mancia thread "24ct Comp Spoon | Potential
  Store Expansion" (Oct 27 to Nov 4), and `walmart_board_orders` in the ERP (weekly units and PO value).
- Other orders: `sales_orders` joined to `customers.company_name`, order_date Oct 9 to Nov 4, excluding
  `WALMART|test`. Non-Walmart: 83 orders, $123,328.36 as entered (before freight and tax).
- Certifications: from the WK 39 and WK 40 weekly updates (TÜV Rheinland home compost received, Made in
  California received, USDA BioPreferred registration complete, BPI Home / TÜV AUSTRIA / CMA in process).
- Customer-concentration and pipeline sections from the October brief were dropped because no updated
  sales-by-customer report or pipeline review was available; Rudy can add pipeline items before sending.

## Learned
- The ERP `walmart_board_orders` weekly totals match the October brief exactly (Sep 3: 32,844 ... Oct 8: 65,244),
  so the ERP is a safe source for the Walmart weekly chart.
- The Chrome Outlook helpers (`window.__press`, `window.__dlName`) survive OWA navigation but must be
  re-installed after a full page reload; attachments land in `~/Downloads` and are staged from there.
- Keep US spelling in the workbook (annualized, amortization); the August file had UK spellings.
