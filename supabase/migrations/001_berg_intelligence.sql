-- ============================================================
-- BERG Intelligence: run this once in Supabase SQL Editor
-- ============================================================

-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Long-term memory table
CREATE TABLE IF NOT EXISTS berg_memory (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email    text        NOT NULL,
  memory_type   text        NOT NULL DEFAULT 'conversation',
  content       text        NOT NULL,
  summary       text,
  embedding     vector(1536),
  importance    integer     DEFAULT 1,
  created_at    timestamptz DEFAULT now(),
  accessed_at   timestamptz DEFAULT now()
);

-- 3. Company knowledge base
CREATE TABLE IF NOT EXISTS berg_company_facts (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  category   text        NOT NULL,
  fact       text        NOT NULL,
  source     text,
  embedding  vector(1536),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. Web monitor alerts
CREATE TABLE IF NOT EXISTS berg_alerts (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type text        NOT NULL DEFAULT 'web_mention',
  title      text        NOT NULL,
  summary    text,
  url        text,
  source     text,
  sentiment  text,
  is_read    boolean     DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 5. Vector similarity search — memories
CREATE OR REPLACE FUNCTION match_berg_memories(
  query_embedding  vector(1536),
  match_threshold  float,
  match_count      int,
  user_email_filter text
)
RETURNS TABLE (id uuid, content text, similarity float)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM berg_memory
  WHERE
    user_email = user_email_filter
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 6. Vector similarity search — company facts
CREATE OR REPLACE FUNCTION match_company_facts(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int
)
RETURNS TABLE (id uuid, fact text, similarity float)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    fact,
    1 - (embedding <=> query_embedding) AS similarity
  FROM berg_company_facts
  WHERE
    embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
