CREATE TABLE IF NOT EXISTS "proposer" (
  id SERIAL PRIMARY KEY,
  address TEXT UNIQUE,
  deposit TEXT,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS "votes" (
  id SERIAL PRIMARY KEY,
  total TEXT,
  yes TEXT,
  no TEXT,
  abstain TEXT,
  UNIQUE (total, yes, no, abstain)
);

CREATE TABLE IF NOT EXISTS "dequeue" (
  id SERIAL PRIMARY KEY,
  status TEXT,
  index TEXT,
  address TEXT,
  timestamp TEXT,
  UNIQUE (status, index, address, timestamp)
);

CREATE TABLE IF NOT EXISTS "approval" (
  id SERIAL PRIMARY KEY,
  status TEXT,
  address TEXT,
  timestamp TEXT,
  UNIQUE (status, address, timestamp)
);

CREATE TABLE IF NOT EXISTS "execution" (
  id SERIAL PRIMARY KEY,
  "from" TEXT,
  timestamp TEXT,
  block_number TEXT,
  tx_hash TEXT,
  UNIQUE ("from", timestamp, block_number, tx_hash)
);

CREATE TABLE IF NOT EXISTS "proposal" (
  id SERIAL PRIMARY KEY,
  proposal_id TEXT UNIQUE,
  status TEXT,
  timespan TEXT,
  title TEXT,
  description TEXT,
  proposer_id INTEGER REFERENCES proposer(id),
  votes_id INTEGER REFERENCES votes(id),
  dequeue_id INTEGER REFERENCES dequeue(id),
  approval_id INTEGER REFERENCES approval(id),
  execution_id INTEGER REFERENCES execution(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  upvotes INTEGER DEFAULT 0  -- Add this line
);