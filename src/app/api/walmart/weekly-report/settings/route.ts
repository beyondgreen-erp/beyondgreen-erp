import { NextRequest, NextResponse } from 'next/server'
import { requireUser, isResp } from '../_auth'
import { loadSettings } from '@/lib/walmartWeekly/data'
export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest) {
  const a = await requireUser(); if (isResp(a)) return a
  const body = await req.json()
  const current = await loadSettings(a.admin)
  const next = { ...current, ...body }
  const { error } = await a.admin.from('wm_weekly_settings').upsert({ id: 1, data: next, updated_at: new Date().toISOString(), updated_by: a.email })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: next })
}
