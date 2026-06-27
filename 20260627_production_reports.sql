-- ─── PRODUCTION_REPORTS TABLE ────────────────────────────────────────────────
-- Central table for all production reports across channels (Walmart, Chewy, Amazon, etc)
CREATE TABLE IF NOT EXISTS production_reports (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  type            text          NOT NULL,  -- 'walmart' | 'chewy' | 'amazon' etc
  date            date          NOT NULL,
  week_number     integer,      -- auto-calculated from date
  month_number    integer,      -- auto-calculated from date
  year_number     integer,      -- auto-calculated from date
  status          text          DEFAULT 'Draft',  -- Draft, Submitted, Completed, Archived
  data            jsonb,        -- flexible storage for report metadata
  summary_data    jsonb,        -- pre-calculated analytics:
                                -- {
                                --   "total_order_qty": numeric,
                                --   "total_pieces_required": numeric,
                                --   "material_requirements": {"MAT-1": {"qty": numeric, "delta": numeric}, "MAT-2": {...}},
                                --   "packaging_requirements": {"cases": {...}, "packs": {...}, "srp": {...}},
                                --   "total_pallets": numeric,
                                --   "days_to_complete": integer,
                                --   "critical_shortages": [{"sku": text, "item": text, "shortage_qty": numeric}]
                                -- }
  created_by      uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz   DEFAULT now(),
  updated_at      timestamptz   DEFAULT now(),
  submitted_at    timestamptz,  -- when report was submitted
  completed_at    timestamptz,  -- when production completed

  -- Only one report per day per channel
  UNIQUE(type, date)
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_production_reports_type_date
  ON production_reports(type, date DESC);
CREATE INDEX IF NOT EXISTS idx_production_reports_status
  ON production_reports(status);
CREATE INDEX IF NOT EXISTS idx_production_reports_created_by
  ON production_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_production_reports_year_month_week
  ON production_reports(year_number, month_number, week_number);

-- ─── AUTO-CALCULATE PERIOD ON INSERT/UPDATE ──────────────────────────────────
CREATE OR REPLACE FUNCTION set_production_report_period()
RETURNS TRIGGER AS $$
BEGIN
  NEW.week_number := EXTRACT(WEEK FROM NEW.date);
  NEW.month_number := EXTRACT(MONTH FROM NEW.date);
  NEW.year_number := EXTRACT(YEAR FROM NEW.date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS production_report_period_trigger ON production_reports;
CREATE TRIGGER production_report_period_trigger
  BEFORE INSERT OR UPDATE ON production_reports
  FOR EACH ROW EXECUTE FUNCTION set_production_report_period();

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
ALTER TABLE production_reports ENABLE ROW LEVEL SECURITY;

-- Users can view reports they created
DROP POLICY IF EXISTS "users_view_own_reports" ON production_reports;
CREATE POLICY "users_view_own_reports" ON production_reports
  FOR SELECT
  USING (auth.uid() = created_by);

-- Users can insert reports (they become the creator)
DROP POLICY IF EXISTS "users_insert_reports" ON production_reports;
CREATE POLICY "users_insert_reports" ON production_reports
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Users can update their own reports
DROP POLICY IF EXISTS "users_update_own_reports" ON production_reports;
CREATE POLICY "users_update_own_reports" ON production_reports
  FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Users can delete their own Draft reports
DROP POLICY IF EXISTS "users_delete_own_draft_reports" ON production_reports;
CREATE POLICY "users_delete_own_draft_reports" ON production_reports
  FOR DELETE
  USING (auth.uid() = created_by AND status = 'Draft');

-- ─── REALTIME ─────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE production_reports;
