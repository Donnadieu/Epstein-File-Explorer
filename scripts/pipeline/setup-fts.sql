-- Full-Text Search setup for document_pages table
-- Run after db:push creates the table. Idempotent.
-- Usage: psql $DATABASE_URL -f scripts/pipeline/setup-fts.sql

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'document_pages' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE document_pages
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dp_search_vector
  ON document_pages USING GIN (search_vector);
