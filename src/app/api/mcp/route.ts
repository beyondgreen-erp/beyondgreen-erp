/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * beyondGREEN ERP — remote MCP server (Streamable HTTP, stateless JSON responses) for Claude connectors.
 * Auth: OAuth 2.1 bearer tokens issued by /api/oauth/token after the person approves at /oauth/authorize.
 */
import { NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin'
import { CORS, baseUrl, connectionForBearer, userClient } from '@/lib/mcp/oauth'
import { INSTRUCTIONS, TOOLS, callTool } from '@/lib/mcp/tools'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

function unauthorized(req: NextRequest, desc = 'Sign in required') {
  const b = baseUrl(req)
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: desc }), {
    status: 401,
    headers: { ...CORS, 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${b}/.well-known/oauth-protected-resource/api/mcp", scope="erp"` },
  })
}
const rpcResult = (id: any, result: any) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id: any, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null
  const conn = await connectionForBearer(bearer)
  if (!conn) return unauthorized(req, bearer ? 'Token is invalid, expired or revoked' : 'Sign in required')

  let body: any
  try { body = await req.json() } catch { return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400, headers: CORS }) }
  const batch = Array.isArray(body) ? body : [body]
  const sb = userClient(conn.sbAccess)
  const admin = createSupabaseAdminClient()
  const out: any[] = []

  for (const m of batch) {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') { out.push(rpcError(m?.id, -32600, 'Invalid request')); continue }
    const isNote = m.id === undefined || m.id === null
    switch (m.method) {
      case 'initialize': {
        const want = m.params?.protocolVersion
        out.push(rpcResult(m.id, {
          protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'beyondgreen-erp', title: 'beyondGREEN ERP', version: '1.0.0' },
          instructions: INSTRUCTIONS + `\nConnected as ${conn.email}.`,
        }))
        break
      }
      case 'ping': out.push(rpcResult(m.id, {})); break
      case 'tools/list': out.push(rpcResult(m.id, { tools: TOOLS })); break
      case 'tools/call': {
        const name = String(m.params?.name || '')
        const result = await callTool(sb, name, m.params?.arguments || {})
        out.push(rpcResult(m.id, result))
        const { data: cur } = await admin.from('mcp_tokens').select('call_count').eq('id', conn.id).maybeSingle()
        await admin.from('mcp_tokens').update({ last_used_at: new Date().toISOString(), last_tool: name, call_count: (cur?.call_count || 0) + 1 }).eq('id', conn.id)
        break
      }
      case 'resources/list': out.push(rpcResult(m.id, { resources: [] })); break
      case 'prompts/list': out.push(rpcResult(m.id, { prompts: [] })); break
      default:
        if (!isNote) out.push(rpcError(m.id, -32601, `Method not found: ${m.method}`))
    }
  }

  if (!out.length) return new Response(null, { status: 202, headers: CORS })
  return Response.json(Array.isArray(body) ? out : out[0], { headers: { ...CORS, 'Cache-Control': 'no-store' } })
}

export async function GET() {
  // No server-initiated stream; clients fall back to plain POST request/response.
  return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, Allow: 'POST' } })
}
export async function DELETE() { return new Response(null, { status: 204, headers: CORS }) }
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }) }
