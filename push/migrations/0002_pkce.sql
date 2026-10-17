-- One-time codes are bound to the browser that started sign-in (PKCE-style):
-- the SHA-256 (hex) of a verifier only that browser knows.
ALTER TABLE codes ADD COLUMN challenge TEXT;
