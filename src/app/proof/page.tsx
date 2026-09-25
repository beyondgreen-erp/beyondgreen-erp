export const metadata = { title: 'beyondGREEN — Proofs', robots: { index: false, follow: false } }

export default function ProofLanding() {
  return (
    <div className="min-h-screen grid place-items-center bg-[#F5F6FA] p-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto w-12 h-12 rounded-xl grid place-items-center text-white font-bold" style={{ background: '#2ABF06' }}>bG</div>
        <h1 className="text-lg font-bold text-gray-900">beyondGREEN packaging proofs</h1>
        <p className="text-sm text-gray-500">Open the proof link you received from the beyondGREEN team. If your link isn&apos;t working, ask your beyondGREEN contact for a new one.</p>
      </div>
    </div>
  )
}
