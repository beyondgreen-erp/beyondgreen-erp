/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tools exposed to Claude through the ERP connector. Every call runs with the connected
 * person's own ERP session, so database row security and permissions decide what is allowed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const SELECT_OK = /^[\w\s,.*()!:>\-"]+$/
const HIDDEN = /^(mcp_|staff_)/
const MAX_CHARS = 90_000

export const INSTRUCTIONS = `beyondGREEN ERP (Supabase/Postgres). You are acting as the signed-in employee; you can only see and change what their ERP login allows, and every change is recorded under their name.
Start with erp_whoami to see the person's role and board permissions. Use erp_list_tables / erp_describe_table to find the right table and columns before querying.
Key tables: customers, sales_orders, sales_order_lines, quotations, invoices, shipments, products (inventory items/SKUs), inventory_movements (ledger), work_orders, purchase_orders, purchase_order_lines, vendors, tasks, maintenance_requests, sample_submissions, comments.
Walmart: walmart_board_orders (POs), walmart_board_lines, walmart_production_entries (logged SRPs; work_order_id = weekly work order WM-YYYY-Wnn), walmart_releases, walmart_activity (audit log).
For business actions (logging production, releasing, claiming, undo, moving weeks), prefer the ERP's own functions via erp_call_function (e.g. walmart_record_production, walmart_void_production, walmart_move_entry_week, walmart_unclaim) because they apply inventory and guard rules. Use erp_list_functions to find them and their arguments.
Before any insert, update, delete or function that changes data, tell the user exactly what will change and get a clear yes. Never guess IDs; look them up first.`

