CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS google_connections (
  clerk_user_id text PRIMARY KEY,
  email text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS service_connections (
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

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text,
  email text NOT NULL UNIQUE,
  "agentCredits" integer DEFAULT 3,
  "ussageCredits" integer DEFAULT 100,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(100) NOT NULL UNIQUE,
  name varchar(150) NOT NULL,
  description text,
  category varchar(100) NOT NULL,
  type varchar(50) NOT NULL,
  provider varchar(100) NOT NULL,
  icon text,
  status varchar(50) DEFAULT 'active',
  requires_auth boolean DEFAULT false,
  auth_type varchar(50),
  auth_provider varchar(100),
  capabilities jsonb DEFAULT '[]'::jsonb,
  use_cases jsonb DEFAULT '[]'::jsonb,
  permissions jsonb DEFAULT '[]'::jsonb,
  approval_rules jsonb,
  config jsonb,
  risk_level varchar(30) DEFAULT 'low',
  can_read boolean DEFAULT false,
  can_write boolean DEFAULT false,
  can_delete boolean DEFAULT false,
  can_execute boolean DEFAULT true,
  enabled boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

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

INSERT INTO tools (
  id,
  slug,
  name,
  description,
  category,
  type,
  provider,
  icon,
  status,
  requires_auth,
  auth_type,
  auth_provider,
  capabilities,
  use_cases,
  permissions,
  approval_rules,
  config,
  risk_level,
  can_read,
  can_write,
  can_delete,
  can_execute,
  enabled,
  created_at,
  updated_at
) VALUES
  ('77544d71-da9f-44b7-a3b5-b832eb3ed30b', 'discord', 'Discord', 'Manage Discord servers, channels, messages, and members.', 'communication', 'integration', 'Discord', 'https://static.vecteezy.com/system/resources/previews/023/741/147/non_2x/discord-logo-icon-social-media-icon-free-png.png', 'active', true, 'oauth2', 'composio', '["read_messages","send_messages","manage_channels","manage_members"]'::jsonb, '["community_management","notifications","team_communication"]'::jsonb, '["messages:read","messages:write","channels:read","members:read"]'::jsonb, NULL, NULL, 'medium', true, true, false, true, true, '2026-08-27 01:41:24.525', '2026-08-27 01:41:24.525'),
  ('8da2b7fb-d8e9-462c-9eac-60e4456f82eb', 'github', 'GitHub', 'Read repositories, issues and pull requests and perform repository actions.', 'developer', 'mcp', 'GitHub', 'https://ik.imagekit.io/Tubeguruji/logos/github.svg', 'active', true, 'oauth', 'github', '["read_repository","search_code","read_issues","create_issue","read_pull_requests","create_pull_request"]'::jsonb, '["Analyze repositories","Find code","Review issues","Create issues","Work with pull requests"]'::jsonb, '[]'::jsonb, '{"read":false,"merge":true,"delete":true,"create_issue":true,"create_pull_request":true}'::jsonb, NULL, 'high', true, true, true, true, true, '2026-08-27 01:41:24.525', '2026-08-27 01:41:24.525'),
  ('dfcb6f5c-353a-4e38-bcc5-42339a525b4d', 'gmail', 'Gmail', 'Search, read, draft and send Gmail messages.', 'communication', 'mcp', 'Google', 'https://ik.imagekit.io/Tubeguruji/logos/gmail.webp', 'active', true, 'oauth', 'google', '["search_email","read_email","read_threads","create_draft","send_email","manage_labels"]'::jsonb, '["Summarize emails","Find important emails","Draft replies","Send reports","Monitor inbox"]'::jsonb, '[]'::jsonb, '{"read":false,"send":true,"draft":false,"delete":true,"search":false}'::jsonb, NULL, 'high', true, true, false, true, true, '2026-08-27 01:41:24.525', '2026-08-27 01:41:24.525'),
  ('9e3d18cc-fe7b-47cb-83e8-039a301a8496', 'googlecalendar', 'Google Calendar', 'Read calendar events, check availability, create meetings, update events and manage schedules.', 'calendar', 'mcp', 'Google', 'https://images.icon-icons.com/2631/PNG/512/google_calendar_new_logo_icon_159141.png', 'active', true, 'oauth', 'google', '["list_events","read_event","search_events","check_availability","create_event","update_event","delete_event"]'::jsonb, '["View upcoming meetings","Check calendar availability","Create meetings","Schedule follow-ups","Update calendar events","Generate daily schedule summaries"]'::jsonb, '[]'::jsonb, '{"read":false,"create":true,"delete":true,"update":true,"check_availability":false}'::jsonb, NULL, 'high', true, true, true, true, true, '2026-08-27 03:09:38.854', '2026-08-27 03:09:38.854'),
  ('e00086be-bd17-4d2c-8ecb-46880c43a20a', 'googledocs', 'Google Docs', 'Read, create, and edit Google documents.', 'productivity', 'integration', 'Google', 'https://1000logos.net/wp-content/uploads/2020/05/Google-Docs-logo.jpg', 'active', true, 'oauth2', 'composio', '["read_documents","create_documents","edit_documents"]'::jsonb, '["document_creation","content_generation","collaboration"]'::jsonb, '["documents:read","documents:write"]'::jsonb, NULL, NULL, 'medium', true, true, false, true, true, '2026-09-01 01:04:02.895', '2026-09-01 01:04:02.895'),
  ('deb8f2e4-734e-4e6c-b69d-2a83b7ef6c37', 'googlesheets', 'Google Sheets', 'Read, create, and update Google spreadsheets.', 'productivity', 'integration', 'Google', 'https://mailmeteor.com/logos/assets/PNG/Google_Sheets_Logo_512px.png', 'active', true, 'oauth2', 'composio', '["read_spreadsheets","create_spreadsheets","update_cells","append_rows"]'::jsonb, '["data_entry","reporting","workflow_automation","data_analysis"]'::jsonb, '["spreadsheets:read","spreadsheets:write"]'::jsonb, NULL, NULL, 'medium', true, true, false, true, true, '2026-09-01 01:04:02.895', '2026-09-01 01:04:02.895'),
  ('86c21a5c-8057-492f-afe7-f88e97fa8b50', 'linkedin', 'LinkedIn', 'Publish content and interact with LinkedIn professional networks.', 'social-media', 'integration', 'LinkedIn', 'https://cdn-icons-png.flaticon.com/256/124/124011.png', 'active', true, 'oauth2', 'composio', '["read_profile","create_posts","manage_posts","read_engagement"]'::jsonb, '["professional_networking","content_publishing","lead_generation","content_generation"]'::jsonb, '["profile:read","posts:read","posts:write"]'::jsonb, NULL, NULL, 'high', true, true, true, true, true, '2026-09-01 01:04:02.895', '2026-09-01 01:04:02.895'),
  ('b6ef81c9-a85f-4925-ab2b-0c6c743af8e8', 'outlook', 'Microsoft Outlook', 'Read, send, and manage Outlook emails and calendar events.', 'productivity', 'integration', 'Microsoft', 'https://mailmeteor.com/logos/assets/PNG/Microsoft_Office_Outlook_Logo_512px.png', 'active', true, 'oauth2', 'composio', '["read_emails","send_emails","manage_calendar","manage_contacts"]'::jsonb, '["email_automation","calendar_management","meeting_scheduling"]'::jsonb, '["mail:read","mail:write","calendar:read","calendar:write"]'::jsonb, NULL, NULL, 'medium', true, true, true, true, true, '2026-09-01 01:04:02.895', '2026-09-01 01:04:02.895'),
  ('e97545e1-5019-4925-8114-141d3622df90', 'notion', 'Notion', 'Search, read and update pages and databases in Notion.', 'productivity', 'mcp', 'Notion', 'https://ik.imagekit.io/Tubeguruji/logos/notion.webp', 'active', true, 'oauth', 'notion', '["search_pages","read_page","create_page","update_page","query_database","add_database_item"]'::jsonb, '["Save research","Create tasks","Update project databases","Store agent reports","Search workspace knowledge"]'::jsonb, '[]'::jsonb, '{"read":false,"create":true,"delete":true,"update":true}'::jsonb, NULL, 'medium', true, true, true, true, true, '2026-08-27 01:41:24.525', '2026-08-27 01:41:24.525'),
  ('200b2a73-fccf-4e12-a4f8-0de7256f2195', 'reddit', 'Reddit', 'Read Reddit content and create or manage posts and comments.', 'social-media', 'integration', 'Reddit', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSoDaDKCalkepAnvuScMWv-kdWcLOVPolu5zVcKI1S47X2bjpwdRw0s2I44x&s=10', 'active', true, 'oauth2', 'composio', '["read_posts","create_posts","read_comments","create_comments","search_reddit"]'::jsonb, '["social_monitoring","content_publishing","community_engagement","research"]'::jsonb, '["posts:read","posts:write","comments:read","comments:write"]'::jsonb, NULL, NULL, 'high', true, true, true, true, true, '2026-08-27 01:41:24.525', '2026-08-27 01:41:24.525'),
  ('c1a48e71-6823-4a84-af15-ae77d16ffdf4', 'slack', 'Slack', 'Read channels, search messages and send Slack messages.', 'communication', 'mcp', 'Slack', 'https://ik.imagekit.io/Tubeguruji/logos/slack.webp', 'active', true, 'oauth', 'slack', '["search_messages","read_channels","send_message"]'::jsonb, '["Summarize team conversations","Find important messages","Send notifications","Post agent reports"]'::jsonb, '[]'::jsonb, '{"read":false,"send":true}'::jsonb, NULL, 'high', true, true, false, true, true, '2026-08-27 01:41:24.525', '2026-08-27 01:41:24.525')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  type = EXCLUDED.type,
  provider = EXCLUDED.provider,
  icon = EXCLUDED.icon,
  status = EXCLUDED.status,
  requires_auth = EXCLUDED.requires_auth,
  auth_type = EXCLUDED.auth_type,
  auth_provider = EXCLUDED.auth_provider,
  capabilities = EXCLUDED.capabilities,
  use_cases = EXCLUDED.use_cases,
  permissions = EXCLUDED.permissions,
  approval_rules = EXCLUDED.approval_rules,
  config = EXCLUDED.config,
  risk_level = EXCLUDED.risk_level,
  can_read = EXCLUDED.can_read,
  can_write = EXCLUDED.can_write,
  can_delete = EXCLUDED.can_delete,
  can_execute = EXCLUDED.can_execute,
  enabled = EXCLUDED.enabled,
  updated_at = EXCLUDED.updated_at;

-- User bootstrap query.
SELECT * FROM users WHERE email = :email;

INSERT INTO users (name, email)
VALUES (:name, :email)
RETURNING *;

-- Integration/tool listing queries.
SELECT * FROM tools WHERE status = 'active';

SELECT
  slug,
  name,
  description,
  category,
  provider,
  capabilities,
  use_cases
FROM tools;

-- Agent creation flow.
SELECT count(*) AS value
FROM "agentConfig"
WHERE email = :user_email;

INSERT INTO "agentConfig" (
  "agentId",
  email,
  name,
  "agentImage",
  description,
  instructions,
  objective,
  tools,
  skills,
  schedule,
  "outputFormat",
  status
) VALUES (
  :agent_id,
  :user_email,
  :name,
  :agent_image,
  :description,
  :instructions,
  :objective,
  :tools_jsonb,
  :skills_jsonb,
  :schedule_jsonb,
  :output_format,
  COALESCE(:status, 'active')
)
RETURNING *;

INSERT INTO "agentRun" ("agentId", email, scheduled_for, timezone, status)
VALUES (:agent_id, :user_email, :scheduled_for, :timezone, 'scheduled')
ON CONFLICT ("agentId", scheduled_for) DO NOTHING
RETURNING *;

-- Agent update query.
UPDATE "agentConfig"
SET
  name = :name,
  "agentImage" = :agent_image,
  description = :description,
  instructions = :instructions,
  objective = :objective,
  tools = :tools_jsonb,
  skills = :skills_jsonb,
  schedule = :schedule_jsonb,
  "outputFormat" = :output_format,
  status = :status,
  created_at = now()
WHERE "agentId" = :agent_id
RETURNING *;

DELETE FROM "agentRun"
WHERE "agentId" = :agent_id
  AND status = 'scheduled';

-- Agent read/delete queries.
SELECT *
FROM "agentConfig"
WHERE email = :user_email
ORDER BY created_at DESC;

DELETE FROM "agentRun"
WHERE "agentId" = :agent_id;

DELETE FROM "agentConfig"
WHERE "agentId" = :agent_id;

-- Manual run and execution queries.
SELECT *
FROM "agentConfig"
WHERE "agentId" = :agent_id;

SELECT *
FROM "agentRun"
WHERE "agentId" = :agent_id
  AND status IN ('queued', 'running');

UPDATE users
SET "ussageCredits" = "ussageCredits" - 1
WHERE email = :user_email
  AND "ussageCredits" > 0
RETURNING "ussageCredits";

UPDATE users
SET "ussageCredits" = "ussageCredits" + 1
WHERE email = :user_email;

INSERT INTO "agentRun" (
  "agentId",
  email,
  scheduled_for,
  timezone,
  status,
  queued_at
) VALUES (
  :agent_id,
  :user_email,
  now(),
  :timezone,
  'queued',
  now()
)
RETURNING *;

UPDATE "agentRun"
SET status = 'failed',
    error = :error,
    completed_at = now()
WHERE id = :run_id;

-- Inngest scheduled runner queries.
SELECT *
FROM "agentRun"
WHERE status = 'scheduled'
  AND scheduled_for >= :now
  AND scheduled_for <= :next_hour
ORDER BY scheduled_for ASC
LIMIT 100;

UPDATE "agentRun"
SET status = 'queued',
    queued_at = :now
WHERE id = :run_id
  AND status = 'scheduled'
RETURNING *;

SELECT
  r.*,
  a.*
FROM "agentRun" r
INNER JOIN "agentConfig" a ON r."agentId" = a."agentId"
WHERE r.id = :run_id
LIMIT 1;

UPDATE "agentRun"
SET status = 'running',
    started_at = now()
WHERE id = :run_id
  AND status = 'queued'
RETURNING *;

UPDATE "agentRun"
SET status = 'completed',
    output = :output_jsonb,
    completed_at = now()
WHERE id = :run_id;

SELECT id
FROM "agentRun"
WHERE "agentId" = :agent_id
  AND status = 'scheduled'
LIMIT 1;

-- Agent run history query.
SELECT
  r.id,
  r."agentId",
  r.email,
  r.status,
  r.output,
  r.error,
  r.scheduled_for,
  r.completed_at,
  r.created_at,
  a.name,
  a."agentImage",
  a.description AS task
FROM "agentRun" r
LEFT JOIN "agentConfig" a ON r."agentId" = a."agentId"
WHERE r.email = :user_email
ORDER BY r.created_at DESC;

-- Composio session persistence.
UPDATE "agentConfig"
SET "composioSessionId" = :composio_session_id
WHERE "agentId" = :agent_id;
