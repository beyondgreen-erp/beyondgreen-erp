/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Odoo client for customer Odoo databases (first: Civil Doody, civildoody.odoo.com, Odoo saas~19).
 * Uses the Odoo 19 JSON-2 API (POST /json/2/<model>/<method>, Bearer API key), falling back to
 * classic JSON-RPC execute_kw. Key lives only in env ODOO_API_KEY (never in the DB or client).
 *
 * SAFETY: writes are blocked unless ODOO_WRITE_ENABLED = "1". Live Civil Doody stays read-only
 * until Rudy approves.
 */
export const ODOO = {
  url: (process.env.ODOO_URL || 'https://civildoody.odoo.com').replace(/\/$/, ''),
  db: process.env.ODOO_DB || 'civildoody',
  login: process.env.ODOO_LOGIN || 'rudyp@beyondgreenbiotech.com',
}
const READ = new Set(['search_read', 'read', 'search', 'search_count', 'fields_get', 'context_get', 'name_search', 'read_group', 'web_search_read'])
export const odooWritesOn = () => process.env.ODOO_WRITE_ENABLED === '1'

let rpcUid: number | null = null
async function jsonRpc(service: string, method: string, args: any[]) {
  const r = await fetch(ODOO.url + '/jsonrpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: { service, method, args } }),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error.data?.message || j.error.message || 'Odoo RPC error')
  return j.result
}

export async function odooCall(model: string, method: string, kwargs: Record<string, any> = {}, ids?: number[]): Promise<any> {
  const key = process.env.ODOO_API_KEY
  if (!key) throw new Error('ODOO_API_KEY is not set')
  if (!READ.has(method) && !odooWritesOn()) throw new Error(`Odoo write "${model}.${method}" blocked (read-only mode)`)
  const body: any = { ...kwargs }
  if (ids) body.ids = ids
  const r = await fetch(`${ODOO.url}/json/2/${model}/${method}`, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `bearer ${key}`, 'X-Odoo-Database': ODOO.db },
    body: JSON.stringify(body),
  })
  if (r.status === 404) {
    // older server without JSON-2: classic execute_kw
    if (rpcUid == null) rpcUid = await jsonRpc('common', 'authenticate', [ODOO.db, ODOO.login, key, {}])
    if (!rpcUid) throw new Error('Odoo authentication failed')
    const args = ids ? [ids] : []
    return jsonRpc('object', 'execute_kw', [ODOO.db, rpcUid, key, model, method, args, kwargs])
  }
  const txt = await r.text()
  let j: any; try { j = JSON.parse(txt) } catch { j = txt }
  if (!r.ok) throw new Error(`Odoo ${r.status}: ${typeof j === 'object' ? (j.message || j.name || JSON.stringify(j).slice(0, 300)) : String(j).slice(0, 300)}`)
  return j
}
