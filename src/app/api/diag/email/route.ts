/* eslint-disable @typescript-eslint/no-explicit-any */
// TEMPORARY read-only diagnostic. GET checks domain verification.
// GET ?test=1 sends ONE email to Resend's test sink (delivered@resend.dev) —
// reaches no real person — and reports Resend's exact response (id or error,
// e.g. quota/429). Safe to delete after use.
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const key = process.env.RESEND_API_KEY
  const fromEmail = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
  const fromName = process.env.FROM_NAME || 'beyondGREEN ERP'
  if (!key) return Response.json({ keyPresent: false, fromEmail, error: 'RESEND_API_KEY missing at runtime' })

  const doTest = new URL(req.url).searchParams.get('test') === '1'

  try {
    const domRes = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    })
    const domData: any = await domRes.json()
    const domains = Array.isArray(domData?.data)
      ? domData.data.map((d: any) => ({ name: d.name, status: d.status }))
      : domData

    let testSend: any = 'not-run (add ?test=1)'
    if (doTest) {
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: ['delivered@resend.dev'],
          subject: 'ERP email diagnostic test',
          html: '<p>Diagnostic test send. Ignore.</p>',
        }),
      })
      const sendBody: any = await sendRes.json().catch(() => ({}))
      testSend = { httpStatus: sendRes.status, ok: sendRes.ok, id: sendBody?.id ?? null, error: sendBody?.message ?? sendBody?.name ?? null }
    }

    return Response.json({
      keyPresent: true,
      fromEmail,
      fromDomain: fromEmail.split('@')[1],
      domainsStatus: domRes.status,
      domains,
      testSend,
    })
  } catch (err) {
    return Response.json({ keyPresent: true, fromEmail, error: String(err) })
  }
}
