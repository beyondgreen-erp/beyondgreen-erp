import { redirect } from 'next/navigation'

// Inbox reply-scanning retired — replies are managed in Apollo.io now.
export default function Page() {
  redirect('/sales/leads')
}
