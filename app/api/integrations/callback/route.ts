import { auth } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"
import { db, serviceConnections } from "@/db"
import { encryptGoogleToken, getAppUrl } from "@/lib/google-auth"
import { getIntegrationCredentials, integrationRedirectUri, isIntegrationProvider, type IntegrationProvider } from "@/lib/integration-oauth"

type OAuthToken = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  bot_access_token?: string
  guild?: { id?: string; name?: string }
}
type ConnectedAccount = { id: string; name: string; token: string; refreshToken?: string; expiresIn?: number }

async function exchange(url: string, options: RequestInit): Promise<OAuthToken> {
  const response = await fetch(url, { ...options, cache: "no-store" })
  const data = await response.json() as OAuthToken & { error?: string; error_description?: string }
  if (!response.ok || (!data.access_token && !data.bot_access_token)) {
    throw new Error(data.error_description || data.error || "The provider rejected the OAuth token exchange.")
  }
  return data
}

async function saveConnection(userId: string, provider: IntegrationProvider, account: ConnectedAccount) {
  const values = {
    clerkUserId: userId,
    provider,
    accountId: account.id,
    accountName: account.name,
    encryptedAccessToken: encryptGoogleToken(account.token),
    encryptedRefreshToken: account.refreshToken ? encryptGoogleToken(account.refreshToken) : null,
    expiresAt: account.expiresIn ? new Date(Date.now() + account.expiresIn * 1000) : null,
    updatedAt: new Date(),
  }
  await db.insert(serviceConnections).values(values).onConflictDoUpdate({
    target: [serviceConnections.clerkUserId, serviceConnections.provider, serviceConnections.accountId],
    set: {
      accountName: values.accountName,
      encryptedAccessToken: values.encryptedAccessToken,
      encryptedRefreshToken: values.encryptedRefreshToken,
      expiresAt: values.expiresAt,
      updatedAt: values.updatedAt,
    },
  })
}

