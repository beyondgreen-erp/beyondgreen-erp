export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const MIGRATIONS = [
  {
    label: 'quotations – add missing columns',
    sql: `
      ALTER TABLE quotations
        ADD COLUMN IF NOT EXISTS total_value numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS order_date date DEFAULT CURRENT_DATE,
        ADD COLUMN IF NOT EXISTS shipping_address text,
        ADD COLUMN IF NOT EXISTS customer_phone text,
        ADD COLUMN IF NOT EXISTS customer_email text,
        ADD COLUMN IF NOT EXISTS planned_ship_date date,
        ADD COLUMN IF NOT EXISTS notes text,
        ADD COLUMN IF NOT EXISTS status text DEFAULT 'Draft';
    `,
  },
  {
    label: 'quotation_lines – add missing columns',
    sql: `
      ALTER TABLE quotation_lines
        ADD COLUMN IF NOT EXISTS sku text,
        ADD COLUMN IF NOT EXISTS product_name text,
        ADD COLUMN IF NOT EXISTS uom text DEFAULT 'EA',
        ADD COLUMN IF NOT EXISTS line_total numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS qty numeric DEFAULT 1,
        ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS description text,
        ADD COLUMN IF NOT EXISTS quantity numeric DEFAULT 1,
        ADD COLUMN IF NOT EXISTS unit_of_measure text,
        ADD COLUMN IF NOT EXISTS discount_pct numeric DEFAULT 0;
    `,
  },
  {
    label: 'sales_orders – add missing columns',
    sql: `
      ALTER TABLE sales_orders
        ADD COLUMN IF NOT EXISTS total_value numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS status text DEFAULT 'New',
        ADD COLUMN IF NOT EXISTS order_date date DEFAULT CURRENT_DATE,
        ADD COLUMN IF NOT EXISTS notes text,
        ADD COLUMN IF NOT EXISTS shipping_address text,
        ADD COLUMN IF NOT EXISTS customer_phone text,
        ADD COLUMN IF NOT EXISTS customer_email text;
    `,
  },
  {
    label: 'sales_order_lines – add missing columns',
    sql: `
      ALTER TABLE sales_order_lines
        ADD COLUMN IF NOT EXISTS sku text,
        ADD COLUMN IF NOT EXISTS product_name text,
        ADD COLUMN IF NOT EXISTS uom text DEFAULT 'EA',
        ADD COLUMN IF NOT EXISTS line_total numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS qty numeric DEFAULT 1,
        ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS description text,
        ADD COLUMN IF NOT EXISTS quantity numeric DEFAULT 1,
        ADD COLUMN IF NOT EXISTS quantity_shipped numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS unit_of_measure text,
        ADD COLUMN IF NOT EXISTS discount_pct numeric DEFAULT 0;
    `,
  },
  {
    label: 'shipments – add missing columns',
    sql: `
      ALTER TABLE shipments
        ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS customer_name text,
        ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'Pending',
        ADD COLUMN IF NOT EXISTS ship_date date,
        ADD COLUMN IF NOT EXISTS carrier text,
        ADD COLUMN IF NOT EXISTS tracking_number text,
        ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0;
    `,
  },
  {
    label: 'invoices – add missing columns',
    sql: `
      ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS total_amount numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS balance_due numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS invoice_date date DEFAULT CURRENT_DATE,
        ADD COLUMN IF NOT EXISTS due_date date,
        ADD COLUMN IF NOT EXISTS notes text,
        ADD COLUMN IF NOT EXISTS invoice_number_display text,
        ADD COLUMN IF NOT EXISTS invoice_type text DEFAULT 'invoice',
        ADD COLUMN IF NOT EXISTS payment_terms text,
        ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS tax_pct numeric DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total numeric DEFAULT 0;
    `,
  },
  {
    label: 'reload PostgREST schema cache',
    sql: `SELECT pg_notify('pgrst', 'reload schema');`,
  },
]

export async function GET() {
  const sb = getSb()
  const results: { label: string; status: 'ok' | 'error'; detail: string }[] = []

  for (const m of MIGRATIONS) {
    try {
      const { error } = await sb.rpc('exec_sql', { sql: m.sql }).single()
      if (error) {
        results.push({ label: m.label, status: 'error', detail: error.message + '\n\nRun manually:\n' + m.sql.trim() })
      } else {
        results.push({ label: m.label, status: 'ok', detail: 'applied' })
      }
    } catch (e: any) {
      results.push({ label: m.label, status: 'error', detail: (e?.message ?? 'unknown error') + '\n\nRun manually:\n' + m.sql.trim() })
    }
  }

  return NextResponse.json({
    note: 'If rpc exec_sql is not set up, run the SQL blocks manually in Supabase SQL Editor.',
    results,
    allSql: MIGRATIONS.map(m => `-- ${m.label}\n${m.sql.trim()}`).join('\n\n'),
  })
}
