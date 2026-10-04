CREATE TABLE IF NOT EXISTS "agentConfig" (
  id serial PRIMARY KEY,
  email text REFERENCES users(email),
  "agentId" varchar NOT NULL UNIQUE,
  name varchar,
  "agentImage" varchar,
  description text,
  instructions text,
  objective text,
  tools jsonb,
  skills jsonb,
  schedule jsonb,
  "outputFormat" text,
  status varchar DEFAULT 'active',
  "composioSessionId" varchar,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "agentRun" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agentId" varchar NOT NULL REFERENCES "agentConfig"("agentId"),
  email text NOT NULL,
  scheduled_for timestamp with time zone NOT NULL,
  timezone varchar(100) NOT NULL,
  status varchar DEFAULT 'scheduled' NOT NULL,
  output jsonb,
  error text,
  queued_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_agent_occurrence
  ON "agentRun" ("agentId", scheduled_for);
CREATE INDEX IF NOT EXISTS agent_run_schedule_lookup
  ON "agentRun" (status, scheduled_for);
