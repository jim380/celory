CREATE TABLE IF NOT EXISTS group_votes (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES "group"(id) ON DELETE CASCADE,
  total TEXT,
  active TEXT,
  pending TEXT,
  receivable TEXT,
  UNIQUE (group_id)
);