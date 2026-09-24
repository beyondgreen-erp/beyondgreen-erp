import { redirect } from 'next/navigation'

// Sequences retired — outbound cadences are handled in Apollo.io now.
export default function Page() {
  redirect('/sales/leads')
}
