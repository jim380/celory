CREATE TABLE IF NOT EXISTS validator (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES "group"(id) ON DELETE CASCADE,
  address TEXT UNIQUE,
  vote_signer TEXT,
  elected BOOLEAN,
  score TEXT
);