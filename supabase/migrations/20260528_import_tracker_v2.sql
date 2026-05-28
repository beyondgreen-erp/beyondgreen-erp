-- ═══════════════════════════════════════════════════════
-- Import Tracker — Run this in Supabase SQL Editor
-- Safe version: handles already-exists errors gracefully
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS import_shipments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bg_po_number text,
  description text NOT NULL,
  case_qty integer DEFAULT 0,
  freight_method text NOT NULL DEFAULT 'OCEAN',
  etd date,
  eta_los_angeles date,
  vessel_name text,
  vessel_number text,
  flight_number text,
  booking_number text,
  bl_number text,
  hbl_number text,
  container_number text,
  shipper text,
  broker text,
  status text DEFAULT 'Pending',
  arrival_notice text,
  good_to_clear_by date,
  exw_price numeric DEFAULT 0,
  comm_inv_amt numeric DEFAULT 0,
  china_tariff_25pct numeric DEFAULT 0,
  duty_10pct numeric DEFAULT 0,
  mpf numeric DEFAULT 0,
  hmf numeric DEFAULT 0,
  total_duties numeric DEFAULT 0,
  broker_inv_amount numeric DEFAULT 0,
  total_landed_cost numeric DEFAULT 0,
  selling_price numeric DEFAULT 0,
  profit_margin_pct numeric DEFAULT 0,
  profit_amount numeric DEFAULT 0,
  broker_invoice_number text,
  broker_inv_date date,
  payment_ref text,
  payment_date date,
  current_lat numeric,
  current_lng numeric,
  last_tracked timestamptz,
  tracking_history jsonb DEFAULT '[]',
  product_id uuid,
  sku text,
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE import_shipments DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS import_po_idx ON import_shipments(bg_po_number);
CREATE INDEX IF NOT EXISTS import_status_idx ON import_shipments(status);
CREATE INDEX IF NOT EXISTS import_eta_idx ON import_shipments(eta_los_angeles);

-- Wrap realtime in exception block so it doesn't abort the script
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE import_shipments;
EXCEPTION WHEN OTHERS THEN
  -- already added, ignore
  NULL;
END;
$$;

CREATE OR REPLACE FUNCTION calculate_import_financials()
RETURNS TRIGGER AS $$
BEGIN
  NEW.china_tariff_25pct := COALESCE(NEW.comm_inv_amt, 0) * 0.25;
  NEW.duty_10pct         := COALESCE(NEW.comm_inv_amt, 0) * 0.10;
  IF COALESCE(NEW.mpf, 0) = 0 THEN NEW.mpf := 21.40; END IF;
  IF COALESCE(NEW.hmf, 0) = 0 THEN NEW.hmf := 1.28;  END IF;
  NEW.total_duties :=
    COALESCE(NEW.china_tariff_25pct, 0) +
    COALESCE(NEW.duty_10pct, 0) +
    COALESCE(NEW.mpf, 0) +
    COALESCE(NEW.hmf, 0);
  NEW.total_landed_cost :=
    COALESCE(NEW.comm_inv_amt, 0) +
    COALESCE(NEW.total_duties, 0) +
    COALESCE(NEW.broker_inv_amount, 0);
  IF COALESCE(NEW.selling_price, 0) > 0 THEN
    NEW.profit_amount      := NEW.selling_price - NEW.total_landed_cost;
    NEW.profit_margin_pct  := (NEW.profit_amount / NEW.selling_price) * 100;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS import_financials_trigger ON import_shipments;
CREATE TRIGGER import_financials_trigger
  BEFORE INSERT OR UPDATE ON import_shipments
  FOR EACH ROW EXECUTE FUNCTION calculate_import_financials();

