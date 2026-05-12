ALTER TABLE certifications ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE certifications ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
