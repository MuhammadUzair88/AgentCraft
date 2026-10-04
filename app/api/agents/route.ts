import { auth, currentUser } from "@clerk/nextjs/server"
import { desc, eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { agentConfig, agentRun, db, users } from "@/db"
import { databaseFailureResponse } from "@/lib/database-errors"

type AgentConfigInput = {
  name: string
  agentImage?: string
  description: string
  instructions: string
  objective: string
  tools: string[]
  skills: string[]
  schedule: { type: "once" | "recurring"; frequency: string; time: string }
  outputFormat: string
}

async function getUserEmail(userId: string) {
  const user = await currentUser()
  if (user?.id !== userId) return null
  return user.primaryEmailAddress?.emailAddress ?? null
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Sign in to view agents." }, { status: 401 })
  const email = await getUserEmail(userId)
  if (!email) return NextResponse.json({ error: "Your account needs a primary email address." }, { status: 400 })

  try {
    const agents = await db.select().from(agentConfig)
      .where(eq(agentConfig.email, email))
      .orderBy(desc(agentConfig.createdAt))
    const runs = await db.select().from(agentRun)
      .where(eq(agentRun.email, email))
      .orderBy(desc(agentRun.createdAt))
    const latestRunByAgent = new Map<string, typeof runs[number]>()
    for (const run of runs) {
      if (!latestRunByAgent.has(run.agentId)) latestRunByAgent.set(run.agentId, run)
    }
    return NextResponse.json({ agents: agents.map((agent) => ({
      ...agent,
      latestRun: latestRunByAgent.get(agent.agentId) ?? null,
    })) })
  } catch (error) {
    return databaseFailureResponse(error, "load your agents")
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Sign in to save an agent." }, { status: 401 })
  const email = await getUserEmail(userId)
  if (!email) return NextResponse.json({ error: "Your account needs a primary email address." }, { status: 400 })

  const body = await request.json().catch(() => null)
  const config = body?.config as AgentConfigInput | undefined
  if (!config?.name || !config.objective || !Array.isArray(config.tools)) {
    return NextResponse.json({ error: "A valid agent configuration is required." }, { status: 400 })
  }

  try {
    await db.insert(users).values({ name: (await currentUser())?.fullName, email }).onConflictDoNothing({ target: users.email })
    const agentId = randomUUID()
    const [agent] = await db.insert(agentConfig).values({
      email,
      agentId,
      name: config.name,
      agentImage: config.agentImage,
      description: config.description,
      instructions: config.instructions,
      objective: config.objective,
      tools: config.tools,
      skills: config.skills,
      schedule: config.schedule,
      outputFormat: config.outputFormat,
    }).returning()
    return NextResponse.json({ agent }, { status: 201 })
  } catch (error) {
    return databaseFailureResponse(error, "save this agent")
  }
}
