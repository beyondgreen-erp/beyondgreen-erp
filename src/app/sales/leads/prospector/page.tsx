import { redirect } from 'next/navigation'

// Lead Prospector was retired — we use Apollo.io now. All prospector leads live on the Leads board.
export default function Page() {
  redirect('/sales/leads')
}