-- ── Seed data (only if table is empty) ──────────────────
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM import_shipments) > 0 THEN
    RAISE NOTICE 'Seed skipped — table already has data.';
    RETURN;
  END IF;

  INSERT INTO import_shipments (
    bg_po_number, description, case_qty,
    freight_method, etd, eta_los_angeles,
    vessel_name, vessel_number,
    booking_number, bl_number, hbl_number,
    container_number, shipper, broker,
    status, arrival_notice,
    exw_price, comm_inv_amt,
    broker_inv_amount, broker_invoice_number,
    broker_inv_date
  ) VALUES
  -- AIR — KLM
  ('1831775','Jade | Liner Wrap | White | 12x6" | 1 color | 568U',10,'AIR','2026-05-18','2026-05-28','KLM AIRLINES','KL0872','SA26073911 / CA26061192','7445824656','068682','KL0872 / 27-May','PARAS WEBCOAT PVT.LTD','OEC LOGISTICS INC.','Received','Received',0,0,0,null,null),
  ('1831775','Rebel Hen | Liner Wrap | White | 12x12" | 2 color | 283U + 710U',60,'AIR','2026-05-18','2026-05-28','KLM AIRLINES','KL0872','SA26073911 / CA26061192','7445824656','068682','KL0872 / 27-May','PARAS WEBCOAT PVT.LTD','OEC LOGISTICS INC.','Received','Received',0,0,0,null,null),
  ('1831775','Backyard | Liner Wrap | White | 12x12" | 1 color | 3302C',4,'AIR','2026-05-18','2026-05-28','KLM AIRLINES','KL0872','SA26073911 / CA26061192','7445824656','068682','KL0872 / 27-May','PARAS WEBCOAT PVT.LTD','OEC LOGISTICS INC.','Received','Received',0,0,0,null,null),
  ('1831775','Kokos | Liner Wrap | White | 12x12" | 2 color | Red 185C + Blue 2193C',17,'AIR','2026-05-18','2026-05-28','KLM AIRLINES','KL0872','SA26073911 / CA26061192','7445824656','068682','KL0872 / 27-May','PARAS WEBCOAT PVT.LTD','OEC LOGISTICS INC.','Received','Received',0,0,0,null,null),
  ('1831775','Ziggys | Liner Wrap | White | 10x10" | 1 color | Red 1795C',65,'AIR','2026-05-18','2026-05-28','KLM AIRLINES','KL0872','SA26073911 / CA26061192','7445824656','068682','KL0872 / 27-May','PARAS WEBCOAT PVT.LTD','OEC LOGISTICS INC.','Received','Received',0,0,0,null,null),

  -- OCEAN — CMA CGM PETRA
  ('1831776','Kokos | Pretzel Bag | White | 7x7" | 1 color | Red 185C',40,'OCEAN','2026-05-31','2026-07-14','CMA CGM PETRA','0P507N1MA','3274291','CTLAH2600310','CTLAH2600310','SEKU4075280','PARAS WEBCOAT PVT.LTD','Paras/OEC','Gated','Pending',0,0,0,null,null),
  ('??','Jade | Liner Wrap | White | 12x6" | 1 color | 568U',3,'OCEAN','2026-05-31','2026-07-14','CMA CGM PETRA','0P507N1MA','3274291','CTLAH2600310','CTLAH2600310','SEKU4075280','PARAS WEBCOAT PVT.LTD','Paras/OEC','Gated','Pending',0,0,0,null,null),
  ('??','Backyard | Liner Wrap | White | 12x12" | 1 color | 3302C',1,'OCEAN','2026-05-31','2026-07-14','CMA CGM PETRA','0P507N1MA','3274291','CTLAH2600310','CTLAH2600310','SEKU4075280','PARAS WEBCOAT PVT.LTD','Paras/OEC','Gated','Pending',0,0,0,null,null),
  ('1831775','Petra | Liner Wrap | White | 12x12" | 1 color | Black',20,'OCEAN','2026-05-31','2026-07-14','CMA CGM PETRA','0P507N1MA','3274291','CTLAH2600310','CTLAH2600310','SEKU4075280','PARAS WEBCOAT PVT.LTD','Paras/OEC','Gated','Pending',0,0,0,null,null),
  ('1831775','Rebel Hen | Liner Wrap | White | 12x12" | 2 color | 283U + 710U',100,'OCEAN','2026-05-31','2026-07-14','CMA CGM PETRA','0P507N1MA','3274291','CTLAH2600310','CTLAH2600310','SEKU4075280','PARAS WEBCOAT PVT.LTD','Paras/OEC','Gated','Pending',0,0,0,null,null),

  -- OCEAN — CSCL AUTUMN (with financials)
  ('1831775','Mosh | Liner Wrap | Kraft | 12x12" | 2 color | Orange 164C + Red 3556C',17,'OCEAN','2026-05-10','2026-05-27','CSCL AUTUMN','0BHO3E1MA','SS26063798','CMDUQGD2815833','OERT205701P02031','CGMU5107756','SHANDONG SHENGHE PAPER-PLASTIC PACKAGING CO., LTD.','OEC LOGISTICS INC.','Received','Received',60.01,1020.17,678.62,'SS26063798/A','2026-05-26'),
  ('1831775','Taco Del Centre | Liner Wrap | Kraft | 12x12" | 2 color | Blue 281C + Green 572C',3,'OCEAN','2026-05-10','2026-05-27','CSCL AUTUMN','0BHO3E1MA','SS26063798','CMDUQGD2815833','OERT205701P02031','CGMU5107756','SHANDONG SHENGHE PAPER-PLASTIC PACKAGING CO., LTD.','OEC LOGISTICS INC.','Received','Received',103.93,311.79,207.46,'SS26063798/A','2026-05-26'),
  ('1831775','Tacos Del Centre | Liner Wrap | Kraft | 4x4" | 1 color | Blue 281C + Green 572C',20,'OCEAN','2026-05-10','2026-05-27','CSCL AUTUMN','0BHO3E1MA','SS26063798','CMDUQGD2815833','OERT205701P02031','CGMU5107756','SHANDONG SHENGHE PAPER-PLASTIC PACKAGING CO., LTD.','OEC LOGISTICS INC.','Received','Received',13.45,269.00,178.92,'SS26063798/A','2026-05-26'),

  -- OCEAN — CMA CGM T. JEFFERSON
  ('1850349','ONT FIELD FRY BOAT 3LB',100,'OCEAN','2026-05-23','2026-06-08','CMA CGM T. JEFFERSON / CMA CGM MAGELLAN','1TUI8E','SS26067900','CMDUCHN3379415','OERT201701P08345','BMOU5859691','YICHEN ENTEN SCIENCE AND TECHNOLOGY CO LTD','OEC LOGISTICS INC.','In Transit','Pending',0,0,0,null,null),
  ('1850349','ONT FIELD FRY BOAT 5 LB',100,'OCEAN','2026-05-23','2026-06-08','CMA CGM T. JEFFERSON / CMA CGM MAGELLAN','1TUI8E','SS26067900','CMDUCHN3379415','OERT201701P08345','BMOU5859691','YICHEN ENTEN SCIENCE AND TECHNOLOGY CO LTD','OEC LOGISTICS INC.','In Transit','Pending',0,0,0,null,null),
  ('1850349','ONT FIELD LOADED FRY BOX',100,'OCEAN','2026-05-23','2026-06-08','CMA CGM T. JEFFERSON / CMA CGM MAGELLAN','1TUI8E','SS26067900','CMDUCHN3379415','OERT201701P08345','BMOU5859691','YICHEN ENTEN SCIENCE AND TECHNOLOGY CO LTD','OEC LOGISTICS INC.','In Transit','Pending',0,0,0,null,null),
  ('1850349','ONT FIELD 12X12 LINER PAPER 40G ORG PTD PANTONE 7687C',10,'OCEAN','2026-05-23','2026-06-08','CMA CGM T. JEFFERSON / CMA CGM MAGELLAN','1TUI8E','SS26067900','CMDUCHN3379415','OERT201701P08345','BMOU5859691','YICHEN ENTEN SCIENCE AND TECHNOLOGY CO LTD','OEC LOGISTICS INC.','In Transit','Pending',0,0,0,null,null),
  ('1850349','ONT FIELD 12X12 LINER PAPER 40G OGR PTD PANTONE 311C',10,'OCEAN','2026-05-23','2026-06-08','CMA CGM T. JEFFERSON / CMA CGM MAGELLAN','1TUI8E','SS26067900','CMDUCHN3379415','OERT201701P08345','BMOU5859691','YICHEN ENTEN SCIENCE AND TECHNOLOGY CO LTD','OEC LOGISTICS INC.','In Transit','Pending',0,0,0,null,null),

  -- OCEAN — APL DANUBE
  ('1834026','Mosh | Burger Bag | Kraft | A5 | 2 color | Orange 164C + Red 3556C',75,'OCEAN','2026-06-02','2026-06-21','APL DANUBE','0M700E1MA','SS26078808',null,'OERT203701P02061','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','At Port of Dispatch','Pending',0,0,0,null,null),
  ('1831777','Mosh | Fry Cup | Kraft | 16oz | 2 color | Orange 164C + Red 3556C',370,'OCEAN','2026-06-02','2026-06-21','APL DANUBE','0M700E1MA','SS26078808',null,'OERT203701P02061','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','At Port of Dispatch','Pending',0,0,0,null,null),
  ('1834024','Kokos | Hoagie Box | White | 7x3x2.625 | 1 color | Red 185C + Blue 2193C',270,'OCEAN','2026-06-02','2026-06-21','APL DANUBE','0M700E1MA','SS26078808',null,'OERT203701P02061','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','At Port of Dispatch','Pending',0,0,0,null,null),
  ('1831777','Kokos | Fry Cup | Kraft | 16oz | 2 color | Red 185C + Blue 2193C',120,'OCEAN','2026-06-02','2026-06-21','APL DANUBE','0M700E1MA','SS26078808',null,'OERT203701P02061','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','At Port of Dispatch','Pending',0,0,0,null,null),
  ('1831778','Rebel Hen | Food Tray | White | 3# | 5 color | Cream 3-9U + Blue 283U + Red 710U + Yellow 122U + Black 6U',500,'OCEAN','2026-06-02','2026-06-21','APL DANUBE','0M700E1MA','SS26078808',null,'OERT203701P02061','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','At Port of Dispatch','Pending',0,0,0,null,null),

  -- AIR — CNXMN-USLAX
  ('1834026','Mosh | Burger Bag | Kraft | A5 | 2 color | Orange 164C + Red 3556C',75,'AIR','2026-05-31','2026-06-02','CNXMN - USLAX',null,'SA26078981',null,'OEC203P00175','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','Air Cargo Warehouse','Pending',0,0,0,null,null),
  ('1831777','Mosh | Fry Cup | Kraft | 16oz | 2 color | Orange 164C + Red 3556C',180,'AIR','2026-05-31','2026-06-02','CNXMN - USLAX',null,'SA26078981',null,'OEC203P00175','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','Air Cargo Warehouse','Pending',0,0,0,null,null),
  ('1834024','Kokos | Hoagie Box | White | 7x3x2.625 | 1 color | Red 185C + Blue 2193C',180,'AIR','2026-05-31','2026-06-02','CNXMN - USLAX',null,'SA26078981',null,'OEC203P00175','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','Air Cargo Warehouse','Pending',0,0,0,null,null),
  ('1831777','Kokos | Fry Cup | Kraft | 16oz | 2 color | Red 185C + Blue 2193C',80,'AIR','2026-05-31','2026-06-02','CNXMN - USLAX',null,'SA26078981',null,'OEC203P00175','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','Air Cargo Warehouse','Pending',0,0,0,null,null),
  ('1831778','Rebel Hen | Food Tray | White | 3# | 5 color | Cream 3-9U + Blue 283U + Red 710U + Yellow 122U + Black 6U',250,'AIR','2026-05-31','2026-06-02','CNXMN - USLAX',null,'SA26078981',null,'OEC203P00175','China #6 & #7','XIAMEN HONGJU UNITED TECHNOLOGY CO., LTD.','OEC LOGISTICS INC.','Air Cargo Warehouse','Pending',0,0,0,null,null);

END;
$$;

-- Verify
SELECT COUNT(*) AS shipment_count FROM import_shipments;
