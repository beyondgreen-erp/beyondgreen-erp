-- =====================================================
-- RFQ (Request for Quote) Token System — beyondGREEN ERP
-- External form submission + supplier pricing collection
-- =====================================================

CREATE TABLE IF NOT EXISTS rfq_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_costing_id uuid NOT NULL REFERENCES quote_costing(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  recipient_name text NOT NULL, -- 'Ameer' or 'Veejay'
  recipient_email text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  is_expired boolean DEFAULT false,
  last_accessed_at timestamptz,
  access_count integer DEFAULT 0,
  created_by text,
  notes text
);

-- Submissions track each time pricing is submitted via external form
CREATE TABLE IF NOT EXISTS rfq_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rfq_token_id uuid NOT NULL REFERENCES rfq_tokens(id) ON DELETE CASCADE,
  quote_costing_id uuid NOT NULL REFERENCES quote_costing(id) ON DELETE CASCADE,
  recipient_name text NOT NULL, -- who submitted
  submitted_at timestamptz DEFAULT now(),
  submission_data jsonb, -- full submission payload for audit
  notes text
);

-- RFQ status tracking on quote_costing
ALTER TABLE quote_costing ADD COLUMN IF NOT EXISTS rfq_status text DEFAULT 'Not Sent';
ALTER TABLE quote_costing ADD COLUMN IF NOT EXISTS rfq_recipient_ameer_status text DEFAULT 'Pending';
ALTER TABLE quote_costing ADD COLUMN IF NOT EXISTS rfq_recipient_veejay_status text DEFAULT 'Pending';
ALTER TABLE quote_costing ADD COLUMN IF NOT EXISTS rfq_recipient_ameer_submitted_at timestamptz;
ALTER TABLE quote_costing ADD COLUMN IF NOT EXISTS rfq_recipient_veejay_submitted_at timestamptz;

-- Track which line items were submitted by which recipient
ALTER TABLE quote_costing_lines ADD COLUMN IF NOT EXISTS rfq_pricing_source text;
ALTER TABLE quote_costing_lines ADD COLUMN IF NOT EXISTS rfq_submitted_at timestamptz;
ALTER TABLE quote_costing_lines ADD COLUMN IF NOT EXISTS rfq_submission_id uuid REFERENCES rfq_submissions(id) ON DELETE SET NULL;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_rfq_tokens_quote ON rfq_tokens(quote_costing_id);
CREATE INDEX IF NOT EXISTS idx_rfq_tokens_token ON rfq_tokens(token);
CREATE INDEX IF NOT EXISTS idx_rfq_tokens_expires ON rfq_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_rfq_submissions_token ON rfq_submissions(rfq_token_id);
CREATE INDEX IF NOT EXISTS idx_rfq_submissions_quote ON rfq_submissions(quote_costing_id);

-- Disable RLS for tokens and submissions (need to be accessible via public token)
ALTER TABLE rfq_tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_submissions DISABLE ROW LEVEL SECURITY;

-- Add to realtime publication
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE rfq_tokens;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE rfq_submissions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Function to update quote RFQ status based on submissions
CREATE OR REPLACE FUNCTION update_quote_rfq_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE quote_costing
  SET rfq_status = (
    CASE
      WHEN rfq_recipient_ameer_submitted_at IS NOT NULL AND rfq_recipient_veejay_submitted_at IS NOT NULL THEN 'Complete'
      WHEN rfq_recipient_ameer_submitted_at IS NOT NULL OR rfq_recipient_veejay_submitted_at IS NOT NULL THEN 'Partial'
      ELSE 'Pending'
    END
  ),
  updated_at = now()
  WHERE id = NEW.quote_costing_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rfq_submission_status_trigger ON rfq_submissions;
CREATE TRIGGER rfq_submission_status_trigger
  AFTER INSERT ON rfq_submissions
  FOR EACH ROW EXECUTE FUNCTION update_quote_rfq_status();
