import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */

// ── 37 customer-named orders ───────────────────────────────────────────────
const ORDERS: any[] = [
  // ── Make To Stock (7) — internal beyondGREEN production ──────────────────
  { monday_item_id:'7234501001', name:'beyondGREEN Biotech', section:'Make To Stock', po_number:'1851001', status:'In Production', facility:'Santa Ana', order_date:'2026-04-28', production_start:'2026-05-05', estimated_completion:'2026-06-10', total_value:4250, additional_comments:'Standard Kraft bag replenishment',
    line_items:[{line_number:1,sku:'BG-BAG-7426',qty:5000,completed_qty:2500,qty_per_case:500,uom:'EA',packaging:'Case',production_status:'In Production',added_details:'Kraft Bag 7x4x2.625"',sku_flagged:false},{line_number:2,sku:'BG-BAG-84106',qty:2500,completed_qty:0,qty_per_case:500,uom:'EA',packaging:'Case',production_status:'Scheduled',added_details:'Kraft Bag 8x4x10.5"',sku_flagged:false}]},
  { monday_item_id:'7234501002', name:'beyondGREEN Biotech', section:'Make To Stock', po_number:'1851002', status:'Ready to Ship', facility:'Santa Ana', order_date:'2026-04-15', production_start:'2026-04-22', estimated_completion:'2026-05-20', total_value:3100, additional_comments:null,
    line_items:[{line_number:1,sku:'BG-LW-1210W',qty:10000,completed_qty:10000,qty_per_case:1000,uom:'EA',packaging:'Case',production_status:'Complete',added_details:'Liner Wrap White 12x10"',sku_flagged:false}]},
  { monday_item_id:'7234501003', name:'beyondGREEN Biotech', section:'Make To Stock', po_number:'1851003', status:'Shipped', facility:'Santa Ana', order_date:'2026-04-01', estimated_completion:'2026-04-30', ship_date:'2026-05-02', total_value:6800,
    line_items:[{line_number:1,sku:'BG-CUT-CPLA-KIT',qty:3000,completed_qty:3000,qty_per_case:250,uom:'KIT',packaging:'Case',production_status:'Shipped',added_details:'CPLA Cutlery Kit Individual',sku_flagged:false}]},
  { monday_item_id:'7234501004', name:'beyondGREEN Biotech', section:'Make To Stock', po_number:'1851004', status:'Confirmed', facility:'Santa Ana', order_date:'2026-05-10', estimated_completion:'2026-06-20', total_value:5200,
    line_items:[{line_number:1,sku:'BG-CUP-PLA16',qty:2000,completed_qty:0,qty_per_case:500,uom:'EA',packaging:'Sleeve',production_status:'Scheduled',added_details:'16oz PLA Clear Cup',sku_flagged:false}]},
  { monday_item_id:'7234501005', name:'beyondGREEN Biotech', section:'Make To Stock', po_number:'1851005', status:'In Production', facility:'Santa Ana', order_date:'2026-05-01', production_start:'2026-05-08', estimated_completion:'2026-06-05', total_value:2900,
    line_items:[{line_number:1,sku:'BG-LW-1212W',qty:8000,completed_qty:3500,qty_per_case:500,uom:'EA',packaging:'Case',production_status:'In Production',added_details:'Liner Wrap White 12x12" 40g',sku_flagged:false}]},
  { monday_item_id:'7234501006', name:'beyondGREEN Biotech', section:'Make To Stock', po_number:'1851006', status:'In Production', facility:'Santa Ana', order_date:'2026-05-05', production_start:'2026-05-12', estimated_completion:'2026-06-12', total_value:7100,
    line_items:[{line_number:1,sku:'BG-TRAY-3LBW',qty:4000,completed_qty:1000,qty_per_case:200,uom:'EA',packaging:'Case',production_status:'In Production',added_details:'Food Tray 3lb White Unprinted',sku_flagged:false},{line_number:2,sku:'BG-TRAY-5LBW',qty:2000,completed_qty:0,qty_per_case:200,uom:'EA',packaging:'Case',production_status:'Awaiting',added_details:'Food Tray 5lb White',sku_flagged:false}]},
  { monday_item_id:'7234501007', name:'beyondGREEN Biotech', section:'Make To Stock', po_number:'1851007', status:'Ready to Ship', facility:'Santa Ana', order_date:'2026-04-20', production_start:'2026-04-28', estimated_completion:'2026-05-28', total_value:3450,
    line_items:[{line_number:1,sku:'BG-FC-16K',qty:5000,completed_qty:5000,qty_per_case:500,uom:'EA',packaging:'Case',production_status:'Complete',added_details:'16oz Fry Cup Kraft',sku_flagged:false}]},
  // ── Private Label (8) ─────────────────────────────────────────────────────
  { monday_item_id:'7234502001', name:'Mosh Restaurant Group|1834026', section:'Private Label', po_number:'1834026', status:'In Production', facility:'Santa Ana', order_date:'2026-04-10', production_start:'2026-04-18', estimated_completion:'2026-05-30', customer_email:'ops@moshrestaurant.com', total_value:5600, additional_comments:'Orange 164C + Red 3556C — approve proof before run',
    line_items:[{line_number:1,sku:'MOSH-BB-A5',qty:750,completed_qty:375,qty_per_case:75,uom:'CASE',packaging:'Master Case',production_status:'In Production',added_details:'Mosh Burger Bag Kraft A5 2-color',sku_flagged:false}]},
  { monday_item_id:'7234502002', name:'Rebel Hen Chicken|1831778', section:'Private Label', po_number:'1831778', status:'Ready to Ship', facility:'Santa Ana', order_date:'2026-04-01', production_start:'2026-04-08', estimated_completion:'2026-05-15', customer_email:'orders@rebelhen.com', total_value:9200,
    line_items:[{line_number:1,sku:'RH-TRAY-3LB',qty:750,completed_qty:750,qty_per_case:150,uom:'CASE',packaging:'Master Case',production_status:'Complete',added_details:'Rebel Hen Food Tray White 3# 5-color',sku_flagged:false}]},
  { monday_item_id:'7234502003', name:'Kokos Kitchen|1831777', section:'Private Label', po_number:'1831777', status:'In Production', facility:'Santa Ana', order_date:'2026-04-15', production_start:'2026-04-22', estimated_completion:'2026-06-01', customer_email:'purchasing@kokoskitchen.com', total_value:4100,
    line_items:[{line_number:1,sku:'KK-FC-16K',qty:500,completed_qty:200,qty_per_case:100,uom:'CASE',packaging:'Case',production_status:'In Production',added_details:'Kokos Fry Cup Kraft 16oz 2-color Red 185C + Blue 2193C',sku_flagged:false}]},
  { monday_item_id:'7234502004', name:'Jade Restaurant Group|1831775', section:'Private Label', po_number:'1831775', status:'Shipped', facility:'Santa Ana', order_date:'2026-03-20', production_start:'2026-03-28', estimated_completion:'2026-05-10', ship_date:'2026-05-14', customer_email:'ops@jaderestaurants.com', total_value:3800,
    line_items:[{line_number:1,sku:'JADE-LW-126',qty:1000,completed_qty:1000,qty_per_case:500,uom:'CASE',packaging:'Case',production_status:'Shipped',added_details:'Jade Liner Wrap White 12x6" 1-color 568U',sku_flagged:false}]},
  { monday_item_id:'7234502005', name:'Backyard BBQ Co|1831775B', section:'Private Label', po_number:'1831775B', status:'Pending', facility:'Santa Ana', order_date:'2026-05-12', estimated_completion:'2026-07-10', customer_email:'buyer@backyardbbq.com', total_value:2700, additional_comments:'Awaiting artwork approval',
    line_items:[{line_number:1,sku:null,qty:600,completed_qty:0,qty_per_case:300,uom:'CASE',packaging:'Case',production_status:'Pending',added_details:'Backyard BBQ Liner Wrap White 12x12" 1-color 3302C',sku_flagged:true}]},
  { monday_item_id:'7234502006', name:'Taco Del Centre|1831775C', section:'Private Label', po_number:'1831775C', status:'In Production', facility:'Santa Ana', order_date:'2026-04-25', production_start:'2026-05-02', estimated_completion:'2026-06-08', customer_email:'ops@tacodelcentre.com', total_value:4400,
    line_items:[{line_number:1,sku:'TDC-LW-1212K',qty:400,completed_qty:150,qty_per_case:100,uom:'CASE',packaging:'Case',production_status:'In Production',added_details:'Taco Del Centre Liner Wrap Kraft 12x12" Blue 281C + Green 572C',sku_flagged:false}]},
  { monday_item_id:'7234502007', name:'ONT Field Services|1850349', section:'Private Label', po_number:'1850349', status:'In Production', facility:'Santa Ana', order_date:'2026-04-20', production_start:'2026-04-28', estimated_completion:'2026-06-05', customer_email:'purchasing@ontfield.com', total_value:11200,
    line_items:[{line_number:1,sku:'ONT-FB-3LB',qty:500,completed_qty:200,qty_per_case:100,uom:'CASE',packaging:'Master Case',production_status:'In Production',added_details:'ONT Field Fry Boat 3LB'},{line_number:2,sku:'ONT-FB-5LB',qty:500,completed_qty:100,qty_per_case:100,uom:'CASE',packaging:'Master Case',production_status:'In Production',added_details:'ONT Field Fry Boat 5LB'},{line_number:3,sku:null,qty:300,completed_qty:0,qty_per_case:100,uom:'CASE',packaging:'Master Case',production_status:'Awaiting',added_details:'ONT Field Loaded Fry Box',sku_flagged:true}]},
  { monday_item_id:'7234502008', name:'Ziggys Deli|1831776Z', section:'Private Label', po_number:'1831776Z', status:'Confirmed', facility:'Santa Ana', order_date:'2026-05-08', estimated_completion:'2026-06-25', customer_email:'ops@ziggysdeli.com', total_value:3200,
    line_items:[{line_number:1,sku:'ZIG-PB-77',qty:800,completed_qty:0,qty_per_case:200,uom:'CASE',packaging:'Case',production_status:'Scheduled',added_details:'Ziggys Pretzel Bag White 7x7" Red 185C',sku_flagged:false}]},
  // ── Straw Orders (6) ──────────────────────────────────────────────────────
  { monday_item_id:'7234503001', name:'Green Compass Foodservice', section:'Straw Orders', po_number:'GC-STR-001', status:'In Production', facility:'Santa Ana', order_date:'2026-04-22', production_start:'2026-05-01', estimated_completion:'2026-06-01', customer_email:'orders@greencompass.com', total_value:8500,
    line_items:[{line_number:1,sku:'BG-STR-775W-KR',qty:50000,completed_qty:25000,qty_per_case:5000,uom:'EA',packaging:'Case',production_status:'In Production',added_details:'7.75" Kraft Wrapped Paper Straw',sku_flagged:false}]},
  { monday_item_id:'7234503002', name:'EcoServe Packaging|ES-STR-002', section:'Straw Orders', po_number:'ES-STR-002', status:'Ready to Ship', facility:'Santa Ana', order_date:'2026-04-10', production_start:'2026-04-18', estimated_completion:'2026-05-18', total_value:6200,
    line_items:[{line_number:1,sku:'BG-STR-908W',qty:30000,completed_qty:30000,qty_per_case:3000,uom:'EA',packaging:'Case',production_status:'Complete',added_details:'9" Jumbo Paper Straw White Wrapped',sku_flagged:false}]},
  { monday_item_id:'7234503003', name:"Nature's Table", section:'Straw Orders', po_number:'NT-STR-003', status:'On Hold', facility:'Santa Ana', order_date:'2026-04-30', total_value:3400, additional_comments:'On hold — raw material shortage',
    line_items:[{line_number:1,sku:'BG-STR-575U',qty:100000,completed_qty:0,qty_per_case:10000,uom:'EA',packaging:'Case',production_status:'On Hold',added_details:'5.75" Cocktail Straw Unwrapped',sku_flagged:false}]},
  { monday_item_id:'7234503004', name:'Wholesome Foods Co', section:'Straw Orders', po_number:'WF-STR-004', status:'Shipped', facility:'Santa Ana', order_date:'2026-03-25', production_start:'2026-04-01', estimated_completion:'2026-04-28', ship_date:'2026-05-01', total_value:7800,
    line_items:[{line_number:1,sku:'BG-STR-912WC',qty:20000,completed_qty:20000,qty_per_case:2000,uom:'EA',packaging:'Case',production_status:'Shipped',added_details:'9" Colossal Smoothie Straw 12mm Wrapped',sku_flagged:false}]},
  { monday_item_id:'7234503005', name:'Fresh Market Co|FM-STR-005', section:'Straw Orders', po_number:'FM-STR-005', status:'Pending', facility:'Santa Ana', order_date:'2026-05-14', estimated_completion:'2026-07-05', total_value:4900, additional_comments:'Custom logo print — awaiting artwork',
    line_items:[{line_number:1,sku:null,qty:40000,completed_qty:0,qty_per_case:4000,uom:'EA',packaging:'Case',production_status:'Pending',added_details:'8" x 6mm Kraft Custom Print Straw — logo TBD',sku_flagged:true}]},
  { monday_item_id:'7234503006', name:'Harvest Kitchen', section:'Straw Orders', po_number:'HK-STR-006', status:'In Production', facility:'Santa Ana', order_date:'2026-05-05', production_start:'2026-05-14', estimated_completion:'2026-06-15', customer_email:'purchasing@harvestkitchen.com', total_value:5100,
    line_items:[{line_number:1,sku:'BG-STR-775BW',qty:35000,completed_qty:10000,qty_per_case:3500,uom:'EA',packaging:'Case',production_status:'In Production',added_details:'7.75" Bendy Paper Straw White Wrapped',sku_flagged:false}]},
  // ── Customer DropShip (6) ─────────────────────────────────────────────────
  { monday_item_id:'7234504001', name:'Imperial Dade|ID-0441', section:'Customer DropShip', po_number:'ID-2026-0441', status:'In Production', facility:'Santa Ana', order_date:'2026-05-02', production_start:'2026-05-10', estimated_completion:'2026-06-10', customer_email:'purchasing@imperialdade.com', customer_phone:'201-555-0100', total_value:14500, additional_comments:'Ship to NJ distribution center',
    line_items:[{line_number:1,sku:'BG-BAG-ECO-M',qty:10000,completed_qty:4000,qty_per_case:1000,uom:'CASE',packaging:'Master Case',production_status:'In Production',added_details:'Compostable Bag Medium',sku_flagged:false},{line_number:2,sku:'BG-BAG-ECO-L',qty:5000,completed_qty:0,qty_per_case:500,uom:'CASE',packaging:'Master Case',production_status:'Awaiting',added_details:'Compostable Bag Large',sku_flagged:false}]},
  { monday_item_id:'7234504002', name:'Imperial Dade|ID-0382', section:'Customer DropShip', po_number:'ID-2026-0382', status:'Shipped', facility:'Santa Ana', order_date:'2026-04-08', production_start:'2026-04-15', estimated_completion:'2026-05-08', ship_date:'2026-05-10', customer_email:'purchasing@imperialdade.com', total_value:18200,
    line_items:[{line_number:1,sku:'BG-CUT-IW-KIT',qty:5000,completed_qty:5000,qty_per_case:250,uom:'CASE',packaging:'Case',production_status:'Shipped',added_details:'CPLA Cutlery Kit Individually Wrapped',sku_flagged:false}]},
  { monday_item_id:'7234504003', name:'Performance Food Group|PFG-1122', section:'Customer DropShip', po_number:'PFG-2026-1122', status:'Ready to Ship', facility:'Santa Ana', order_date:'2026-04-18', production_start:'2026-04-25', estimated_completion:'2026-05-25', customer_email:'ops@pfg.com', total_value:22100, additional_comments:'Pallet label required — call 2 days before ship',
    line_items:[{line_number:1,sku:'BG-TRAY-3LBW',qty:8000,completed_qty:8000,qty_per_case:400,uom:'CASE',packaging:'Master Case',production_status:'Complete',added_details:'Food Tray 3lb White Unprinted',sku_flagged:false}]},
  { monday_item_id:'7234504004', name:'Sysco|SYS-9981', section:'Customer DropShip', po_number:'SYSCO-2026-9981', status:'In Production', facility:'Santa Ana', order_date:'2026-05-04', production_start:'2026-05-12', estimated_completion:'2026-06-12', customer_email:'nat.procurement@sysco.com', total_value:16800,
    line_items:[{line_number:1,sku:'BG-LW-1212K',qty:20000,completed_qty:8000,qty_per_case:1000,uom:'CASE',packaging:'Master Case',production_status:'In Production',added_details:'Liner Wrap 12x12 Kraft Unprinted',sku_flagged:false}]},
  { monday_item_id:'7234504005', name:'US Foods|USF-7741', section:'Customer DropShip', po_number:'USF-2026-7741', status:'On Hold', facility:'Santa Ana', order_date:'2026-05-06', customer_email:'supply@usfoods.com', total_value:9600, additional_comments:'On hold — credit approval pending',
    line_items:[{line_number:1,sku:null,qty:5000,completed_qty:0,qty_per_case:500,uom:'CASE',packaging:'Case',production_status:'On Hold',added_details:'Custom compostable bags — SKU pending assignment',sku_flagged:true}]},
  { monday_item_id:'7234504006', name:'Gordon Food Service|GFS-3318', section:'Customer DropShip', po_number:'GFS-2026-3318', status:'Pending', facility:'Santa Ana', order_date:'2026-05-16', estimated_completion:'2026-07-01', customer_email:'buy@gfs.com', total_value:11400,
    line_items:[{line_number:1,sku:null,qty:3000,completed_qty:0,qty_per_case:500,uom:'CASE',packaging:'Case',production_status:'Pending',added_details:'8oz PLA Soup Cup — SKU to be assigned',sku_flagged:true}]},
  // ── Injection Molding (5) ─────────────────────────────────────────────────
  { monday_item_id:'7234505001', name:'beyondGREEN Biotech', section:'Injection Molding', po_number:'IM-2026-0101', status:'In Production', facility:'Tool Shop - Vendor', order_date:'2026-03-15', production_start:'2026-03-22', estimated_completion:'2026-06-15', total_value:45000, additional_comments:'H13 Tool Steel. 4-cavity each.',
    line_items:[{line_number:1,sku:'TOOL-CUT-FORK',qty:1,completed_qty:0,uom:'EA',production_status:'T1 Sample',added_details:'Fork Mold 4-cavity',sku_flagged:false},{line_number:2,sku:'TOOL-CUT-KNIFE',qty:1,completed_qty:0,uom:'EA',production_status:'T1 Sample',added_details:'Knife Mold 4-cavity',sku_flagged:false}]},
  { monday_item_id:'7234505002', name:'beyondGREEN Biotech', section:'Injection Molding', po_number:'IM-2026-0102', status:'On Hold', facility:'Tool Shop - Vendor', order_date:'2026-04-01', total_value:28000, additional_comments:'On hold — design revision in progress',
    line_items:[{line_number:1,sku:null,qty:1,completed_qty:0,uom:'EA',production_status:'Design Review',added_details:'16oz Flat Lid Mold — design TBD',sku_flagged:true}]},
  { monday_item_id:'7234505003', name:'beyondGREEN Biotech', section:'Injection Molding', po_number:'IM-2026-0103', status:'Ready to Ship', facility:'Tool Shop - Vendor', order_date:'2026-02-20', production_start:'2026-03-01', estimated_completion:'2026-05-15', total_value:32000, additional_comments:'T3 approved. Ready to ship to plant.',
    line_items:[{line_number:1,sku:'TOOL-CS-663',qty:1,completed_qty:1,uom:'EA',production_status:'T3 Approved',added_details:'Clamshell Mold 6x6x3 2-cavity',sku_flagged:false}]},
  { monday_item_id:'7234505004', name:'beyondGREEN Biotech', section:'Injection Molding', po_number:'IM-2026-0104', status:'Shipped', facility:'Tool Shop - Vendor', order_date:'2026-01-15', production_start:'2026-01-22', estimated_completion:'2026-04-01', ship_date:'2026-04-05', total_value:38500,
    line_items:[{line_number:1,sku:'TOOL-STR-SET5',qty:5,completed_qty:5,uom:'EA',production_status:'Shipped',added_details:'Straw Mold Set — 5 diameter sizes',sku_flagged:false}]},
  { monday_item_id:'7234505005', name:'beyondGREEN Biotech', section:'Injection Molding', po_number:'IM-2026-0105', status:'Pending', facility:'Tool Shop - Vendor', order_date:'2026-05-10', estimated_completion:'2026-08-15', total_value:22000, additional_comments:'Quote accepted. Awaiting PO.',
    line_items:[{line_number:1,sku:null,qty:1,completed_qty:0,uom:'EA',production_status:'Pending PO',added_details:'Food Tray 3lb Thermoform Mold',sku_flagged:true}]},
  // ── Paper Products (4) ────────────────────────────────────────────────────
  { monday_item_id:'7234506001', name:'beyondGREEN Biotech', section:'Paper Products', po_number:'PP-2026-0201', status:'In Production', facility:'Santa Ana', order_date:'2026-05-03', production_start:'2026-05-10', estimated_completion:'2026-06-10', total_value:6700, additional_comments:'For liner wrap production run',
    line_items:[{line_number:1,sku:'RM-KP-40-24',qty:50,completed_qty:20,uom:'ROLLS',packaging:'Pallet',production_status:'In Production',added_details:'Bleached Kraft 40g 24" Roll',sku_flagged:false}]},
  { monday_item_id:'7234506002', name:'beyondGREEN Biotech', section:'Paper Products', po_number:'PP-2026-0202', status:'Ready to Ship', facility:'Santa Ana', order_date:'2026-04-12', production_start:'2026-04-20', estimated_completion:'2026-05-20', total_value:4900,
    line_items:[{line_number:1,sku:'RM-LP-40-311',qty:30,completed_qty:30,uom:'ROLLS',packaging:'Pallet',production_status:'Complete',added_details:'Liner Paper 40G OGR Pantone 311C',sku_flagged:false}]},
  { monday_item_id:'7234506003', name:'beyondGREEN Biotech', section:'Paper Products', po_number:'PP-2026-0203', status:'Confirmed', facility:'Santa Ana', order_date:'2026-05-08', estimated_completion:'2026-06-20', total_value:8800, additional_comments:'PHA coating spec must be confirmed',
    line_items:[{line_number:1,sku:'RM-CB-500R',qty:10,completed_qty:0,uom:'ROLLS',packaging:'Pallet',production_status:'Scheduled',added_details:'Compostable Paper Bag Stock 500m Roll',sku_flagged:false}]},
  { monday_item_id:'7234506004', name:'beyondGREEN Biotech', section:'Paper Products', po_number:'PP-2026-0204', status:'Shipped', facility:'Santa Ana', order_date:'2026-03-10', production_start:'2026-03-18', estimated_completion:'2026-04-20', ship_date:'2026-04-22', total_value:5100,
    line_items:[{line_number:1,sku:'RM-LP-40-7687',qty:25,completed_qty:25,uom:'ROLLS',packaging:'Pallet',production_status:'Shipped',added_details:'Liner Paper 40G ORG PTD Pantone 7687C',sku_flagged:false}]},
  // ── Outsourced (1) ───────────────────────────────────────────────────────
  { monday_item_id:'7234507001', name:'Kokos Kitchen|1834024', section:'Outsourced', po_number:'1834024', status:'In Production', facility:'Vendor - Xiamen', order_date:'2026-04-15', production_start:'2026-04-22', estimated_completion:'2026-06-15', customer_email:'purchasing@kokoskitchen.com', total_value:7800, additional_comments:'APL Danube vessel ETA 2026-06-21',
    line_items:[{line_number:1,sku:'KK-HB-7325',qty:450,completed_qty:450,qty_per_case:90,uom:'CASE',packaging:'Master Case',production_status:'At Port',added_details:'Kokos Hoagie Box White 7x3x2.625" Red 185C + Blue 2193C',sku_flagged:false}]},
]

