# Connected services setup

The Integrations page supports per-user OAuth connections for Discord, GitHub, Reddit, Slack, Notion, and LinkedIn. Each user authorizes their own account or workspace. Access tokens are encrypted using `GOOGLE_TOKEN_ENCRYPTION_KEY` and are never returned by the status API.

## App-wide setup

1. Apply [`db/migrations/0004_service_connections.sql`](db/migrations/0004_service_connections.sql) to the Neon database in `DATABASE_URL`. It renames the earlier `social_connections` table if you applied migration 0003 and removes any saved Facebook, Instagram, X, or YouTube tokens from that table.
2. Set `NEXT_PUBLIC_APP_URL` to the exact app origin.
3. Add this callback URL to each provider developer app, substituting your deployed origin in production:

   `http://localhost:3000/api/integrations/callback`

4. Add the credentials for the apps you create to `.env` and your deployment environment. Keep client secrets server-side and restart/redeploy after setting them.

## Provider apps

- **Discord:** Create an application and bot in the Discord Developer Portal; set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and server-side `DISCORD_BOT_TOKEN`. Connect installs the bot in a server with **Manage Channels** permission. Enable OAuth2 code grant for the bot. A user must create a server in Discord first, then install the bot into it; Discord bots cannot create servers through the API. Keep the bot token private and server-side.
- **GitHub:** Create an OAuth App; set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. The flow requests `read:user user:email repo workflow`. Agents can create repositories and create, read, update, or delete files through the GitHub API. Reconnect GitHub after changing scopes so the user grants repository access. A nested file path creates its folders as part of the commit; GitHub does not store empty folders.
- **Reddit:** Register a Reddit web app with the callback URL; set `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`. The flow requests `identity read submit`.
- **Slack:** Create a Slack app and set `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`. The flow installs it into a workspace with bot scopes `chat:write`, `channels:read`, and `groups:read`. The bot must be in a channel before it can post there.
- **Notion:** Create a public Notion integration, configure its OAuth redirect URL, and set `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET`. Select the minimum content capabilities the app needs. Users select the workspace and grant page access during authorization.
- **LinkedIn:** Create a LinkedIn developer app; set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`. Enable **Sign In with LinkedIn using OpenID Connect**. The connection flow requests `openid` and `profile`. Posting later requires the separate **Share on LinkedIn** product and `w_member_social` permission.

The OAuth connectors establish account/workspace connections. Agent actions that read, write, or publish through these providers must also be implemented in the agent executor and stay within the granted scopes. OAuth connection alone does not execute an action.
