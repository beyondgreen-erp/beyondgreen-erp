'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

interface Photo {
  id: string
  url: string
  type: string
  caption: string
  file_name: string
}

interface Props {
  shipmentId: string
  onPhotosChange: (photos: Photo[]) => void
  required?: boolean
}

const SHIPPING_PHOTO_TYPES = [
  { type: 'packed_pallet', label: 'Packed & Wrapped Pallet', required: true },
  { type: 'shipping_label', label: 'Shipping Label', required: true },
  { type: 'sealed_cases', label: 'Sealed Cases', required: true },
  { type: 'bol_document', label: 'Bill of Lading', required: true },
  { type: 'truck_loaded', label: 'Truck Loaded', required: false },
]

export default function ShippingPhotoCapture({ shipmentId, onPhotosChange, required = true }: Props) {
  const supabase = createSupabaseBrowserClient()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [uploading, setUploading] = useState(false)

  async function handleCapture(e: React.ChangeEvent<HTMLInputElement>, photoType: string) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fileName = `shipping/${shipmentId}/${photoType}-${Date.now()}.jpg`
      const { error } = await supabase.storage.from('erp-images').upload(fileName, file, { upsert: true })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('erp-images').getPublicUrl(fileName)
      const newPhoto: Photo = {
        id: Date.now().toString(),
        url: urlData.publicUrl,
        type: photoType,
        caption: photoType,
        file_name: fileName,
      }
      const updated = [...photos, newPhoto]
      setPhotos(updated)
      onPhotosChange(updated)
    } catch (err: unknown) {
      alert('Upload failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setUploading(false)
    }
  }

  function removePhoto(id: string) {
    const updated = photos.filter(p => p.id !== id)
    setPhotos(updated)
    onPhotosChange(updated)
  }

  const requiredTypes = SHIPPING_PHOTO_TYPES.filter(t => t.required)
  const requiredCaptured = requiredTypes.filter(t => photos.some(p => p.type === t.type)).length
  const allRequiredDone = requiredCaptured === requiredTypes.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          Shipping Photos {required && <span className="text-red-400">*</span>}
        </h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${allRequiredDone ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
          {requiredCaptured}/{requiredTypes.length} required
        </span>
      </div>

      {uploading && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          Uploading...
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {SHIPPING_PHOTO_TYPES.map(pt => {
          const captured = photos.filter(p => p.type === pt.type)
          const done = captured.length > 0
          return (
            <div
              key={pt.type}
              className={`p-3 rounded-xl border ${done ? 'border-emerald-500/30 bg-emerald-500/5' : pt.required ? 'border-amber-500/20 bg-amber-50' : 'border-[#E4E6EE] bg-white'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {done ? (
                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  ) : (
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  )}
                  <span className="text-sm text-white">{pt.label}</span>
                  {pt.required ? (
                    <span className="text-xs text-amber-400 font-medium">Required</span>
                  ) : (
                    <span className="text-xs text-gray-500">Optional</span>
                  )}
                </div>
                <label className="flex items-center gap-1.5 bg-[#F5F6FA] hover:bg-[#F5F6FA] border border-[#E4E6EE] text-gray-500 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  {done ? 'Add Another' : 'Take Photo'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => handleCapture(e, pt.type)}
                  />
                </label>
              </div>
              {captured.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-2">
                  {captured.map(photo => (
                    <div key={photo.id} className="relative group">
                      <img
                        src={photo.url}
                        alt={photo.caption}
                        className="w-16 h-16 object-cover rounded-lg border border-[#E4E6EE]"
                      />
                      <button
                        onClick={() => removePhoto(photo.id)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-xs hidden group-hover:flex items-center justify-center"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
