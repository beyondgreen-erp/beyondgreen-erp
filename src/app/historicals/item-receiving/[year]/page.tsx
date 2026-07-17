'use client'
export const dynamic = 'force-dynamic'
import { useParams } from 'next/navigation'
import ReceivingBoard from '@/components/ReceivingBoard'

const YEARS = [2022, 2023, 2024, 2025]

export default function Page() {
  const params = useParams()
  const raw = Array.isArray(params.year) ? params.year[0] : (params.year as string)
  const year = Number(raw)
  if (!YEARS.includes(year)) {
    return <div className="min-h-screen mon-page p-8"><p className="text-gray-500 text-sm">Unknown receiving board: {raw}</p></div>
  }
  return <ReceivingBoard year={year} />
}
