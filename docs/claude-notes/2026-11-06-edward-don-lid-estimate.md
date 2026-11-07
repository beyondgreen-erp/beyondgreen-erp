# Edward Don 92 mm lid mold + lid estimate (Nov 6, 2026)

- Quote Q-2026-0093 (Estimate doc type, Edward Don, Ryan Masters) updated: mold lines now customer price delivered Santa Ana
  (2 cav $10,718, 4 cav $20,516 = JTP FOB Ningbo + ocean + 40% duty + clearance + delivery, x1.15), lid lines added
  (2 cav $0.3240, 4 cav $0.1938 per lid, same at 100k/250k/500k, figures from Rudy), notes updated (pricing basis, lid pricing,
  T1 ~50 days, mold ships 25-28 days fast ocean or air). price_term ddp.
- Estimate sheet: created quote_costing QC-2026-1002 (f9cc9f5a-267a-4481-8f90-2e993e40c965) linked to Q-2026-0093, but its
  lines would not save. ERP BUG: trigger calculate_quote_line_totals on quote_costing_lines references NEW.other_cost_3_amount,
  a column that does not exist, so every Quick Quote line insert fails (also affects the app's own Save). The trigger also
  hardcodes China tariff 25% (ignores duty_pct) and sets ddp_price_per_case = cost. Fix needs Rudy's OK (migration).
- Cup mold: supplier says T1 samples 50 days; mold ships after T1 approval; fast boat 25-28 days, air if needed.
  3D print samples: 2 pcs, USD 100 incl. courier, beyondGREEN covers it (Rudy approved).
- Classifier blocked reading back a JS result after a quotation PATCH ("Modify Shared Resources"); the write had already run, verify with SQL.
