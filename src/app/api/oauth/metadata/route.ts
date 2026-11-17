import { NextRequest } from 'next/server'
import { baseUrl, jsonRes, CORS } from '@/lib/mcp/oauth'
export const dynamic = 'force-dynamic'

/**
 * OAuth discovery for the Claude connector. The middleware rewrites
 *   /.well-known/oauth-authorization-server[/...]  -> ?kind=as   (RFC 8414)
 *   /.well-known/oauth-protected-resource[/...]    -> ?kind=pr   (RFC 9728)
 */
export async function GET(req: NextRequest) {
  const b = baseUrl(req)
  if (req.nextUrl.searchParams.get('kind') === 'pr') {
    return jsonRes({
      resource: `${b}/api/mcp`,
      authorization_servers: [b],
      scopes_supported: ['erp'],
      bearer_methods_supported: ['header'],
      resource_name: 'beyondGREEN ERP',
    })
  }
  return jsonRes({
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/api/oauth/token`,
    registration_endpoint: `${b}/api/oauth/register`,
    revocation_endpoint: `${b}/api/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['erp'],
    service_documentation: `${b}/settings/connectors`,
  })
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }) }
