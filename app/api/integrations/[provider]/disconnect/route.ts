import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { db, serviceConnections } from "@/db"
import { isIntegrationProvider } from "@/lib/integration-oauth"

export async function DELETE(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Sign in to disconnect an account." }, { status: 401 })
  const { provider } = await context.params
  if (!isIntegrationProvider(provider)) return NextResponse.json({ error: "Unsupported provider." }, { status: 400 })
  const accountId = request.nextUrl.searchParams.get("accountId")
  if (!accountId) return NextResponse.json({ error: "Choose an account to disconnect." }, { status: 400 })
  await db.delete(serviceConnections).where(and(
    eq(serviceConnections.clerkUserId, userId),
    eq(serviceConnections.provider, provider),
    eq(serviceConnections.accountId, accountId),
  ))
  return NextResponse.json({ disconnected: true })
}
