/* eslint-disable @typescript-eslint/no-explicit-any */
// Activity trail for a packaging design — both beyondGREEN and the printer.
export const APPROVERS: { email: string; name: string }[] = [
  { email: 'rudyp@beyondgreenbiotech.com', name: 'Rudy Patel' },
  { email: 'veejay.patell@byndgrn.com', name: 'Veejay Patell' },
  { email: 'tiya@beyondgreenbiotech.com', name: 'Tiya' },
  { email: 'dhanush.k@beyondgreenbiotech.com', name: 'Dhanush' },
  { email: 'shea@beyondgreenbiotech.com', name: 'Shea' },
]
export const isApprover = (email?: string | null) => !!email && APPROVERS.some(a => a.email.toLowerCase() === email.toLowerCase())

export const ACTIVITY_LABELS: Record<string, string> = {
  link_created: 'Printer link created', link_revoked: 'Printer link revoked', link_extended: 'Printer link extended',
  original_uploaded: 'Original file uploaded', artwork_replaced: 'Artwork replaced with original file',
  portal_opened: 'Printer opened the proof', downloaded: 'Downloaded a file',
  comment: 'Comment', reply: 'Reply', comment_resolved: 'Comment resolved',
  submitted: 'Printer submitted for approval', confirmed: 'Confirmed', changes_requested: 'Changes requested',
  approved: 'Approved for production', approval_sent: 'Approval sent to printer', round_cancelled: 'Approval round cancelled',
  final_files_saved: 'Final files saved',
}

/** Team-side logging from the ERP (RLS allows authenticated users to insert team entries). */
export async function logActivity(sb: any, designId: string, user: { email: string; name: string }, action: string, details: any = {}, shareLinkId?: string | null) {
  try {
    await sb.from('packaging_activity').insert({ design_id: designId, share_link_id: shareLinkId || null, actor_type: 'team', actor_name: user.name || user.email, actor_email: user.email, action, details })
  } catch { /* never block the UI on logging */ }
}
