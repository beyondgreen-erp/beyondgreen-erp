# Walmart pallet planner: keep like SKUs together (Nov 4, 2026)

## What Rudy reported
The pallet build on the order pipeline and the Walmart production board split a SKU up: e.g. on a
mixed pallet `F24 40` on one row and `F24 2` on another with other SKUs between them, and when a PO
was fitted into a set pallet count the same SKU was spread across several pallets with a mixed
pallet at every boundary.

## Where the planner lives
It is all in the database, not the Next.js code: `walmart_pallet_replan(order, force)` (auto plan),
`walmart_pallet_fit(order, n)` (fit into the pallet count the team set), `wm_pallet_spec(sku)` (reads
cases_per_pallet / pallet_ti_hi / case_size / case_weight from products). The UI
(`src/components/WalmartPallets.tsx`) only renders `walmart_build_pallets` and
`walmart_build_pallet_items`. Tracked from now on in `supabase/migrations/20261104_walmart_pallet_grouping.sql`.

## What changed
1. Mixed ("floor") pallets in the auto plan: one row per SKU (its whole layers with its short top
   layer on top of them), heaviest SKU at the bottom. Before, whole layers and the leftover were two rows.
2. Fit into a set count: each SKU gets its own pallets whenever the count allows (layers split evenly,
   short layer on the last pallet, all under the 54" load cap = 60" incl. the 6" deck). Only when the
   count forces it do leftovers share a pallet, and then each SKU is still one block. The old even
   height cut is kept as `walmart_pallet_fit_seq` and used only if the cap cannot be met.
3. Re-planned the 17 Pending POs in the Walmart Orders group. PO 1185030967 (Confirmed) was left alone
   on Rudy's instruction.

## Invariants that must hold (routing was already submitted in Stride)
- Pallet count per PO = the pallet_target the team set = what was submitted. A re-plan never changes it.
- Total weight per PO is unchanged (same SRPs, same number of pallets at 50 lb each).
- Total cube per PO: physically identical (same layers), but per-pallet heights are stored to 0.1",
  so re-grouping can move the PO total by about 0.1 cu ft. For 8937473754 and 9316059226 the
  submitted order-level cube/cbm was restored so the board matches Stride.
- A before snapshot of all 18 plans is in table `public.wm_plan_snapshot_20261104` (drop when no longer needed).

## Learned
- "Perfect builds" in Rudy's words = the planner insisting on whole-layer blocks as separate rows.
  He wants like SKUs grouped: one block per SKU per pallet, and as few mixed pallets as the count allows.
- The `kind` column is `full` for single-SKU pallets from the fit and `floor` for leftover pallets even
  when they hold one SKU; the UI labels `floor` as "FLOOR · mixed". Cosmetic, not changed.
- Before touching plans: check no pallet on the PO has left `planned` status (replan refuses otherwise),
  and compare against the routing list Rudy sent.
