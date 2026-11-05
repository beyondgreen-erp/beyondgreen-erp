# Walmart Weekly Report (bG Weekly Update)

Business Reports board -> **Walmart Weekly Report** tab (`/bizdev/business-reports`).
Generates the weekly "bG Weekly Update WK nn m.d.yyyy" email to Cora (ISG) plus the supporting
workbook, from ERP data, at the click of a button. Built Nov 4, 2026.

## Where the numbers come from

| Section | Source |
| --- | --- |
| POs, loads, pickup dates, pallets, SRP by SKU | `walmart_board_orders` + `walmart_board_lines` (live) |
| MABDs, pickup comments, POs from before the board (fiscal YTD) | `wm_po_history`, refreshed by uploading Manish's *WM Ordered vs Ship* workbook |
| Production | `walmart_production_entries` (Walmart production board; qty in SRP, x6 = units) |
| Unit Packaging (-P), SRPs (-SI) on hand | `inventory_snapshots` (scope product), latest on/before the report date |
| Forecast | `wm_forecast_batches` + `wm_forecast_rows`, uploaded from Walmart's *Sales and Order Forecast* (Order Forecast sheet) |
| Comp-store supply plan / manual orders | `plan` and `manual` jsonb on the latest forecast batch (CSV upload, ORDER_WK / WM_YEAR / Order_Qty) |
| Opening safety stock position | prior report's closing position (`wm_weekly_reports.results.position.closing`), editable |
| USW, store counts, reset date, recipients, certifications, SRP on order | `wm_weekly_settings` (Settings panel) |

## Method (unchanged from the manual reports)

* Walmart weeks run Sunday to Saturday; WK 1 starts on the Sunday on/before Feb 1. Orders are Thursdays.
* All Walmart volume is reported in **units**; 1 SRP = 6 units. Packaging terms: **SRPs** and **Unit Packaging**.
* Position walk: opening + production (ERP board, from the day after the prior report through the report date)
  less the full order of the week being shipped. 3-week requirement = USW x stores x 1.20 x 3.
* Supply plan average = next 8 order weeks starting with the next order date (a row with no following
  weekly row counts as two weeks). Manual orders are excluded from the average.
* Packaging weeks of cover = committed / supply plan usage; "Top-up" when below the weeks to the reset.

## Code

* `src/lib/walmartWeekly/` — `weeks.ts` (fiscal calendar), `data.ts` (Supabase loaders, default settings),
  `model.ts` (pure compute -> `Results`), `workbook.ts` (SheetJS), `charts.ts` (@napi-rs/canvas, bundled
  DejaVu fonts), `email.ts` (HTML body, no em dashes), `signature.ts`, `service.ts` (orchestration, .eml, Graph send).
* `src/app/api/walmart/weekly-report/` — `GET /` overview, `POST generate`, `POST send` (Outlook Graph,
  user's connected mailbox, workbook attached, charts inline), `PUT settings`, `POST upload`
  (kind = forecast | plan | history), `GET file?id&kind=xlsx|eml|html`.
* `src/components/WalmartWeeklyReport.tsx` — the tab.
* Storage: `erp-files/walmart-weekly/<report id>/` (workbook + chart PNGs). Runs in `wm_weekly_reports`.

## Weekly routine

1. Upload the new Walmart forecast when one arrives (the plan is carried over), and Manish's Ordered vs Ship
   workbook (brings MABDs and comments).
2. Type the week's notes (pickups, asks, meeting), check the opening position, **Generate report**.
3. Review the preview; download the workbook / .eml or **Send from my Outlook**.
