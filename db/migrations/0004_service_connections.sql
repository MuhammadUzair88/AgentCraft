DO $$
BEGIN
  IF to_regclass('public.social_connections') IS NOT NULL
     AND to_regclass('public.service_connections') IS NULL THEN
    ALTER TABLE public.social_connections RENAME TO service_connections;
  ELSIF to_regclass('public.service_connections') IS NULL THEN
    CREATE TABLE public.service_connections (
      clerk_user_id text NOT NULL,
      provider varchar(40) NOT NULL,
      account_id text NOT NULL,
      account_name text NOT NULL,
      encrypted_access_token text NOT NULL,
      encrypted_refresh_token text,
      expires_at timestamp with time zone,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      PRIMARY KEY (clerk_user_id, provider, account_id)
    );
  END IF;
END $$;

DELETE FROM public.service_connections
WHERE provider IN ('facebook', 'instagram', 'x', 'youtube');
