# Thin-wall spork CAD package, BG-CUT-SPK-001 Rev A (Nov 5, 2026)

## What was asked
Rudy sent a photo of the BPI-embossed spork sample (the "BPI Embossed Spork" PNG from Oct 30, cavity 02)
and asked for a 3D design and a schematic of it, sized to match the beyondGREEN fork and spoon but
thinner so it is cheaper to produce, with the BPI engraving in place.

## Sources used
- `beyondGREEN_Cutlery_Mold_Drawings_BPI_Marking.pdf` (ERP Drawings & Dielines, Oct 9, 2026): spoon
  BG-CUT-SPN-001 is 147.1 long, 31.7 bowl, 16.7 high; fork BG-CUT-FRK-001 is 155.4 long, 25.0 head,
  14.9 high. Detail A on both: BPI mark Ø2.4, "BPI COMPOSTABLE" cap height 1.5, line length 21.0,
  raised 0.10 on the floor of the handle oval recess, marking line starts 24.6 (spoon) / 22.8 (fork)
  from the handle end, XX = cavity ID after the text.
- Drawing 22GV (`CUTLERY NEW DESIGN 151122`): handle 13 wide tapering to 9, neck 9.4, knife 170.
- Production weights: fork 4.30 g, spoon 4.10 g, knife 3.90 g (cost model, Aug 2026); the cutlery's
  max thickness tested by BPI is 1.316 mm, so the current wall is about 1.3 mm.
- The spork photo was measured from its alpha channel (PCA axis, width profile in % of length):
  bowl max width 20.5% at 16% from the tip, neck 5.5% at 36% from the tip, handle widening to 9.4%
  at the end, 4 tines with 3 slots 8.5% deep, outer slots centered at about 3.9% off center.
- `SPOON.stp` in Downloads is the 182 x 48 mm NX model (not the production spoon); not used.
- July 2026 chat "3D CAD rendering of a spork" produced REV A to D of a different, cafeteria-style
  spork (152 mm, 3.33 g, ribbed, handle cutout). This package is a new design matched to the photo.

## Design (all parametric in `spork_geom.py`)
- OAL 150.0 (between fork 155.4 and spoon 147.1), bowl 31.7 (= spoon), overall height 13.8,
  handle 13.6 at the end tapering to 8.6 at the neck (x = 96), bowl widest at x = 126.
- Walls: handle 1.05, neck 1.30, bowl and tines 1.00 (normal offset of the top surface).
- Underside ribs: spine 1.6 W x 0.85 H (x 10 to 104), neck gusset 3.2 W x 1.0 H (x 86 to 110),
  two edge ribs 0.9 W x 0.6 H inset 0.8 (x 8 to 80, flat region only). Max stack 1.90 handle, 2.30 neck (BPI limit 3.5).
- Marking per Detail A of the fork/spoon drawings: stadium recess 32 x 5.2 x 0.15 deep from x = 21,
  mark Ø2.4 at x = 24.6, 1.1 gap, text cap height 1.5, letters condensed in X so the line is 21.0,
  raised 0.10 (tops 0.05 below the handle face). Cavity ID not modeled (note on the drawing).
- CAD volume 2,483 mm3 -> 3.15 g at 1.27 g/cm3 (ecovio IA1542), vs 4.10 g spoon / 4.30 g fork (about 23% less resin).
- Side walls are vertical (bottom curve clamped to the plan outline), so the plan width is 31.7 at the top edge.

## Files
- `beyondGREEN_Spork_BG-CUT-SPK-001_RevA.step` (12 MB, body + 15 marking solids as a compound; the STEP in the
  ERP is zipped to 2.5 MB) and `.stl` (watertight, letters unioned with manifold3d). CadQuery loft of 67 sections.
- `beyondGREEN_Spork_BG-CUT-SPK-001_RevA_Drawing.pdf`, two landscape letter sheets in the die-line
  sheet style (green band, white logo, cards, address footer): sheet 1 top + front views 1.5:1 with
  dimensions and spec/mold/approval cards; sheet 2 sections A-A (handle 6:1) and B-B (bowl 3:1),
  bottom view with rib layout, gate zone and ejector pins, Detail A marking, rib schedule, marking notes.
- `beyondGREEN_Spork_RevA_renders.png`, `beyondGREEN_Spork_RevA_3D_Viewer.html` (three.js, STL embedded).
- Filed in the ERP Document Repository under Drawings & Dielines (document 1495c885-d78b-471a-b709-f249d7907174,
  four file_attachments) and saved to `~/Downloads/Spork BG-CUT-SPK-001 RevA/` on the iMac.

## Learned
- CadQuery B-spline "slab" booleans (prism of a B-spline face swept down, then subtract) are slow and
  unreliable; a loft of closed section wires (top spline, side, bottom spline, side) is fast (3 s for
  67 sections) and valid. Cut tine slots with planar prisms afterwards (15 s). A smooth loft oscillates
  (1.9 mm bulge on the handle) when station spacing jumps, so grow the spacing gradually from the ends.
- Ribs: on the flat handle use plain prisms; only the neck spine and gusset need short lofts of narrow
  sections. Full-length rib lofts made a 30 MB STEP; the light version is 12 MB (about 2 minutes to fuse).
- Fusing 15 text letters into the lofted body took more than 15 minutes (SIGALRM cannot interrupt OCC);
  build the body first, save a BREP, then export the marking as separate solids and union the meshes for the STL.
- Chrome `file_upload` only accepts attachment paths or files staged from the connected folders
  (/mnt/user-data/uploads/Downloads/...), not /mnt/user-data/outputs; commit outputs to Downloads with
  device_commit_files, stage them back, then upload. Headless WebGL renders: vendored three.js served
  over a local http.server (file:// blocks module imports) + Playwright with --use-gl=swiftshader.
- Liberation Sans Bold is metric-compatible with Arial; "BPI COMPOSTABLE" at 1.5 cap height is
  19.6 long, so the production marking (21.0 line incl. mark) uses letters condensed about 11%.
- Matplotlib hatch line width is set with `plt.rcParams["hatch.linewidth"]`; section views at 6:1
  and 3:1 read well on a letter sheet. Keep leaders short and never let handle edge lines run into cards.
