// Shared Zoho-style UI primitives

export function Btn({ children, onClick, variant = 'primary', size = 'md', disabled, type = 'button', className = '' }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary'|'secondary'|'danger'|'ghost'; size?: 'sm'|'md'; disabled?: boolean; type?: 'button'|'submit'; className?: string
}) {
  const base = 'inline-flex items-center gap-2 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  const variants = {
    primary: 'bg-[#3B6FE0] hover:bg-[#2D5EC7] text-white',
    secondary: 'bg-white border border-[#E4E6EE] text-[#374151] hover:bg-[#F5F6FA]',
    danger: 'bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] hover:bg-[#FEE2E2]',
    ghost: 'text-[#6B7280] hover:text-[#1A1D2E] hover:bg-[#F5F6FA]',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default'|'success'|'warning'|'danger'|'info'|'purple' }) {
  const variants = {
    default: 'bg-[#F3F4F6] text-[#6B7280]',
    success: 'bg-[#ECFDF5] text-[#059669]',
    warning: 'bg-[#FFFBEB] text-[#D97706]',
    danger:  'bg-[#FEF2F2] text-[#DC2626]',
    info:    'bg-[#EFF6FF] text-[#2563EB]',
    purple:  'bg-[#F5F3FF] text-[#7C3AED]',
  }
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[variant]}`}>{children}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: 'default'|'success'|'warning'|'danger'|'info'|'purple'; label: string }> = {
    'In Production':       { variant: 'info',    label: 'In Production' },
    'Awaiting Production': { variant: 'warning', label: 'Awaiting Prod.' },
    'Production Complete': { variant: 'success', label: 'Prod. Complete' },
    'Ready to Ship':       { variant: 'purple',  label: 'Ready to Ship' },
    'Ready at Will Call':  { variant: 'purple',  label: 'Will Call' },
    'Shipped':             { variant: 'success', label: 'Shipped' },
    'Partially Shipped':   { variant: 'warning', label: 'Partial Ship' },
    'On Hold':             { variant: 'danger',  label: 'On Hold' },
    'Confirmed':           { variant: 'info',    label: 'Confirmed' },
    'Pending':             { variant: 'default', label: 'Pending' },
    'New':                 { variant: 'default', label: 'New' },
    'New Order':           { variant: 'default', label: 'New Order' },
    'Paid':                { variant: 'success', label: 'Paid' },
    'paid':                { variant: 'success', label: 'Paid' },
    'pending':             { variant: 'warning', label: 'Pending' },
    'overdue':             { variant: 'danger',  label: 'Overdue' },
    'Overdue':             { variant: 'danger',  label: 'Overdue' },
    'proforma':            { variant: 'default', label: 'Proforma' },
    'Draft':               { variant: 'default', label: 'Draft' },
    'Sent':                { variant: 'info',    label: 'Sent' },
    'Accepted':            { variant: 'success', label: 'Accepted' },
    'Rejected':            { variant: 'danger',  label: 'Rejected' },
    'Expired':             { variant: 'warning', label: 'Expired' },
    'Converted':           { variant: 'purple',  label: 'Converted' },
    'Cancelled':           { variant: 'danger',  label: 'Cancelled' },
    'Closed':              { variant: 'default', label: 'Closed' },
    'Queued':              { variant: 'default', label: 'Queued' },
    'In Progress':         { variant: 'info',    label: 'In Progress' },
    'QC':                  { variant: 'purple',  label: 'QC' },
    'Complete':            { variant: 'success', label: 'Complete' },
    'void':                { variant: 'default', label: 'Void' },
    'partial':             { variant: 'warning', label: 'Partial' },
    'Received':            { variant: 'success', label: 'Received' },
  }
  const { variant, label } = map[status] ?? { variant: 'default' as const, label: status }
  return <Badge variant={variant}>{label}</Badge>
}

export function Card({ children, className = '', padding = true }: { children: React.ReactNode; className?: string; padding?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border ${padding ? 'p-5' : ''} ${className}`} style={{ borderColor: '#E4E6EE' }}>
      {children}
    </div>
  )
}

export function StatCard({ label, value, icon, color = '#3B6FE0', trend, trendUp, href }: {
  label: string; value: string|number; icon?: string; color?: string; trend?: string; trendUp?: boolean; href?: string
}) {
  const content = (
    <div className="bg-white rounded-xl border p-5 hover:shadow-sm transition-shadow" style={{ borderColor: '#E4E6EE' }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm" style={{ color: '#9CA3AF' }}>{label}</p>
          <p className="text-2xl font-bold mt-1" style={{ color: '#1A1D2E' }}>{value}</p>
          {trend && <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: trendUp ? '#059669' : '#DC2626' }}>{trend}</p>}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: color + '18' }}>
            <i className={`${icon} text-xl`} style={{ color }}/>
          </div>
        )}
      </div>
    </div>
  )
  if (href) return <a href={href}>{content}</a>
  return content
}

export const INP = 'w-full px-3 py-2 rounded-lg border text-sm bg-white focus:outline-none transition-all'
export const INP_STYLE = { borderColor: '#E4E6EE', color: '#1A1D2E' }

// Common table styles
export const TH = 'text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap'
export const TD = 'px-4 py-3.5 text-sm'
export const TR_HOVER = 'cursor-pointer transition-colors'
