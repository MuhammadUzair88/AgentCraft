import { auth } from "@clerk/nextjs/server"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { db, googleConnections } from "@/db"

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ connected: false }, { status: 401 })
  const [connection] = await db.select({ email: googleConnections.email })
    .from(googleConnections)
    .where(eq(googleConnections.clerkUserId, userId))
    .limit(1)
  return NextResponse.json({ connected: Boolean(connection), email: connection?.email ?? null })
}
