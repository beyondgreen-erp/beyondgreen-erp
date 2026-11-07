'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export interface EmployeeLite { id: string; name: string; email?: string | null; department?: string | null; job_description?: string | null; status?: string | null }

let cache: EmployeeLite[] | null = null
let inflight: Promise<EmployeeLite[]> | null = null

// Active employees from the Team Directory (HR), used for owner / responsible-person fields.
export function useEmployees() {
  const [list, setList] = useState<EmployeeLite[]>(cache || [])
  useEffect(() => {
    if (cache) return
    inflight ||= (async () => {
      const sb = createSupabaseBrowserClient()
      const { data } = await sb.from('employees').select('id,name,email,department,job_description,status').order('name')
      cache = ((data as any[]) || []).filter(e => e.name && !/past|terminated|inactive/i.test(String(e.status || '')))
      return cache
    })()
    inflight.then(setList).catch(() => {})
  }, [])
  return list
}

export function directoryHref(name: string) { return `/hr/directory?q=${encodeURIComponent(name.split(',')[0].trim())}` }

// Split a people field ("Rudy Patel, Shea Finn") into names
export function peopleOf(v: any): string[] { return String(v || '').split(/,|;|\n/).map(s => s.trim()).filter(Boolean) }