const STATUS_MAP: Record<string, string> = {
  'Sales Order':'Pending','New Order':'Pending','Awaiting Production':'Confirmed',
  'Awaiting BOM Components':'Confirmed','In Production':'In Production',
  'Production Complete':'Ready to Ship','Ready for PS':'Ready to Ship',
  'Ready at Will Call':'Ready to Ship','Partially Shipped':'Shipped',
  'Shipped by Supplier':'Shipped','On HOLD':'On Hold',
  Pending:'Pending',Confirmed:'Confirmed',Shipped:'Shipped',
  'Ready to Ship':'Ready to Ship','On Hold':'On Hold',
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  // Wipe existing orders first
  await supabase.from('sales_order_lines').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('sales_orders').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  let inserted = 0
  const errors: string[] = []

  for (const order of ORDERS) {
    const rawName = String(order.name ?? '')
    const customerName = rawName.split('|')[0].trim()

    let customerId: string | null = null
    if (customerName) {
      const { data: ex } = await supabase.from('customers').select('id').ilike('company_name', customerName).limit(1).maybeSingle()
      if (ex) {
        customerId = ex.id
      } else {
        const { data: nc } = await supabase.from('customers').insert({
          company_name: customerName,
          email: order.customer_email ?? null,
          phone: order.customer_phone ?? null,
        }).select('id').single()
        if (nc) customerId = nc.id
      }
    }

    const baseOrder: Record<string, any> = {
      customer_id: customerId,
      order_number: order.po_number ?? ('SO-' + order.monday_item_id),
      status: STATUS_MAP[order.status] ?? order.status ?? 'Pending',
      order_date: order.order_date ?? null,
      required_ship_date: order.ship_date ?? null,
      po_number: order.po_number ?? null,
      notes: rawName,
      carrier: order.facility ?? null,
      subtotal: order.total_value ?? 0,
      total: order.total_value ?? 0,
      tax_pct: 0,
    }
    const extOrder: Record<string, any> = {
      monday_item_id: order.monday_item_id ?? null,
      order_section: order.section ?? null,
      facility: order.facility ?? null,
      production_start: order.production_start ?? null,
      estimated_completion: order.estimated_completion ?? null,
      ship_date: order.ship_date ?? null,
      customer_email: order.customer_email ?? null,
      customer_phone: order.customer_phone ?? null,
      additional_comments: order.additional_comments ?? null,
      total_amount: order.total_value ?? 0,
    }

    let { data: newOrder, error: oErr } = await supabase.from('sales_orders').insert({ ...baseOrder, ...extOrder }).select('id').single()
    if (oErr?.message?.includes('column')) {
      const fb = await supabase.from('sales_orders').insert(baseOrder).select('id').single()
      oErr = fb.error; if (!oErr) newOrder = fb.data
    }
    if (oErr) { errors.push(`${rawName}: ${oErr.message}`); continue }

    for (const line of (order.line_items ?? []) as any[]) {
      let productId: string | null = null
      let productName = line.added_details ?? line.sku ?? ''
      let unitCost = 0
      if (line.sku) {
        const { data: prod } = await supabase.from('products').select('id,product_name,unit_cost').eq('sku', line.sku).maybeSingle()
        if (prod) { productId = prod.id; productName = prod.product_name; unitCost = prod.unit_cost ?? 0 }
      }
      const desc = [line.added_details ?? line.sku ?? '', line.packaging ? `(${line.packaging})` : null].filter(Boolean).join(' ')
      const baseLine: Record<string, any> = {
        sales_order_id: newOrder!.id,
        product_id: productId,
        sku: line.sku ?? null,
        description: desc || productName,
        quantity: line.qty ?? 0,
        quantity_shipped: line.completed_qty ?? 0,
        unit_of_measure: line.uom ?? null,
        unit_price: unitCost,
        line_number: line.line_number ?? 1,
        discount_pct: 0,
      }
      const extLine: Record<string, any> = {
        added_details: line.added_details ?? null,
        completed_qty: line.completed_qty ?? 0,
        qty_per_case: line.qty_per_case ?? null,
        packaging: line.packaging ?? null,
        production_status: line.production_status ?? null,
        sku_flagged: line.sku_flagged ?? false,
      }
      const lRes = await supabase.from('sales_order_lines').insert({ ...baseLine, ...extLine })
      if (lRes.error?.message?.includes('column')) {
        await supabase.from('sales_order_lines').insert(baseLine)
      }
    }
    inserted++
  }

  const { count } = await supabase.from('sales_orders').select('*', { count: 'exact', head: true })
  return NextResponse.json({ success: true, inserted, errors: errors.slice(0, 20), total_in_db: count })
}
