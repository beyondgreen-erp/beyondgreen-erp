# 10 x 7 x 12 paper bag die line (Nov 6, 2026)

- Matched to existing SKU NK10712 (TDS in ERP): twisted handle kraft bag, 110 GSM, 10 W x 7 G x 12 H, UPC 850061686657.
- Flat blank 34.75 x 17.75 in: glue flap 0.75, panels 10/7/10/7, top turnover 1.5 (handle patches inside), bottom fold 4.25 (G/2 + 0.75).
  Safe print 9 x 10.75 per panel (0.5 sides/bottom, 0.75 below finished top). Bleed 0.125.
- Template: Rudy's die line format (green header band, white logo, cards, footer). Built as HTML + inline SVG, PDF via Playwright
  (scripts/dieline_paper_bag_10x7x12.py writes bag.html; render with page.pdf 11x8.5 in, print_background).
- Filed: ERP document 2725a1fd-8767-4c20-bf74-234ba8f9edb2 in Drawings & Dielines; ~/Downloads/beyondGREEN_10x7x12_Paper_Bag_Die_Line.pdf.
- Learned: check the ERP for an existing SKU/TDS before assuming a bag style (first draft assumed SOS no-handle).
  device_commit_files can leave the old file when re-committing quickly; verify size with device_bash and use force.
  Template dieline source HTML is not kept anywhere; rebuild from the PDFs in /mnt/attach/outputs.

## 12 x 7 x 17 (NK12717), same day
- Same template, W/G/H = 12/7/17, 110 GSM, twisted handles (from products table: NK12717). No UPC found, so none shown.
- Flat blank 38.75 x 22.75 in, safe 11 x 15.75 per panel. Scale ~1:7 (S=13.4 px/in), preview k=4.6.
- ERP document 26635593-34fc-4ad5-8a51-2bf1502dbd1b (Drawings & Dielines). Script: scripts/dieline_paper_bag_12x7x17.py.
- device_commit_files again wrote a stale version on first commit; always verify size and force-recommit.
