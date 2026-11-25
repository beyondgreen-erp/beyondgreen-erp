'use client'
// The Civil Doody Orders board lives as a tab on Sales Orders. Old links land there.
// A full page load is used on purpose: Sales Orders reads ?view= once when it first opens.
import { useEffect } from 'react'

export default function CivilDoodyOrdersRedirect() {
  useEffect(() => { window.location.replace('/sales/orders?view=civildoody') }, [])
  return <p className="p-6 text-sm text-gray-500">Opening Civil Doody Orders...</p>
}
