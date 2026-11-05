# Shopper bags: where the home compostability evidence is (Nov 5, 2026)

## The question
Dhanush asked for "the OWS lab results" for the green and black shopper bags so VJ can ask OWS what BPI
home certification would need and cost, given the bags already hold TUV OK compost HOME.

## Finding
There is no OWS home compost test on the bags. TUV AUSTRIA extended OK compost HOME certificate
TA8021601457 to shopping bags in Sep 2022 (thread "General Purpose Bags Certification", Veejay <> Evelyn
Wessel, in the rudy.patel@byndgrn.com mailbox) on this basis:
- BASF ecovio F23B1 is itself OK compost HOME certified (TA8021802479, max 24 um);
- OWS RA.VCP-4 (Aug 23, 2022): heavy metals and fluorine of Aqua-FM LC Black and Green inks (max 0.1% each);
- Soil Control Lab 2070447-01 (green) and -02 (natural) chemical characterizations (Aug 23, 2022);
- TUV's own IR fingerprint and thickness checks (reports 2021-AG-1150cert and 2022-AG-0997insp).
Later bag lab work: Soil Control Lab 3110646-01 ASTM D6400-23 pass on handle bags and liners (Mar 8, 2024);
Soil Control Lab 6080255 characterization of 2018100 green/beige shopper bags (Sep 24, 2026) for BPI recert 20260721-06.
The 3060281-01 NF T51-800 / ASTM D6400 reports (Oct 24 upload) are the CUTLERY formulation (IA1542/LX175/Evanesto), not bags.

OWS OK compost HOME program pricing (Jan 26, 2023, Maggie McDonald): characterization $1,138; home biodegradation
$9,465; quantitative disintegration $8,425 (qualitative $5,511 if industrial disintegration passed); compost prep $7,681;
ecotox $4,766; three of these waived with existing BPI certification. Indicative only.

## What was done in the ERP
All nine documents were already in the Document Repository (Certifications & Compliance > Certificates and
Lab & Test Reports). Retitled from file-name titles to descriptive titles, set effective dates, tags, notes
(original file names kept in notes), fixed one category (6080255 was "Certificate", now Quality Record) and
re-pointed certification links: the 2022 TUV/OWS/SCL bag evidence now hangs off the Compliance board item
"TUV AUSTRIA OK compost HOME -- Bags -- TA8021601457" (2a8525d3), the 2026 characterization off the BPI
shopper bag item 20260721-06 (d086312a). The certification basis and the OWS pricing were written into that
TUV item's notes so the Compliance board explains itself.

## Learned
- Document Repository = `documents` table (+ `document_folders`, `file_attachments` record_type 'documents');
  files live in bucket erp-files under documents/<doc id>/<ts>_<name>. Certification links are one per document.
- ERP storage files can be pulled from the signed-in ERP tab in Chrome with the user token from the
  sb-...-auth-token cookie and a blob download; they land in ~/Downloads and stage from there.
- The Outlook tab can silently switch to the rudy.patel@byndgrn.com account; check the folder pane header
  before assuming which mailbox a search hit. The 2021-2023 certification history (TUV, OWS) lives in byndgrn.
