'use client'
export const dynamic = 'force-dynamic'
import { useParams } from 'next/navigation'
import HistoricalBoard from '@/components/HistoricalBoard'

export default function HistoricalBoardPage() {
  const params = useParams()
  const board = Array.isArray(params.board) ? params.board[0] : (params.board as string)
  return <HistoricalBoard boardKey={board} />
}
