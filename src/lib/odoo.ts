/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Odoo client for customer Odoo databases (first: Civil Doody, Odoo saas~19).
 * Two targets:
 *   test = civildoody-workflow-testing.odoo.com (key ODOO_TEST_API_KEY) — DEFAULT, writes allowed
 *   live = civildoody.odoo.com (key ODOO_API_KEY) — read-only unless ODOO_WRITE_ENABLED = "1"
 * Uses the Odoo 19 JSON-2 API (POST /json/2/<model>/<method>, Bearer API key), falling back to JSON-RPC.
 * Keys live only in Vercel env, never in the DB or the browser.
 */
export type OdooTarget = 'test' | 'live'
const T = {
  test: { url: process.env.ODOO_TEST_URL || 'https://civildoody-workflow-testing.odoo.com', db: process.env.ODOO_TEST_DB || 'civildoody-workflow-testing', keyEnv: 'ODOO_TEST_API_KEY' },
  live: { url: process.env.ODOO_URL || 'https://civildoody.odoo.com', db: process.env.ODOO_DB || 'civildoody', keyEnv: 'ODOO_API_KEY' },
}
export const ODOO_LOGIN = process.env.ODOO_LOGIN || 'rudyp@beyondgreenbiotech.com'
export const odooTarget = (t?: string | null): OdooTarget => (t === 'live' ? 'live' : (process.env.ODOO_DEFAULT_TARGET === 'live' && !t ? 'live' : 'test'))
export const odooInfo = (t: OdooTarget) => ({ target: t, url: T[t].url, db: T[t].db, hasKey: !!process.env[T[t].keyEnv], writes: odooWritesOn(t) ? 'ON' : 'blocked' })
export const odooWritesOn = (t: OdooTarget) => t === 'test' || process.env.ODOO_WRITE_ENABLED === '1'
const READ = new Set(['search_read', 'read', 'search', 'search_count', 'fields_get', 'context_get', 'name_search', 'read_group', 'web_search_read', 'formatted_read_group'])

const rpcUid: Record<string, number> = {}
async function jsonRpc(url: string, service: string, method: string, args: any[]) {
  const r = await fetch(url + '/jsonrpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: { service, method, args } }),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error.data?.message || j.error.message || 'Odoo RPC error')
  return j.result
}

export async function odooCall(target: OdooTarget, model: string, method: string, kwargs: Record<string, any> = {}, ids?: number[]): Promise<any> {
  const cfg = T[target]
  const key = process.env[cfg.keyEnv]
  if (!key) throw new Error(`${cfg.keyEnv} is not set`)
  if (!READ.has(method) && !odooWritesOn(target)) throw new Error(`Odoo write "${model}.${method}" blocked on ${target} (read-only mode)`)
  const body: any = { ...kwargs }
  if (ids) body.ids = ids
  const r = await fetch(`${cfg.url}/json/2/${model}/${method}`, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `bearer ${key}`, 'X-Odoo-Database': cfg.db },
    body: JSON.stringify(body),
  })
  if (r.status === 404) {
    if (!rpcUid[target]) rpcUid[target] = await jsonRpc(cfg.url, 'common', 'authenticate', [cfg.db, ODOO_LOGIN, key, {}])
    if (!rpcUid[target]) throw new Error('Odoo authentication failed')
    return jsonRpc(cfg.url, 'object', 'execute_kw', [cfg.db, rpcUid[target], key, model, method, ids ? [ids] : [], kwargs])
  }
  const txt = await r.text()
  let j: any; try { j = JSON.parse(txt) } catch { j = txt }
  if (!r.ok) throw new Error(`Odoo ${r.status}: ${typeof j === 'object' ? (j.message || j.name || JSON.stringify(j).slice(0, 300)) : String(j).slice(0, 300)}`)
  return j
}
