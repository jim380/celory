CREATE TABLE IF NOT EXISTS "group" (
  id SERIAL PRIMARY KEY,
  name TEXT,
  address TEXT UNIQUE,
  is_eligible BOOLEAN,
  commission NUMERIC,
  last_slashed TEXT,
  domain TEXT,
  vote_signer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);