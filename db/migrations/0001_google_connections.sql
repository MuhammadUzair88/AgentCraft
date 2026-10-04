CREATE TABLE IF NOT EXISTS google_connections (
  clerk_user_id text PRIMARY KEY,
  email text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);
