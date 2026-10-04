import { auth } from "@clerk/nextjs/server"
import { NextRequest, NextResponse } from "next/server"
import { getAppUrl, getGoogleOAuthConfig, getGoogleScopes } from "@/lib/google-auth"

export async function GET(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Sign in to connect Google." }, { status: 401 })

  try {
    const { clientId } = getGoogleOAuthConfig()
    const state = `${userId}.${crypto.randomUUID()}`
    const redirectUri = `${getAppUrl(request.nextUrl.origin)}/api/google/callback`
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "true",
      scope: getGoogleScopes().join(" "),
      state,
    }).toString()

    const response = NextResponse.redirect(authorizationUrl)
    response.cookies.set("google_oauth_state", state, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/api/google/callback",
      maxAge: 600,
    })
    return response
  } catch (error) {
    console.error("Google OAuth setup failed:", error)
    return NextResponse.json({ error: "Google connection is not configured on this server." }, { status: 503 })
  }
}
