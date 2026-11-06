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