const s = (o: any) => ({ type: 'object', additionalProperties: false, ...o })
const filtersSchema = {
  type: 'array',
  description: 'Row filters, all must match. op: eq, neq, gt, gte, lt, lte, like, ilike, is, in, contains. For "in" pass an array. For "is" pass null, true or false.',
  items: s({ properties: { column: { type: 'string' }, op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains'] }, value: {} }, required: ['column', 'op', 'value'] }),
}

export const TOOLS = [
  { name: 'erp_whoami', title: 'Who am I in the ERP', description: 'Show the connected person, their role, admin status, per-board permissions and current access mode.', inputSchema: s({ properties: {} }), annotations: { readOnlyHint: true } },
  { name: 'erp_list_tables', title: 'List ERP tables', description: 'List tables and views this person can read, with their columns. Optional search text filters by name or description.', inputSchema: s({ properties: { search: { type: 'string' } } }), annotations: { readOnlyHint: true } },
  { name: 'erp_describe_table', title: 'Describe an ERP table', description: 'Columns, types, defaults and notes for one table.', inputSchema: s({ properties: { table: { type: 'string' } }, required: ['table'] }), annotations: { readOnlyHint: true } },
  {
    name: 'erp_query', title: 'Read ERP records', description: 'Read rows from a table. Supports column selection (PostgREST syntax, including related tables like "*, sales_order_lines(*)"), filters, ordering and paging. Max 500 rows per call.',
    inputSchema: s({ properties: {
      table: { type: 'string' }, select: { type: 'string', description: 'Columns, default *' }, filters: filtersSchema,
      order: { type: 'string', description: 'Column to sort by; prefix with - for descending, e.g. -created_at' },
      limit: { type: 'integer', minimum: 1, maximum: 500 }, offset: { type: 'integer', minimum: 0 }, count: { type: 'boolean', description: 'Also return the total matching row count' },
    }, required: ['table'] }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'erp_insert', title: 'Add ERP records', description: 'Insert up to 50 rows into a table. Returns the inserted rows. Confirm with the user first.',
    inputSchema: s({ properties: { table: { type: 'string' }, rows: { type: 'array', items: { type: 'object' }, minItems: 1, maxItems: 50 } }, required: ['table', 'rows'] }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'erp_update', title: 'Edit ERP records', description: 'Update rows matching the filters (at least one filter required). Refuses if more than 50 rows would change. Confirm with the user first.',
    inputSchema: s({ properties: { table: { type: 'string' }, values: { type: 'object' }, filters: filtersSchema }, required: ['table', 'values', 'filters'] }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'erp_delete', title: 'Delete ERP records', description: 'Delete rows matching the filters (at least one filter required). Refuses if more than 20 rows match. Requires confirm=true after the user explicitly agreed.',
    inputSchema: s({ properties: { table: { type: 'string' }, filters: filtersSchema, confirm: { type: 'boolean' } }, required: ['table', 'filters', 'confirm'] }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  { name: 'erp_list_functions', title: 'List ERP actions', description: 'List database functions (ERP actions and reports) this person can run, with their arguments. Use search to narrow, e.g. "walmart".', inputSchema: s({ properties: { search: { type: 'string' } } }), annotations: { readOnlyHint: true } },
  {
    name: 'erp_call_function', title: 'Run an ERP action', description: 'Run a database function by name with named arguments (see erp_list_functions). Many change data; confirm with the user first.',
    inputSchema: s({ properties: { name: { type: 'string' }, args: { type: 'object' } }, required: ['name'] }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
]

function applyFilters(q: any, filters: any[] = []) {
  for (const f of filters) {
    if (!IDENT.test(String(f.column || '').split('->')[0])) throw new Error(`Bad column name: ${f.column}`)
    const c = f.column, v = f.value
    switch (f.op) {
      case 'eq': q = q.eq(c, v); break
      case 'neq': q = q.neq(c, v); break
      case 'gt': q = q.gt(c, v); break
      case 'gte': q = q.gte(c, v); break
      case 'lt': q = q.lt(c, v); break
      case 'lte': q = q.lte(c, v); break
      case 'like': q = q.like(c, v); break
      case 'ilike': q = q.ilike(c, v); break
      case 'is': q = q.is(c, v); break
      case 'in': q = q.in(c, Array.isArray(v) ? v : [v]); break
      case 'contains': q = q.contains(c, v); break
      default: throw new Error(`Unknown filter op: ${f.op}`)
    }
  }
  return q
}
function checkTable(t: any) {
  if (!IDENT.test(String(t || '')) || HIDDEN.test(String(t))) throw new Error(`Table not available: ${t}`)
  return String(t)
}
function out(data: any, note?: string) {
  let text = JSON.stringify(data, null, 1)
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + `\n…[truncated — narrow the query with filters, fewer columns or a smaller limit]`
  return { content: [{ type: 'text', text: note ? note + '\n' + text : text }], isError: false }
}
function fail(msg: string) { return { content: [{ type: 'text', text: msg }], isError: true } }
const dbErr = (e: any) => fail(`ERP said: ${e?.message || e}${e?.hint ? ' — ' + e.hint : ''}${e?.details ? ' (' + e.details + ')' : ''}`)

export async function callTool(sb: SupabaseClient, name: string, a: any = {}) {
  try {
    switch (name) {
      case 'erp_whoami': {
        const { data, error } = await sb.rpc('erp_my_permissions')
        return error ? dbErr(error) : out(data)
      }
      case 'erp_list_tables': {
        const { data, error } = await sb.rpc('mcp_list_tables', { p_search: a.search || null })
        return error ? dbErr(error) : out(data, `${(data || []).length} tables/views`)
      }
      case 'erp_describe_table': {
        const t = checkTable(a.table)
        const { data, error } = await sb.rpc('mcp_describe_table', { p_table: t })
        if (error) return dbErr(error)
        return (data || []).length ? out(data) : fail(`No table "${t}" that this login can read.`)
      }
      case 'erp_query': {
        const t = checkTable(a.table)
        const sel = a.select || '*'
        if (!SELECT_OK.test(sel)) return fail('Invalid select string')
        let q: any = sb.from(t).select(sel, a.count ? { count: 'exact' } : undefined)
        q = applyFilters(q, a.filters)
        if (a.order) {
          const desc = String(a.order).startsWith('-'); const col = String(a.order).replace(/^-/, '')
          if (!IDENT.test(col)) return fail('Bad order column')
          q = q.order(col, { ascending: !desc, nullsFirst: false })
        }
        const limit = Math.min(Math.max(Number(a.limit) || 50, 1), 500), offset = Math.max(Number(a.offset) || 0, 0)
        q = q.range(offset, offset + limit - 1)
        const { data, error, count } = await q
        if (error) return dbErr(error)
        return out(data, `${data?.length ?? 0} rows${a.count ? ` of ${count}` : ''}${(data?.length ?? 0) === limit ? ' (more may exist — use offset)' : ''}`)
      }
      case 'erp_insert': {
        const t = checkTable(a.table)
        const rows = Array.isArray(a.rows) ? a.rows.slice(0, 50) : []
        if (!rows.length) return fail('rows is empty')
        const { data, error } = await sb.from(t).insert(rows).select()
        return error ? dbErr(error) : out(data, `Inserted ${data?.length ?? 0} row(s) into ${t}`)
      }
      case 'erp_update': {
        const t = checkTable(a.table)
        if (!Array.isArray(a.filters) || !a.filters.length) return fail('At least one filter is required')
        if (!a.values || typeof a.values !== 'object' || !Object.keys(a.values).length) return fail('values is empty')
        const { count, error: ce } = await applyFilters(sb.from(t).select('*', { count: 'exact', head: true }), a.filters)
        if (ce) return dbErr(ce)
        if ((count ?? 0) === 0) return fail('No rows match these filters (or this login cannot see them).')
        if ((count ?? 0) > 50) return fail(`${count} rows match — too many to change at once (max 50). Narrow the filters.`)
        const { data, error } = await applyFilters(sb.from(t).update(a.values), a.filters).select()
        if (error) return dbErr(error)
        if (!data?.length) return fail('Nothing was changed — this login does not have edit rights on these rows.')
        return out(data, `Updated ${data.length} row(s) in ${t}`)
      }
      case 'erp_delete': {
        const t = checkTable(a.table)
        if (a.confirm !== true) return fail('Set confirm=true only after the user explicitly agreed to delete these rows.')
        if (!Array.isArray(a.filters) || !a.filters.length) return fail('At least one filter is required')
        const { count, error: ce } = await applyFilters(sb.from(t).select('*', { count: 'exact', head: true }), a.filters)
        if (ce) return dbErr(ce)
        if ((count ?? 0) === 0) return fail('No rows match these filters (or this login cannot see them).')
        if ((count ?? 0) > 20) return fail(`${count} rows match — too many to delete at once (max 20).`)
        const { data, error } = await applyFilters(sb.from(t).delete(), a.filters).select()
        if (error) return dbErr(error)
        if (!data?.length) return fail('Nothing was deleted — this login does not have delete rights on these rows.')
        return out(data, `Deleted ${data.length} row(s) from ${t}`)
      }
      case 'erp_list_functions': {
        const { data, error } = await sb.rpc('mcp_list_functions', { p_search: a.search || null })
        if (error) return dbErr(error)
        return out(data, `${(data || []).length} functions${a.search ? '' : ' (use search to narrow)'}`)
      }
      case 'erp_call_function': {
        const fn = String(a.name || '')
        if (!IDENT.test(fn) || /^(mcp_|staff_|erp_pre_request)/.test(fn)) return fail(`Function not available: ${fn}`)
        const { data, error } = await sb.rpc(fn, a.args || {})
        return error ? dbErr(error) : out(data ?? { ok: true }, `Ran ${fn}`)
      }
      default: return fail(`Unknown tool: ${name}`)
    }
  } catch (e: any) {
    return fail(e?.message || String(e))
  }
}
