// The Civil Doody Orders board lives as a tab on Sales Orders. Old links land there.
import { redirect } from 'next/navigation'

export default function CivilDoodyOrdersRedirect() {
  redirect('/sales/orders?view=civildoody')
}
