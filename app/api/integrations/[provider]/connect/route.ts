import { auth } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"
import { createOAuthState, getIntegrationCredentials, integrationRedirectUri, isIntegrationProvider } from "@/lib/integration-oauth"

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { userId } = await auth()
  const { provider } = await context.params
  const target = new URL("/dashboard/integrations", request.nextUrl.origin)
  if (!userId) {
    target.searchParams.set("integration_error", "Sign in before connecting an account.")
    return NextResponse.redirect(target)
  }
  if (!isIntegrationProvider(provider)) {
    target.searchParams.set("integration_error", "That provider is not supported.")
    return NextResponse.redirect(target)
  }

  try {
    const { clientId } = getIntegrationCredentials(provider)
    const state = createOAuthState()
    const redirectUri = integrationRedirectUri(request.nextUrl.origin)
    let authorizationUrl: URL
    if (provider === "discord") {
      authorizationUrl = new URL("https://discord.com/oauth2/authorize")
      authorizationUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        scope: "bot identify",
        // View Channels (1024), Manage Channels (16), and Send Messages (2048).
        permissions: "3088",
      }).toString()
    } else if (provider === "github") {
      authorizationUrl = new URL("https://github.com/login/oauth/authorize")
      authorizationUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, scope: "read:user user:email repo workflow" }).toString()
    } else if (provider === "reddit") {
      authorizationUrl = new URL("https://www.reddit.com/api/v1/authorize")
      authorizationUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state, duration: "permanent", scope: "identity read submit" }).toString()
    } else if (provider === "slack") {
      authorizationUrl = new URL("https://slack.com/oauth/v2/authorize")
      authorizationUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, scope: "chat:write,channels:read,groups:read" }).toString()
    } else if (provider === "notion") {
      authorizationUrl = new URL("https://api.notion.com/v1/oauth/authorize")
      authorizationUrl.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", owner: "user", state }).toString()
    } else {
      authorizationUrl = new URL("https://www.linkedin.com/oauth/v2/authorization")
      authorizationUrl.search = new URLSearchParams({
        response_type: "code", client_id: clientId, redirect_uri: redirectUri, state,
        scope: "openid profile",
      }).toString()
    }

    const response = NextResponse.redirect(authorizationUrl)
    response.cookies.set("integration_oauth_state", `${provider}|${userId}|${state}`, {
      httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/integrations/callback", maxAge: 600,
    })
    return response
  } catch (error) {
    target.searchParams.set("integration_error", error instanceof Error ? error.message : "This provider is not configured.")
    return NextResponse.redirect(target)
  }
}
