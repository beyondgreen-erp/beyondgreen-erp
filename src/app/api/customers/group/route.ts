export const dynamic = 'force-dynamic'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { parent_id, child_ids, parent_name } = body as {
      parent_id?: string
      child_ids: string[]
      parent_name?: string
    }

    if (!child_ids || child_ids.length === 0) {
      return NextResponse.json({ error: 'child_ids required' }, { status: 400 })
    }

    const sb = getSb()
    let finalParentId = parent_id

    // If no parent_id but parent_name given, find or create parent
    if (!finalParentId && parent_name) {
      const { data: existing } = await sb
        .from('customers')
        .select('id')
        .ilike('company_name', parent_name.trim())
        .limit(1)
        .single()

      if (existing) {
        finalParentId = existing.id
      } else {
        const { data: created, error: createErr } = await sb
          .from('customers')
          .insert({
            company_name: parent_name.trim(),
            is_active: true,
            is_merged: false,
            customer_status: 'Active Customer',
            pipeline_stage: 'Closed Won',
            is_parent_account: true,
            account_type: 'parent',
          })
          .select('id')
          .single()

        if (createErr || !created) {
          return NextResponse.json({ error: createErr?.message ?? 'Failed to create parent' }, { status: 500 })
        }
        finalParentId = created.id
      }
    }

    if (!finalParentId) {
      return NextResponse.json({ error: 'parent_id or parent_name required' }, { status: 400 })
    }

    // Set parent as parent account
    const { error: parentErr } = await sb
      .from('customers')
      .update({
        is_parent_account: true,
        account_type: 'parent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', finalParentId)

    if (parentErr) {
      return NextResponse.json({ error: parentErr.message }, { status: 500 })
    }

    // Set children
    const { error: childErr } = await sb
      .from('customers')
      .update({
        parent_customer_id: finalParentId,
        account_type: 'child',
        updated_at: new Date().toISOString(),
      })
      .in('id', child_ids)

    if (childErr) {
      return NextResponse.json({ error: childErr.message }, { status: 500 })
    }

    // Log activity on each child
    const activityRows = child_ids.map(id => ({
      customer_id: id,
      activity_type: 'note',
      source_type: 'customers',
      source_id: finalParentId,
      source_label: 'Account Grouped',
      author_email: 'system',
      content: `Grouped under parent account (ID: ${finalParentId})`,
    }))
    try { await sb.from('customer_activity').insert(activityRows) } catch { /* non-critical */ }

    return NextResponse.json({ success: true, parent_id: finalParentId, children: child_ids.length })
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json()
    const { customer_id } = body as { customer_id: string }
    if (!customer_id) return NextResponse.json({ error: 'customer_id required' }, { status: 400 })

    const sb = getSb()
    await sb.from('customers').update({
      parent_customer_id: null,
      account_type: 'standalone',
      updated_at: new Date().toISOString(),
    }).eq('id', customer_id)

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
