-- GitHub login and progress sync. Users are keyed by their GitHub numeric id.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  name TEXT,
  avatar TEXT,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- Only SHA-256 (hex) of tokens and codes is stored, so a DB leak does not leak sessions.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One-time codes handed to the page in the URL fragment, swapped for a session token.
CREATE TABLE codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE data (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
