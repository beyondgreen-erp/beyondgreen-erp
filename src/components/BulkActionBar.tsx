'use client'

interface BulkActionBarProps {
  count: number
  onDelete: () => void
  onClear: () => void
  deleting?: boolean
  extraActions?: React.ReactNode
}

export default function BulkActionBar({ count, onDelete, onClear, deleting, extraActions }: BulkActionBarProps) {
  if (count === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-[#E4E6EE] rounded-2xl shadow-xl flex items-center gap-3 px-5 py-3.5">
      <span className="font-medium text-sm" style={{color:'#1A1D2E'}}>{count} selected</span>
      <div className="w-px h-5" style={{background:'#E4E6EE'}} />
      {extraActions}
      <button
        onClick={onDelete}
        disabled={deleting}
        className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
        style={{background:'#FEF2F2',color:'#DC2626',border:'1px solid #FECACA'}}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        {deleting ? 'Deleting…' : `Delete ${count}`}
      </button>
      <button
        onClick={onClear}
        className="text-sm px-3 py-2 rounded-xl transition-colors"
        style={{color:'#6B7280'}}
        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#F5F6FA'}}
        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent'}}
      >
        Cancel
      </button>
    </div>
  )
}
