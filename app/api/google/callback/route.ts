import { auth } from "@clerk/nextjs/server"
import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { db, googleConnections } from "@/db"
import { encryptGoogleToken, getAppUrl, getGoogleOAuthConfig } from "@/lib/google-auth"

export async function GET(request: NextRequest) {
  const { userId } = await auth()
  const state = request.nextUrl.searchParams.get("state")
  const cookieState = request.cookies.get("google_oauth_state")?.value
  const stateUserId = state?.split(".")[0]
  const baseUrl = getAppUrl(request.nextUrl.origin)
  const redirectToAgents = (result: string, reason?: string) => {
    const target = new URL(`${baseUrl}/dashboard/integrations`)
    target.searchParams.set("google", result)
    if (reason) target.searchParams.set("google_reason", reason)
    const response = NextResponse.redirect(target)
    response.cookies.set("google_oauth_state", "", {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/api/google/callback",
      maxAge: 0,
    })
    return response
  }

  if (!userId || !state || state !== cookieState || stateUserId !== userId) {
    return redirectToAgents("connection_failed", "invalid_state")
  }
  const oauthError = request.nextUrl.searchParams.get("error")
  if (oauthError) return redirectToAgents("connection_failed", oauthError === "access_denied" ? "access_denied" : "google_oauth_error")

  const code = request.nextUrl.searchParams.get("code")
  if (!code) return redirectToAgents("connection_failed", "missing_code")

  try {
    const { clientId, clientSecret } = getGoogleOAuthConfig()
    const redirectUri = `${baseUrl}/api/google/callback`
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    })
    const tokenData = await tokenResponse.json()
    if (!tokenResponse.ok || typeof tokenData.access_token !== "string") {
      const tokenError = tokenData.error === "redirect_uri_mismatch" ? "redirect_uri_mismatch" : "token_exchange_failed"
      console.error("Google token exchange failed:", tokenError)
      return redirectToAgents("connection_failed", tokenError)
    }

    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
    })
    const profile = await profileResponse.json()
    if (!profileResponse.ok || typeof profile.email !== "string") {
      console.error("Google account email lookup failed with status:", profileResponse.status)
      return redirectToAgents("connection_failed", "email_scope")
    }

    let refreshToken = tokenData.refresh_token as string | undefined
    if (!refreshToken) {
      const [existing] = await db.select({ encryptedRefreshToken: googleConnections.encryptedRefreshToken })
        .from(googleConnections)
        .where(eq(googleConnections.clerkUserId, userId))
        .limit(1)
      // Reauthorization may omit a refresh token; retain the already stored one.
      if (existing) {
        await db.update(googleConnections)
          .set({ email: profile.email, updatedAt: new Date() })
          .where(eq(googleConnections.clerkUserId, userId))
        return redirectToAgents("connected")
      }
      return redirectToAgents("connection_failed", "missing_refresh_token")
    }

    await db.insert(googleConnections).values({
      clerkUserId: userId,
      email: profile.email,
      encryptedRefreshToken: encryptGoogleToken(refreshToken),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: googleConnections.clerkUserId,
      set: {
        email: profile.email,
        encryptedRefreshToken: encryptGoogleToken(refreshToken),
        updatedAt: new Date(),
      },
    })
    return redirectToAgents("connected")
  } catch (error) {
    console.error("Google OAuth callback failed:", error)
    return redirectToAgents("connection_failed", "server_error")
  }
}
