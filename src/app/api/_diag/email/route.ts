/* eslint-disable @typescript-eslint/no-explicit-any */
// TEMPORARY read-only diagnostic — checks Resend config/domain verification.
// Sends no email. Returns domain names + verification status only (no secrets).
// Safe to delete after use.
export const dynamic = 'force-dynamic'

export async function GET() {
  const key = process.env.RESEND_API_KEY
  const fromEmail = process.env.FROM_EMAIL || 'erp@beyondgreenbiotech.com'
  if (!key) return Response.json({ keyPresent: false, fromEmail, error: 'RESEND_API_KEY missing at runtime' })

  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    })
    const data: any = await res.json()
    const domains = Array.isArray(data?.data)
      ? data.data.map((d: any) => ({ name: d.name, status: d.status, region: d.region }))
      : data
    return Response.json({
      keyPresent: true,
      keyPrefix: key.slice(0, 5),
      fromEmail,
      fromDomain: fromEmail.split('@')[1],
      resendStatus: res.status,
      domains,
    })
  } catch (err) {
    return Response.json({ keyPresent: true, fromEmail, error: String(err) })
  }
}
