import { randomBytes } from "node:crypto"
import { getAppUrl } from "@/lib/google-auth"

export const INTEGRATION_PROVIDERS = ["discord", "github", "reddit", "slack", "notion", "linkedin"] as const
export type IntegrationProvider = typeof INTEGRATION_PROVIDERS[number]

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return INTEGRATION_PROVIDERS.includes(value as IntegrationProvider)
}

export function integrationRedirectUri(origin: string) {
  return `${getAppUrl(origin)}/api/integrations/callback`
}

export function createOAuthState() {
  return randomBytes(32).toString("base64url")
}

export function getIntegrationCredentials(provider: IntegrationProvider) {
  const credentials: Record<IntegrationProvider, [string | undefined, string | undefined, string]> = {
    discord: [process.env.DISCORD_CLIENT_ID, process.env.DISCORD_CLIENT_SECRET, "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET"],
    github: [process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET, "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"],
    reddit: [process.env.REDDIT_CLIENT_ID, process.env.REDDIT_CLIENT_SECRET, "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET"],
    slack: [process.env.SLACK_CLIENT_ID, process.env.SLACK_CLIENT_SECRET, "SLACK_CLIENT_ID and SLACK_CLIENT_SECRET"],
    notion: [process.env.NOTION_CLIENT_ID, process.env.NOTION_CLIENT_SECRET, "NOTION_CLIENT_ID and NOTION_CLIENT_SECRET"],
    linkedin: [process.env.LINKEDIN_CLIENT_ID, process.env.LINKEDIN_CLIENT_SECRET, "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET"],
  }
  const [clientId, clientSecret, names] = credentials[provider]
  if (!clientId || !clientSecret) throw new Error(`Set ${names}`)
  return { clientId, clientSecret }
}
