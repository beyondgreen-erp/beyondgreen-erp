-- ─── PERSONAL REMINDERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_reminders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  title text NOT NULL,
  notes text,
  due_date date,
  due_time text,
  priority text DEFAULT 'medium',
  is_completed boolean DEFAULT false,
  completed_at timestamptz,
  is_private boolean DEFAULT true,
  color text DEFAULT '#1D9E75',
  reminder_type text DEFAULT 'personal',
  linked_customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  linked_order_id uuid REFERENCES sales_orders(id) ON DELETE SET NULL,
  linked_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own reminders only" ON user_reminders;
CREATE POLICY "Users see own reminders only"
  ON user_reminders FOR ALL
  USING (user_email = auth.jwt() ->> 'email')
  WITH CHECK (user_email = auth.jwt() ->> 'email');

ALTER PUBLICATION supabase_realtime ADD TABLE user_reminders;

-- ─── CUSTOMER CONVERSATIONS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  logged_by text NOT NULL,
  conversation_type text DEFAULT 'note',
  subject text,
  content text NOT NULL,
  contact_name text,
  outcome text,
  follow_up_date date,
  follow_up_notes text,
  is_pinned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE customer_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Full CRUD authenticated" ON customer_conversations;
CREATE POLICY "Full CRUD authenticated"
  ON customer_conversations FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

ALTER PUBLICATION supabase_realtime ADD TABLE customer_conversations;

-- ─── STORAGE BUCKETS (run in SQL editor or via dashboard) ──────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('erp-files', 'erp-files', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('erp-images', 'erp-images', true)
ON CONFLICT (id) DO NOTHING;

-- Full storage access for authenticated users
DROP POLICY IF EXISTS "Full storage access authenticated" ON storage.objects;
CREATE POLICY "Full storage access authenticated"
  ON storage.objects FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ─── FILE ATTACHMENTS (ensure all columns exist) ───────────────────────────
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS record_type text;
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS record_id uuid;
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS file_size integer;
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS uploaded_by text;
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS public_url text;
