/* eslint-disable @typescript-eslint/no-explicit-any */
export async function uploadFile(
  supabase: any,
  file: File,
  recordType: string,
  recordId: string,
  uploaderEmail: string
): Promise<{ success: boolean; error?: string }> {
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${recordType}/${recordId}/${timestamp}_${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('erp-files')
    .upload(path, file, { cacheControl: '3600', upsert: true })

  if (uploadError) return { success: false, error: uploadError.message }

  const { error: dbError } = await supabase.from('file_attachments').insert({
    record_type: recordType,
    record_id: recordId,
    file_name: file.name,
    file_size: file.size,
    file_type: file.type,
    storage_path: path,
    uploaded_by: uploaderEmail,
  })

  return { success: !dbError, error: dbError?.message }
}

export async function downloadFile(
  supabase: any,
  storagePath: string,
  fileName: string
) {
  const { data, error } = await supabase.storage.from('erp-files').download(storagePath)
  if (error || !data) return
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export async function getFileUrl(
  supabase: any,
  storagePath: string
): Promise<string | null> {
  const { data } = await supabase.storage
    .from('erp-files')
    .createSignedUrl(storagePath, 3600)
  return data?.signedUrl || null
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function fileIcon(fileType: string, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (fileType.startsWith('image/')) return 'image'
  if (fileType === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (['xlsx', 'xls', 'csv'].includes(ext) || fileType.includes('spreadsheet') || fileType.includes('excel')) return 'spreadsheet'
  if (['docx', 'doc'].includes(ext) || fileType.includes('word')) return 'word'
  return 'file'
}
