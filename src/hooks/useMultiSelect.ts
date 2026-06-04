'use client'
import { useState, useCallback } from 'react'

export function useMultiSelect<T extends { id: string }>() {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback((items: T[]) => {
    setSelected(prev =>
      prev.size === items.length
        ? new Set()
        : new Set(items.map(i => i.id))
    )
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  return {
    selected,
    toggle,
    toggleAll,
    clear,
    count: selected.size,
    isSelected: (id: string) => selected.has(id),
    isAllSelected: (items: T[]) => items.length > 0 && selected.size === items.length,
    isSomeSelected: (items: T[]) => selected.size > 0 && selected.size < items.length,
  }
}