async function getConnectedAccount(provider: IntegrationProvider, code: string, redirectUri: string, requestGuildId?: string): Promise<ConnectedAccount> {
  const { clientId, clientSecret } = getIntegrationCredentials(provider)
  if (provider === "discord") {
    const token = await exchange("https://discord.com/api/oauth2/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    })
    const guildId = token.guild?.id || requestGuildId
    if (!guildId) throw new Error("Discord did not return the server installation. Retry Connect and select a server where you can add the bot.")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("DISCORD_BOT_TOKEN is missing from the server environment. Add it and restart the app before connecting Discord.")
    const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}`, {
      headers: { authorization: `Bot ${botToken}` }, cache: "no-store",
    })
    const guild = await response.json().catch(() => ({})) as { name?: string; message?: string }
    if (!response.ok) {
      if (response.status === 404) throw new Error("Discord returned Unknown Guild for the selected server. Make sure this bot is installed in that server and DISCORD_BOT_TOKEN belongs to that same bot, then try Connect again.")
      if (response.status === 403) throw new Error("The Discord bot cannot access the selected server. Reinstall it with View Channels permission, then try Connect again.")
      throw new Error(`Discord could not verify the selected server${guild.message ? `: ${guild.message}` : ` (HTTP ${response.status})`}.`)
    }
    return { id: guildId, name: guild.name || token.guild?.name || `Discord server ${guildId}`, token: token.access_token!, refreshToken: token.refresh_token, expiresIn: token.expires_in }
  }
  if (provider === "github") {
    const token = await exchange("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    })
    const response = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }, cache: "no-store" })
    const user = await response.json() as { id?: number; login?: string; name?: string }
    if (!response.ok || !user.id) throw new Error("GitHub did not return an account profile.")
    return { id: String(user.id), name: user.name || user.login || "GitHub account", token: token.access_token!, refreshToken: token.refresh_token, expiresIn: token.expires_in }
  }
  if (provider === "reddit") {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    const token = await exchange("https://www.reddit.com/api/v1/access_token", {
      method: "POST", headers: { authorization: `Basic ${credentials}`, "content-type": "application/x-www-form-urlencoded", "user-agent": "AgentCraft/1.0" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    })
    const response = await fetch("https://oauth.reddit.com/api/v1/me", { headers: { authorization: `Bearer ${token.access_token}`, "user-agent": "AgentCraft/1.0" }, cache: "no-store" })
    const user = await response.json() as { id?: string; name?: string }
    if (!response.ok || !user.id) throw new Error("Reddit did not return an account profile.")
    return { id: user.id, name: user.name ? `u/${user.name}` : "Reddit account", token: token.access_token!, refreshToken: token.refresh_token, expiresIn: token.expires_in }
  }
  if (provider === "slack") {
    const token = await exchange("https://slack.com/api/oauth.v2.access", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    })
    const accessToken = token.access_token || token.bot_access_token!
    const response = await fetch("https://slack.com/api/auth.test", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" })
    const workspace = await response.json() as { ok?: boolean; team_id?: string; team?: string; error?: string }
    if (!response.ok || !workspace.ok || !workspace.team_id) throw new Error(`Slack could not identify the workspace${workspace.error ? `: ${workspace.error}` : "."}`)
    return { id: workspace.team_id, name: workspace.team || "Slack workspace", token: accessToken }
  }
  if (provider === "notion") {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    const token = await exchange("https://api.notion.com/v1/oauth/token", {
      method: "POST", headers: { authorization: `Basic ${credentials}`, "content-type": "application/json", "notion-version": "2022-06-28" },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    })
    const notionData = token as OAuthToken & { workspace_id?: string; workspace_name?: string; bot_id?: string }
    if (!notionData.workspace_id) throw new Error("Notion did not return an authorized workspace.")
    return { id: notionData.workspace_id, name: notionData.workspace_name || "Notion workspace", token: notionData.access_token! }
  }

  const token = await exchange("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
  })
  const response = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${token.access_token}` }, cache: "no-store" })
  const profile = await response.json() as { sub?: string; name?: string; email?: string }
  if (!response.ok || !profile.sub) throw new Error("LinkedIn did not return a profile. Check OpenID Connect access for your app.")
  return { id: profile.sub, name: profile.name || profile.email || "LinkedIn account", token: token.access_token!, refreshToken: token.refresh_token, expiresIn: token.expires_in }
}

export async function GET(request: NextRequest) {
  const { userId } = await auth()
  const state = request.nextUrl.searchParams.get("state")
  const [providerValue, expectedUserId, expectedState] = request.cookies.get("integration_oauth_state")?.value?.split("|") ?? []
  const target = new URL(`${getAppUrl(request.nextUrl.origin)}/dashboard/integrations`)
  const clearCookie = (response: NextResponse) => {
    response.cookies.set("integration_oauth_state", "", { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/integrations/callback", maxAge: 0 })
    return response
  }
  const fail = (message: string) => {
    target.searchParams.set("integration_error", message)
    return clearCookie(NextResponse.redirect(target))
  }
  if (!userId || !state || state !== expectedState || expectedUserId !== userId || !providerValue || !isIntegrationProvider(providerValue)) return fail("The authorization state expired or did not match. Try connecting again.")
  const providerError = request.nextUrl.searchParams.get("error")
  if (providerError) {
    const description = request.nextUrl.searchParams.get("error_description")
    const detail = description ? `: ${description.slice(0, 300)}` : ""
    return fail(`${providerValue} authorization failed (${providerError})${detail}`)
  }
  const code = request.nextUrl.searchParams.get("code")
  if (!code) return fail("The provider did not return an authorization code.")
  try {
    const account = await getConnectedAccount(providerValue, code, integrationRedirectUri(request.nextUrl.origin), request.nextUrl.searchParams.get("guild_id") ?? undefined)
    await saveConnection(userId, providerValue, account)
    target.searchParams.set("integration_connected", providerValue)
    return clearCookie(NextResponse.redirect(target))
  } catch (error) {
    console.error(`${providerValue} OAuth callback failed:`, error instanceof Error ? error.message : "unknown error")
    return fail(error instanceof Error ? error.message : "Could not connect this account.")
  }
}
