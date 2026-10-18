-- Security hardening: indexes for the cron's cleanup DELETEs (sessions past their idle or
-- absolute lifetime, accounts idle for 24 months) and counters for the subscription caps.
CREATE INDEX IF NOT EXISTS sessions_last_used ON sessions(last_used);
CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created);
CREATE INDEX IF NOT EXISTS users_last_seen ON users(last_seen);

-- name = 'subs': number of push subscriptions in KV (exact after each cron run).
CREATE TABLE IF NOT EXISTS stats (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- New subscriptions per IP per UTC day. ip_hash = SHA-256 of day|secret|IP; rows from
-- previous days are deleted by the cron.
CREATE TABLE IF NOT EXISTS sub_quota (
  ip_hash TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  count INTEGER NOT NULL
);
