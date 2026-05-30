import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ORDERS: any[] = [
  // ── Make To Stock (8) ────────────────────────────────────────────────────
  {
    monday_item_id: '7234501001', name: 'Stock | Standard Kraft Bags 7x4x2.25"', section: 'Make To Stock',
    po_number: '1851001', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-04-28', production_start: '2026-05-05', estimated_completion: '2026-06-10',
    customer_email: null, total_value: 4250, additional_comments: 'Standard replenishment',
    line_items: [
      { line_number: 1, sku: 'BG-BAG-001', qty: 5000, completed_qty: 2500, qty_per_case: 500, uom: 'EA', packaging: 'Case', production_status: 'In Production', added_details: 'Kraft Bag 7x4x2.25"', sku_flagged: false },
      { line_number: 2, sku: 'BG-BAG-002', qty: 2500, completed_qty: 0, qty_per_case: 500, uom: 'EA', packaging: 'Case', production_status: 'Awaiting', added_details: 'Kraft Bag 8x4.75x10.5"', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234501002', name: 'Stock | White Deli Wrap Bags', section: 'Make To Stock',
    po_number: '1851002', status: 'Ready to Ship', facility: 'Santa Ana',
    order_date: '2026-04-15', production_start: '2026-04-22', estimated_completion: '2026-05-20',
    customer_email: null, total_value: 3100, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-BAG-003', qty: 10000, completed_qty: 10000, qty_per_case: 1000, uom: 'EA', packaging: 'Case', production_status: 'Complete', added_details: 'White Deli Bag 12x10+8"', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234501003', name: 'Stock | Compostable Cutlery Kit Individual', section: 'Make To Stock',
    po_number: '1851003', status: 'Shipped', facility: 'Santa Ana',
    order_date: '2026-04-01', production_start: '2026-04-08', estimated_completion: '2026-04-30',
    ship_date: '2026-05-02', customer_email: null, total_value: 6800, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-CUT-001', qty: 3000, completed_qty: 3000, qty_per_case: 250, uom: 'KIT', packaging: 'Case', production_status: 'Shipped', added_details: 'CPLA Cutlery Kit', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234501004', name: 'Stock | 16oz PLA Clear Cups', section: 'Make To Stock',
    po_number: '1851004', status: 'Confirmed', facility: 'Santa Ana',
    order_date: '2026-05-10', production_start: '2026-05-20', estimated_completion: '2026-06-20',
    customer_email: null, total_value: 5200, additional_comments: 'Summer stock-up',
    line_items: [
      { line_number: 1, sku: 'BG-CUP-001', qty: 2000, completed_qty: 0, qty_per_case: 500, uom: 'EA', packaging: 'Sleeve', production_status: 'Scheduled', added_details: '16oz PLA Cup', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234501005', name: 'Stock | Liner Wraps White 12x12"', section: 'Make To Stock',
    po_number: '1851005', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-05-01', production_start: '2026-05-08', estimated_completion: '2026-06-05',
    customer_email: null, total_value: 2900, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-LW-012', qty: 8000, completed_qty: 3500, qty_per_case: 500, uom: 'EA', packaging: 'Case', production_status: 'In Production', added_details: 'Liner Wrap White 12x12 40g', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234501006', name: 'Stock | Food Tray 3lb White Unprinted', section: 'Make To Stock',
    po_number: '1851006', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-05-05', production_start: '2026-05-12', estimated_completion: '2026-06-12',
    customer_email: null, total_value: 7100, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-TRAY-003', qty: 4000, completed_qty: 1000, qty_per_case: 200, uom: 'EA', packaging: 'Case', production_status: 'In Production', added_details: '3lb Food Tray White', sku_flagged: false },
      { line_number: 2, sku: 'BG-TRAY-005', qty: 2000, completed_qty: 0, qty_per_case: 200, uom: 'EA', packaging: 'Case', production_status: 'Awaiting', added_details: '5lb Food Tray White', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234501007', name: 'Stock | Fry Cups 16oz Kraft', section: 'Make To Stock',
    po_number: '1851007', status: 'Ready to Ship', facility: 'Santa Ana',
    order_date: '2026-04-20', production_start: '2026-04-28', estimated_completion: '2026-05-28',
    customer_email: null, total_value: 3450, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-FC-016', qty: 5000, completed_qty: 5000, qty_per_case: 500, uom: 'EA', packaging: 'Case', production_status: 'Complete', added_details: '16oz Fry Cup Kraft', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234501008', name: 'Stock | Burger Bags Kraft A5', section: 'Make To Stock',
    po_number: '1851008', status: 'Pending', facility: 'Santa Ana',
    order_date: '2026-05-15', production_start: null, estimated_completion: '2026-07-01',
    customer_email: null, total_value: 2200, additional_comments: 'Pending raw material',
    line_items: [
      { line_number: 1, sku: 'BG-BB-A5', qty: 3000, completed_qty: 0, qty_per_case: 300, uom: 'EA', packaging: 'Case', production_status: 'Pending', added_details: 'Burger Bag Kraft A5', sku_flagged: false },
    ],
  },
  // ── Private Label (8) ─────────────────────────────────────────────────────
  {
    monday_item_id: '7234502001', name: 'Mosh | Kraft Bags | A5 | 2 color | Orange 164C + Red 3556C', section: 'Private Label',
    po_number: '1834026', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-04-10', production_start: '2026-04-18', estimated_completion: '2026-05-30',
    customer_email: 'ops@moshrestaurant.com', total_value: 5600, additional_comments: 'Mosh brand colors must match PMS exactly',
    line_items: [
      { line_number: 1, sku: 'MOSH-BB-A5', qty: 750, completed_qty: 375, qty_per_case: 75, uom: 'CASE', packaging: 'Case', production_status: 'In Production', added_details: 'Mosh | Burger Bag | Kraft | A5', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234502002', name: 'Rebel Hen | Food Tray | White | 3# | 5-color', section: 'Private Label',
    po_number: '1831778', status: 'Ready to Ship', facility: 'Santa Ana',
    order_date: '2026-04-01', production_start: '2026-04-08', estimated_completion: '2026-05-15',
    customer_email: 'orders@rebelhen.com', total_value: 9200, additional_comments: 'QC approved 5/12',
    line_items: [
      { line_number: 1, sku: 'RH-TRAY-3LB', qty: 750, completed_qty: 750, qty_per_case: 150, uom: 'CASE', packaging: 'Master Case', production_status: 'Complete', added_details: 'Rebel Hen | Food Tray | White | 3# | 5 color', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234502003', name: 'Kokos | Fry Cup | Kraft | 16oz | 2-color', section: 'Private Label',
    po_number: '1831777', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-04-15', production_start: '2026-04-22', estimated_completion: '2026-06-01',
    customer_email: 'purchasing@kokoskitchen.com', total_value: 4100, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'KK-FC-016', qty: 500, completed_qty: 200, qty_per_case: 100, uom: 'CASE', packaging: 'Case', production_status: 'In Production', added_details: 'Kokos | Fry Cup | Kraft | 16oz | Red 185C + Blue 2193C', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234502004', name: 'Jade | Liner Wrap | White | 12x6" | 1-color | 568U', section: 'Private Label',
    po_number: '1831775', status: 'Shipped', facility: 'Santa Ana',
    order_date: '2026-03-20', production_start: '2026-03-28', estimated_completion: '2026-05-10',
    ship_date: '2026-05-14', customer_email: 'ops@jaderestaurants.com', total_value: 3800, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'JADE-LW-126', qty: 1000, completed_qty: 1000, qty_per_case: 500, uom: 'CASE', packaging: 'Case', production_status: 'Shipped', added_details: 'Jade | Liner Wrap | White | 12x6" | 568U', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234502005', name: 'Backyard BBQ | Liner Wrap | White | 12x12" | 1-color', section: 'Private Label',
    po_number: '1831775B', status: 'Pending', facility: 'Santa Ana',
    order_date: '2026-05-12', production_start: null, estimated_completion: '2026-07-10',
    customer_email: 'buyer@backyardbbq.com', total_value: 2700, additional_comments: 'Awaiting PO confirmation',
    line_items: [
      { line_number: 1, sku: 'BBQ-LW-1212', qty: 600, completed_qty: 0, qty_per_case: 300, uom: 'CASE', packaging: 'Case', production_status: 'Pending', added_details: 'Backyard BBQ | Liner Wrap | White | 12x12" | 3302C', sku_flagged: true },
    ],
  },
  {
    monday_item_id: '7234502006', name: 'Taco Del Centre | Liner Wrap | Kraft | 12x12" | 2-color', section: 'Private Label',
    po_number: '1831775C', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-04-25', production_start: '2026-05-02', estimated_completion: '2026-06-08',
    customer_email: 'ops@tacodelcentre.com', total_value: 4400, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'TDC-LW-1212K', qty: 400, completed_qty: 150, qty_per_case: 100, uom: 'CASE', packaging: 'Case', production_status: 'In Production', added_details: 'Taco Del Centre | Liner | Kraft | Blue 281C + Green 572C', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234502007', name: 'ONT Field | Fry Boat 3LB + 5LB', section: 'Private Label',
    po_number: '1850349', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-04-20', production_start: '2026-04-28', estimated_completion: '2026-06-05',
    customer_email: 'purchasing@ontfield.com', total_value: 11200, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'ONT-FB-3LB', qty: 500, completed_qty: 200, qty_per_case: 100, uom: 'CASE', packaging: 'Master Case', production_status: 'In Production', added_details: 'ONT Field Fry Boat 3LB', sku_flagged: false },
      { line_number: 2, sku: 'ONT-FB-5LB', qty: 500, completed_qty: 100, qty_per_case: 100, uom: 'CASE', packaging: 'Master Case', production_status: 'In Production', added_details: 'ONT Field Fry Boat 5LB', sku_flagged: false },
      { line_number: 3, sku: 'ONT-LFB', qty: 300, completed_qty: 0, qty_per_case: 100, uom: 'CASE', packaging: 'Master Case', production_status: 'Awaiting', added_details: 'ONT Field Loaded Fry Box', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234502008', name: 'Ziggys | Pretzel Bag | White | 7x7" | Red 185C', section: 'Private Label',
    po_number: '1831776Z', status: 'Confirmed', facility: 'Santa Ana',
    order_date: '2026-05-08', production_start: '2026-05-18', estimated_completion: '2026-06-25',
    customer_email: 'ops@ziggysdeli.com', total_value: 3200, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'ZIG-PB-77', qty: 800, completed_qty: 0, qty_per_case: 200, uom: 'CASE', packaging: 'Case', production_status: 'Scheduled', added_details: 'Ziggys | Pretzel Bag | White | 7x7"', sku_flagged: false },
    ],
  },
  // ── Straw Orders (6) ──────────────────────────────────────────────────────
  {
    monday_item_id: '7234503001', name: 'Paper Straws 7.75" Wrapped | Natural Kraft', section: 'Straw Orders',
    po_number: '1852001', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-04-22', production_start: '2026-05-01', estimated_completion: '2026-06-01',
    customer_email: null, total_value: 8500, additional_comments: 'Standard straw run',
    line_items: [
      { line_number: 1, sku: 'BG-STR-775W', qty: 50000, completed_qty: 25000, qty_per_case: 5000, uom: 'EA', packaging: 'Case', production_status: 'In Production', added_details: '7.75" Kraft Wrapped Paper Straw', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234503002', name: 'Jumbo Paper Straws 9" x 8mm | White Wrapped', section: 'Straw Orders',
    po_number: '1852002', status: 'Ready to Ship', facility: 'Santa Ana',
    order_date: '2026-04-10', production_start: '2026-04-18', estimated_completion: '2026-05-18',
    customer_email: null, total_value: 6200, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-STR-908W', qty: 30000, completed_qty: 30000, qty_per_case: 3000, uom: 'EA', packaging: 'Case', production_status: 'Complete', added_details: '9" Jumbo Paper Straw White Wrapped', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234503003', name: 'Cocktail Straws 5.75" | Unwrapped | Assorted', section: 'Straw Orders',
    po_number: '1852003', status: 'On Hold', facility: 'Santa Ana',
    order_date: '2026-04-30', production_start: null, estimated_completion: null,
    customer_email: null, total_value: 3400, additional_comments: 'On hold - raw material shortage',
    line_items: [
      { line_number: 1, sku: 'BG-STR-575U', qty: 100000, completed_qty: 0, qty_per_case: 10000, uom: 'EA', packaging: 'Case', production_status: 'On Hold', added_details: '5.75" Cocktail Straw Unwrapped', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234503004', name: 'Colossal Straws 9" x 12mm | Smoothie | Wrapped', section: 'Straw Orders',
    po_number: '1852004', status: 'Shipped', facility: 'Santa Ana',
    order_date: '2026-03-25', production_start: '2026-04-01', estimated_completion: '2026-04-28',
    ship_date: '2026-05-01', customer_email: null, total_value: 7800, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-STR-912W', qty: 20000, completed_qty: 20000, qty_per_case: 2000, uom: 'EA', packaging: 'Case', production_status: 'Shipped', added_details: '9" Colossal Smoothie Straw 12mm Wrapped', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234503005', name: 'Eco Straws 8" x 6mm | Kraft | Wrapped | Custom Print', section: 'Straw Orders',
    po_number: '1852005', status: 'Pending', facility: 'Santa Ana',
    order_date: '2026-05-14', production_start: null, estimated_completion: '2026-07-05',
    customer_email: null, total_value: 4900, additional_comments: 'Custom logo print pending artwork approval',
    line_items: [
      { line_number: 1, sku: null, qty: 40000, completed_qty: 0, qty_per_case: 4000, uom: 'EA', packaging: 'Case', production_status: 'Pending', added_details: '8" x 6mm Kraft Custom Print Straw', sku_flagged: true },
    ],
  },
  {
    monday_item_id: '7234503006', name: 'Bendy Paper Straws 7.75" | Wrapped | White', section: 'Straw Orders',
    po_number: '1852006', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-05-05', production_start: '2026-05-14', estimated_completion: '2026-06-15',
    customer_email: null, total_value: 5100, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-STR-775BW', qty: 35000, completed_qty: 10000, qty_per_case: 3500, uom: 'EA', packaging: 'Case', production_status: 'In Production', added_details: '7.75" Bendy Paper Straw White Wrapped', sku_flagged: false },
    ],
  },
  // ── Customer DropShip (6) ─────────────────────────────────────────────────
  {
    monday_item_id: '7234504001', name: 'Imperial Dade | Compostable Bags Assorted', section: 'Customer DropShip',
    po_number: 'ID-2026-0441', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-05-02', production_start: '2026-05-10', estimated_completion: '2026-06-10',
    customer_email: 'purchasing@imperialdade.com', total_value: 14500, additional_comments: 'Ship to NJ DC',
    line_items: [
      { line_number: 1, sku: 'BG-BAG-MED', qty: 10000, completed_qty: 4000, qty_per_case: 1000, uom: 'CASE', packaging: 'Master Case', production_status: 'In Production', added_details: 'Compostable Bag Medium', sku_flagged: false },
      { line_number: 2, sku: 'BG-BAG-LG', qty: 5000, completed_qty: 0, qty_per_case: 500, uom: 'CASE', packaging: 'Master Case', production_status: 'Awaiting', added_details: 'Compostable Bag Large', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234504002', name: 'Imperial Dade | CPLA Cutlery Individually Wrapped', section: 'Customer DropShip',
    po_number: 'ID-2026-0382', status: 'Shipped', facility: 'Santa Ana',
    order_date: '2026-04-08', production_start: '2026-04-15', estimated_completion: '2026-05-08',
    ship_date: '2026-05-10', customer_email: 'purchasing@imperialdade.com', total_value: 18200, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-CUT-IW-KIT', qty: 5000, completed_qty: 5000, qty_per_case: 250, uom: 'CASE', packaging: 'Case', production_status: 'Shipped', added_details: 'CPLA Cutlery Kit Individually Wrapped', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234504003', name: 'Performance Foodservice | Food Trays 3# White', section: 'Customer DropShip',
    po_number: 'PFG-2026-1122', status: 'Ready to Ship', facility: 'Santa Ana',
    order_date: '2026-04-18', production_start: '2026-04-25', estimated_completion: '2026-05-25',
    customer_email: 'ops@performancefg.com', total_value: 22100, additional_comments: 'Pallet label required',
    line_items: [
      { line_number: 1, sku: 'BG-TRAY-3LBW', qty: 8000, completed_qty: 8000, qty_per_case: 400, uom: 'CASE', packaging: 'Master Case', production_status: 'Complete', added_details: 'Food Tray 3# White Unprinted', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234504004', name: 'Sysco | Liner Wraps 12x12 Unprinted Kraft', section: 'Customer DropShip',
    po_number: 'SYSCO-2026-9981', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-05-04', production_start: '2026-05-12', estimated_completion: '2026-06-12',
    customer_email: 'nat.procurement@sysco.com', total_value: 16800, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-LW-1212K', qty: 20000, completed_qty: 8000, qty_per_case: 1000, uom: 'CASE', packaging: 'Master Case', production_status: 'In Production', added_details: 'Liner Wrap 12x12 Kraft Unprinted', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234504005', name: 'US Foods | Compostable Bag Assortment', section: 'Customer DropShip',
    po_number: 'USF-2026-7741', status: 'On Hold', facility: 'Santa Ana',
    order_date: '2026-05-06', production_start: null, estimated_completion: null,
    customer_email: 'supply@usfoods.com', total_value: 9600, additional_comments: 'On hold pending credit approval',
    line_items: [
      { line_number: 1, sku: null, qty: 5000, completed_qty: 0, qty_per_case: 500, uom: 'CASE', packaging: 'Case', production_status: 'On Hold', added_details: 'Custom compostable bags - awaiting SKU setup', sku_flagged: true },
    ],
  },
  {
    monday_item_id: '7234504006', name: "Gordon Food Service | 8oz Soup Cups PLA", section: 'Customer DropShip',
    po_number: 'GFS-2026-3318', status: 'Pending', facility: 'Santa Ana',
    order_date: '2026-05-16', production_start: null, estimated_completion: '2026-07-01',
    customer_email: 'buy@gfs.com', total_value: 11400, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'BG-CUP-08S', qty: 3000, completed_qty: 0, qty_per_case: 500, uom: 'CASE', packaging: 'Case', production_status: 'Pending', added_details: '8oz PLA Soup Cup', sku_flagged: true },
    ],
  },
  // ── Injection Molding (5) ─────────────────────────────────────────────────
  {
    monday_item_id: '7234505001', name: 'PP Cutlery Molds — Fork + Knife + Spoon Set', section: 'Injection Molding',
    po_number: 'IM-2026-0101', status: 'In Production', facility: 'Tool Shop - Vendor',
    order_date: '2026-03-15', production_start: '2026-03-22', estimated_completion: '2026-06-15',
    customer_email: null, total_value: 45000, additional_comments: 'H13 Tool Steel. 4-cavity each.',
    line_items: [
      { line_number: 1, sku: 'TOOL-CUT-FORK', qty: 1, completed_qty: 0, qty_per_case: 1, uom: 'EA', packaging: null, production_status: 'T1 Sample', added_details: 'Fork Mold 4-cavity', sku_flagged: false },
      { line_number: 2, sku: 'TOOL-CUT-KNIFE', qty: 1, completed_qty: 0, qty_per_case: 1, uom: 'EA', packaging: null, production_status: 'T1 Sample', added_details: 'Knife Mold 4-cavity', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234505002', name: 'Cup Lid 16oz Flat — Tooling', section: 'Injection Molding',
    po_number: 'IM-2026-0102', status: 'On Hold', facility: 'Tool Shop - Vendor',
    order_date: '2026-04-01', production_start: null, estimated_completion: null,
    customer_email: null, total_value: 28000, additional_comments: 'On hold — design revision in progress',
    line_items: [
      { line_number: 1, sku: null, qty: 1, completed_qty: 0, qty_per_case: 1, uom: 'EA', packaging: null, production_status: 'Design Review', added_details: '16oz Flat Lid Mold', sku_flagged: true },
    ],
  },
  {
    monday_item_id: '7234505003', name: 'Clamshell Molds 6x6x3 — 2-cavity', section: 'Injection Molding',
    po_number: 'IM-2026-0103', status: 'Ready to Ship', facility: 'Tool Shop - Vendor',
    order_date: '2026-02-20', production_start: '2026-03-01', estimated_completion: '2026-05-15',
    customer_email: null, total_value: 32000, additional_comments: 'T3 approved. Ready to ship to plant.',
    line_items: [
      { line_number: 1, sku: 'TOOL-CS-663', qty: 1, completed_qty: 1, qty_per_case: 1, uom: 'EA', packaging: null, production_status: 'T3 Approved', added_details: 'Clamshell Mold 6x6x3 2-cavity', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234505004', name: 'Straw Mold Set — 5 sizes', section: 'Injection Molding',
    po_number: 'IM-2026-0104', status: 'Shipped', facility: 'Tool Shop - Vendor',
    order_date: '2026-01-15', production_start: '2026-01-22', estimated_completion: '2026-04-01',
    ship_date: '2026-04-05', customer_email: null, total_value: 38500, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'TOOL-STR-SET5', qty: 5, completed_qty: 5, qty_per_case: 1, uom: 'EA', packaging: null, production_status: 'Shipped', added_details: 'Straw Mold Set — 5 diameter sizes', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234505005', name: 'Food Tray 3# Mold — 1-cavity', section: 'Injection Molding',
    po_number: 'IM-2026-0105', status: 'Pending', facility: 'Tool Shop - Vendor',
    order_date: '2026-05-10', production_start: null, estimated_completion: '2026-08-15',
    customer_email: null, total_value: 22000, additional_comments: 'Quote accepted. Awaiting PO.',
    line_items: [
      { line_number: 1, sku: null, qty: 1, completed_qty: 0, qty_per_case: 1, uom: 'EA', packaging: null, production_status: 'Pending PO', added_details: 'Food Tray 3# Thermoform Mold', sku_flagged: true },
    ],
  },
  // ── Paper Products (4) ────────────────────────────────────────────────────
  {
    monday_item_id: '7234506001', name: 'Bleached Kraft Paper Roll 40gsm | 24" wide', section: 'Paper Products',
    po_number: 'PP-2026-0201', status: 'In Production', facility: 'Santa Ana',
    order_date: '2026-05-03', production_start: '2026-05-10', estimated_completion: '2026-06-10',
    customer_email: null, total_value: 6700, additional_comments: 'For liner wrap production',
    line_items: [
      { line_number: 1, sku: 'RM-KP-40-24', qty: 50, completed_qty: 20, qty_per_case: 1, uom: 'ROLLS', packaging: 'Pallet', production_status: 'In Production', added_details: 'Bleached Kraft 40g 24" Roll', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234506002', name: 'Liner Paper 40G OGR | Printed Pantone 311C', section: 'Paper Products',
    po_number: 'PP-2026-0202', status: 'Ready to Ship', facility: 'Santa Ana',
    order_date: '2026-04-12', production_start: '2026-04-20', estimated_completion: '2026-05-20',
    customer_email: null, total_value: 4900, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'RM-LP-40-311', qty: 30, completed_qty: 30, qty_per_case: 1, uom: 'ROLLS', packaging: 'Pallet', production_status: 'Complete', added_details: 'Liner Paper 40G OGR Pantone 311C', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234506003', name: 'Compostable Paper Bags | Raw Stock | 500m Roll', section: 'Paper Products',
    po_number: 'PP-2026-0203', status: 'Confirmed', facility: 'Santa Ana',
    order_date: '2026-05-08', production_start: '2026-05-18', estimated_completion: '2026-06-20',
    customer_email: null, total_value: 8800, additional_comments: 'PHA coating spec must be confirmed',
    line_items: [
      { line_number: 1, sku: 'RM-CB-500R', qty: 10, completed_qty: 0, qty_per_case: 1, uom: 'ROLLS', packaging: 'Pallet', production_status: 'Scheduled', added_details: 'Compostable Paper Bag Stock 500m', sku_flagged: false },
    ],
  },
  {
    monday_item_id: '7234506004', name: 'Liner Paper 40G ORG PTD | Pantone 7687C', section: 'Paper Products',
    po_number: 'PP-2026-0204', status: 'Shipped', facility: 'Santa Ana',
    order_date: '2026-03-10', production_start: '2026-03-18', estimated_completion: '2026-04-20',
    ship_date: '2026-04-22', customer_email: null, total_value: 5100, additional_comments: null,
    line_items: [
      { line_number: 1, sku: 'RM-LP-40-7687', qty: 25, completed_qty: 25, qty_per_case: 1, uom: 'ROLLS', packaging: 'Pallet', production_status: 'Shipped', added_details: 'Liner Paper 40G ORG PTD Pantone 7687C', sku_flagged: false },
    ],
  },
  // ── Outsourced (1 bonus to hit 37) ────────────────────────────────────────
  {
    monday_item_id: '7234507001', name: 'Kokos | Hoagie Box | White | 7x3x2.625 | 1-color', section: 'Outsourced',
    po_number: '1834024', status: 'In Production', facility: 'Vendor - Xiamen',
    order_date: '2026-04-15', production_start: '2026-04-22', estimated_completion: '2026-06-15',
    customer_email: 'purchasing@kokoskitchen.com', total_value: 7800, additional_comments: 'APL Danube vessel ETA 2026-06-21',
    line_items: [
      { line_number: 1, sku: 'KK-HB-7325', qty: 450, completed_qty: 450, qty_per_case: 90, uom: 'CASE', packaging: 'Master Case', production_status: 'At Port', added_details: 'Kokos | Hoagie Box | White | 7x3x2.625 | Red 185C + Blue 2193C', sku_flagged: false },
    ],
  },
]

const STATUS_MAP: Record<string, string> = {
  'Sales Order': 'Pending',
  'New Order': 'Pending',
  'Awaiting Production': 'Confirmed',
  'Awaiting BOM Components': 'Confirmed',
  'In Production': 'In Production',
  'Production Complete': 'Ready to Ship',
  'Ready for PS': 'Ready to Ship',
  'Ready at Will Call': 'Ready to Ship',
  'Partially Shipped': 'Shipped',
  'Shipped by Supplier': 'Shipped',
  'On HOLD': 'On Hold',
  Pending: 'Pending',
  Confirmed: 'Confirmed',
  Shipped: 'Shipped',
  'Ready to Ship': 'Ready to Ship',
  'On Hold': 'On Hold',
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  let inserted = 0
  const errors: string[] = []

  for (const order of ORDERS) {
    const customerName = (order.name as string).split('|')[0].trim()

    let customerId: string | null = null
    if (customerName && customerName !== 'beyondGREEN' && customerName !== 'Stock') {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .ilike('company_name', `%${customerName}%`)
        .limit(1)
        .maybeSingle()
      if (existing) {
        customerId = existing.id
      } else {
        const { data: nc } = await supabase
          .from('customers')
          .insert({ company_name: customerName, email: order.customer_email ?? null })
          .select('id')
          .single()
        if (nc) customerId = nc.id
      }
    }

    // Use only guaranteed-existing columns (pre-migration safe)
    // Encode section/facility in notes; map ship_date → required_ship_date
    const orderNotes = [
      order.name,
      order.section ? `[Section: ${order.section}]` : null,
      order.facility ? `[Facility: ${order.facility}]` : null,
      order.additional_comments ? `[Notes: ${order.additional_comments}]` : null,
    ].filter(Boolean).join(' | ')

    const { data: newOrder, error: oErr } = await supabase
      .from('sales_orders')
      .insert({
        customer_id: customerId,
        order_number: order.po_number ?? ('SO-' + order.monday_item_id),
        status: STATUS_MAP[order.status] ?? order.status ?? 'Pending',
        order_date: order.order_date ?? null,
        required_ship_date: order.ship_date ?? null,
        po_number: order.po_number ?? null,
        notes: orderNotes,
        carrier: order.facility ?? null,
        subtotal: order.total_value ?? 0,
        total: order.total_value ?? 0,
        tax_pct: 0,
      })
      .select('id')
      .single()

    if (oErr) { errors.push(`${order.name}: ${oErr.message}`); continue }

    for (const line of (order.line_items ?? []) as any[]) {
      let productId: string | null = null
      let productName: string = line.added_details ?? line.sku ?? ''
      let unitCost = 0

      if (line.sku) {
        const { data: prod } = await supabase
          .from('products')
          .select('id,product_name,unit_cost')
          .eq('sku', line.sku)
          .maybeSingle()
        if (prod) { productId = prod.id; productName = prod.product_name; unitCost = prod.unit_cost ?? 0 }
      }

      // Build description from available info
      const desc = [line.added_details ?? line.sku ?? '', line.packaging ? `(${line.packaging})` : null, line.production_status ?? null].filter(Boolean).join(' ')

      await supabase.from('sales_order_lines').insert({
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
      })
    }

    inserted++
  }

  const { count } = await supabase
    .from('sales_orders')
    .select('*', { count: 'exact', head: true })

  return NextResponse.json({ success: true, inserted, errors: errors.slice(0, 20), total_in_db: count })
}
