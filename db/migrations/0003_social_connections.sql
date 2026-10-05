CREATE TABLE IF NOT EXISTS "social_connections" (
  "clerk_user_id" text NOT NULL,
  "provider" varchar(40) NOT NULL,
  "account_id" text NOT NULL,
  "account_name" text NOT NULL,
  "encrypted_access_token" text NOT NULL,
  "encrypted_refresh_token" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("clerk_user_id", "provider", "account_id")
);
