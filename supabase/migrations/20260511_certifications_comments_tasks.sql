-- ─── CERTIFICATIONS TABLE ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS certifications (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  cert_name          text        NOT NULL,
  issuing_body       text,
  issue_date         date,
  expiry_date        date,
  status             text        DEFAULT 'Active',
  responsible_person text,
  customer_id        uuid        REFERENCES customers(id) ON DELETE SET NULL,
  vendor_id          uuid        REFERENCES vendors(id) ON DELETE SET NULL,
  notes              text,
  is_active          boolean     DEFAULT true,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
ALTER TABLE certifications DISABLE ROW LEVEL SECURITY;

-- ─── COMMENTS TABLE ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  record_type text        NOT NULL,
  record_id   uuid        NOT NULL,
  author_email text       NOT NULL,
  content     text        NOT NULL,
  is_edited   boolean     DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE comments DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE comments;

-- ─── TASKS — add linked_record columns if missing ────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS linked_record_type text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS linked_record_id   uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS group_name         text DEFAULT 'Current';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS customer_id        uuid REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE tasks DISABLE ROW LEVEL SECURITY;

-- ─── FILE ATTACHMENTS — ensure table exists ──────────────────────────────────
CREATE TABLE IF NOT EXISTS file_attachments (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  record_type  text,
  record_id    uuid,
  file_name    text,
  file_size    integer,
  file_type    text,
  storage_path text,
  uploaded_by  text,
  public_url   text,
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE file_attachments DISABLE ROW LEVEL SECURITY;

-- ─── STORAGE: per-operation policies (more reliable than one FOR ALL) ─────────
DROP POLICY IF EXISTS "Full storage access authenticated" ON storage.objects;
DROP POLICY IF EXISTS "erp storage insert"               ON storage.objects;
DROP POLICY IF EXISTS "erp storage select"               ON storage.objects;
DROP POLICY IF EXISTS "erp storage update"               ON storage.objects;
DROP POLICY IF EXISTS "erp storage delete"               ON storage.objects;

CREATE POLICY "erp storage insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('erp-files','erp-images'));

CREATE POLICY "erp storage select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('erp-files','erp-images'));

CREATE POLICY "erp storage update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('erp-files','erp-images'));

CREATE POLICY "erp storage delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('erp-files','erp-images'));
