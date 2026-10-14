/**
 * Turns a failure from the AI service into something the person on the page can act on.
 *
 * The SDK puts the raw HTTP body in the error message, so an expired key reached the team
 * as: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid
 * x-api-key"},"request_id":"req_011..."}. That tells whoever is uploading nothing about
 * what went wrong or what to do, and it reads as though their file was at fault.
 */
export function aiErrorMessage(err: unknown, fallback = 'Could not read the file.'): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const status = (err as { status?: number } | null)?.status

  if (status === 401 || /authentication_error|invalid x-api-key/i.test(raw)) {
    return 'The AI service key is not valid, so the file could not be read. Nothing is wrong with your file. Please pass this on to Rudy: the ANTHROPIC_API_KEY in the Vercel project needs to be refreshed.'
  }
  if (status === 429 || /rate_?limit/i.test(raw)) {
    return 'The AI service is busy right now. Please wait a minute and try the upload again.'
  }
  if (status === 529 || /overloaded/i.test(raw)) {
    return 'The AI service is overloaded right now. Please try again in a few minutes.'
  }
  if (/credit balance|insufficient|billing/i.test(raw)) {
    return 'The AI service account is out of credit. Please pass this on to Rudy so he can top it up.'
  }
  // Anything unrecognized goes through as it was, so a real problem is never hidden.
  return raw || fallback
}
