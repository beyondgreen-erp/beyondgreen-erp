import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

const COMPLAINT_FIELDS = ['title','product','platform','complaint_received_date','complaint','resolution','customer_email','complaint_number','status','attachments'];
const CAPA_FIELDS = ['capa_number','capa_date','department','responsible_person','description','immediate_correction','why1','why2','why3','why4','why5','root_cause','corrective_action','corrective_target_date','corrective_effective','preventive_action','preventive_target_date','preventive_effective','verified_by','verified_date','evidence','source','status','attachments'];

function pick(obj: any, fields: string[]) {
  const out: any = {};
  for (const f of fields) if (obj && obj[f] !== undefined) out[f] = obj[f] === '' ? null : obj[f];
  return out;
}

export async function GET(req: NextRequest) {
  const board = req.nextUrl.searchParams.get('board');
  if (board === 'capa') {
    const { data } = await supabase.from('capa_log').select('*').order('capa_date', { ascending: false, nullsFirst: false });
    return NextResponse.json({ rows: data || [] });
  }
  const { data } = await supabase.from('customer_complaints').select('*').order('complaint_received_date', { ascending: false, nullsFirst: false });
  return NextResponse.json({ rows: data || [] });
}

async function aiExtract(board: string, text: string) {
  const fields = board === 'capa' ? CAPA_FIELDS : COMPLAINT_FIELDS;
  const kind = board === 'capa' ? 'CAPA (corrective and preventive action) record' : 'customer complaint record';
  const prompt = 'Extract structured data from the pasted text into JSON for a ' + kind + '. Only include fields you can determine from the text; omit the rest. All dates must be formatted YYYY-MM-DD. Boolean fields are true/false. Available fields: ' + fields.join(', ') + '.\n\nPasted text:\n' + text + '\n\nReturn ONLY a JSON object with the fields you extracted.';
  const msg = await anthropic.messages.create({ model: MODEL, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] });
  const raw = ((msg.content[0] as any) && (msg.content[0] as any).text) || '';
  const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
  try { return JSON.parse(a >= 0 && b > a ? raw.slice(a, b + 1) : '{}'); } catch (e) { return {}; }
}

async function createComplaint(data: any, created_by: string) {
  const row = pick(data, COMPLAINT_FIELDS);
  row.status = row.status || 'Open';
  row.created_by = created_by || null;
  const { data: c, error } = await supabase.from('customer_complaints').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  const { data: k } = await supabase.from('capa_log').insert({
    capa_number: c.complaint_number, capa_date: c.complaint_received_date, department: 'Food Safety & Quality',
    responsible_person: 'Food Safety & Quality Team', description: c.complaint, immediate_correction: c.resolution,
    corrective_action: c.resolution, source: 'Customer Complaint', status: 'Open', complaint_id: c.id, created_by: created_by || null,
  }).select('id').single();
  if (k) await supabase.from('customer_complaints').update({ capa_id: k.id }).eq('id', c.id);
  return c;
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch (e) {}
  const { action, board, id, data, text, created_by } = body;

  if (action === 'ai_quick_add') {
    if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });
    let parsed: any = {};
    try { parsed = await aiExtract(board, text); } catch (e: any) { return NextResponse.json({ error: (e && e.message) || 'AI failed' }, { status: 500 }); }
    if (board === 'capa') {
      const row = pick(parsed, CAPA_FIELDS); row.source = row.source || 'Manual'; row.status = row.status || 'Open'; row.created_by = created_by || null;
      const { data: k, error } = await supabase.from('capa_log').insert(row).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, row: k, parsed });
    }
    try { const c = await createComplaint(parsed, created_by); return NextResponse.json({ ok: true, row: c, parsed }); }
    catch (e: any) { return NextResponse.json({ error: (e && e.message) || 'insert failed' }, { status: 500 }); }
  }

  if (action === 'create') {
    if (board === 'capa') {
      const row = pick(data, CAPA_FIELDS); row.source = row.source || 'Manual'; row.status = row.status || 'Open'; row.created_by = created_by || null;
      const { data: k, error } = await supabase.from('capa_log').insert(row).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, row: k });
    }
    try { const c = await createComplaint(data, created_by); return NextResponse.json({ ok: true, row: c }); }
    catch (e: any) { return NextResponse.json({ error: (e && e.message) || 'insert failed' }, { status: 500 }); }
  }

  if (action === 'update') {
    const table = board === 'capa' ? 'capa_log' : 'customer_complaints';
    const fields = board === 'capa' ? CAPA_FIELDS : COMPLAINT_FIELDS;
    const row = pick(data, fields); row.updated_at = new Date().toISOString();
    const { error } = await supabase.from(table).update(row).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'delete') {
    const table = board === 'capa' ? 'capa_log' : 'customer_complaints';
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

    if (action === 'upload') {
    const f = body.file;
    if (!f || !f.dataBase64) return NextResponse.json({ error: 'file required' }, { status: 400 });
    const bytes = Buffer.from(f.dataBase64, 'base64');
    const safe = String(f.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = (board || 'complaints') + '/' + (id || 'new') + '/' + Date.now() + '-' + safe;
    const { error: upErr } = await supabase.storage.from('haccp-attachments').upload(path, bytes, { contentType: f.contentType || 'application/octet-stream', upsert: true });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    const { data: pub } = supabase.storage.from('haccp-attachments').getPublicUrl(path);
    return NextResponse.json({ ok: true, url: pub.publicUrl, name: f.name || safe, contentType: f.contentType || '' });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
