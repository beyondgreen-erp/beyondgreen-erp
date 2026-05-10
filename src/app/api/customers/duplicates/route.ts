export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function normalize(s: string) {
  return s.toLowerCase().trim()
    .replace(/\b(inc|llc|ltd|co|corp|company|and|&)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

export async function GET() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: customers, error } = await sb.from('customers')
    .select('id,company_name,lifetime_spend,total_shipments,customer_status,email')
    .eq('is_active', true)
    .eq('is_merged', false)
    .order('company_name')

  if (error || !customers) return NextResponse.json({ error: error?.message }, { status: 500 })

  type Customer = { id: string; company_name: string; lifetime_spend: number | null; total_shipments: number | null; customer_status: string | null; email: string | null }
  const groups: { score: string; customers: Customer[] }[] = []
  const grouped = new Set<string>()

  for (let i = 0; i < customers.length; i++) {
    if (grouped.has(customers[i].id)) continue
    const ni = normalize(customers[i].company_name)
    const group: Customer[] = [customers[i] as Customer]
    let score = 'fuzzy'

    for (let j = i + 1; j < customers.length; j++) {
      if (grouped.has(customers[j].id)) continue
      const nj = normalize(customers[j].company_name)
      const li = customers[i].company_name.toLowerCase().trim()
      const lj = customers[j].company_name.toLowerCase().trim()

      const exactMatch = li === lj
      const oneContains = li.includes(lj) || lj.includes(li)
      const shortEnough = Math.min(ni.length, nj.length) >= 3
      const closeEdit = shortEnough && editDistance(ni, nj) <= 2

      if (exactMatch || oneContains || closeEdit) {
        group.push(customers[j] as Customer)
        if (exactMatch) score = 'exact'
        else if (oneContains && score !== 'exact') score = 'contains'
      }
    }

    if (group.length > 1) {
      group.forEach(c => grouped.add(c.id))
      groups.push({ score, customers: group })
    }
  }

  return NextResponse.json({ groups })
}
