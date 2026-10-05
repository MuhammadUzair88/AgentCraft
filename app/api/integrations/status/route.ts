import { auth } from "@clerk/nextjs/server"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db, serviceConnections } from "@/db"

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ accounts: [] }, { status: 401 })
  const accounts = await db.select({ provider: serviceConnections.provider, accountId: serviceConnections.accountId, name: serviceConnections.accountName })
    .from(serviceConnections).where(eq(serviceConnections.clerkUserId, userId))
  return NextResponse.json({ accounts })
}
