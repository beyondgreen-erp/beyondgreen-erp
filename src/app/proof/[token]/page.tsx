'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = 'force-dynamic'
import nextDynamic from 'next/dynamic'

const ProofPortal = nextDynamic(() => import('@/components/packaging/ProofPortal'), {
  ssr: false,
  loading: () => <div className="min-h-screen grid place-items-center text-gray-400 text-sm">Loading proof…</div>,
})

export default function ProofPage() {
  return <ProofPortal />
}
