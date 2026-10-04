import { auth, currentUser } from "@clerk/nextjs/server"
import { and, desc, eq, inArray } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { agentConfig, agentRun, db } from "@/db"
import { executeAgent, type RunnableAgentConfig } from "@/lib/agent-executor"
import { databaseFailureResponse } from "@/lib/database-errors"

export const maxDuration = 120

export async function POST(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: "Sign in to run an agent." }, { status: 401 })
  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress
  if (!email) return NextResponse.json({ error: "Your account needs a primary email address." }, { status: 400 })

  const body = await request.json().catch(() => null)
  const agentId = body?.agentId
  if (typeof agentId !== "string" || !agentId) {
    return NextResponse.json({ error: "Choose a saved agent to run." }, { status: 400 })
  }

  try {
    const [agent] = await db.select().from(agentConfig)
      .where(and(eq(agentConfig.agentId, agentId), eq(agentConfig.email, email)))
      .limit(1)
    if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 })

    const recentRuns = await db.select({ status: agentRun.status }).from(agentRun)
      .where(and(eq(agentRun.agentId, agentId), inArray(agentRun.status, ["queued", "running"])))
      .orderBy(desc(agentRun.createdAt))
      .limit(1)
    if (recentRuns.length) return NextResponse.json({ error: "This agent is already running." }, { status: 409 })

    const now = new Date()
    const [run] = await db.insert(agentRun).values({
      agentId,
      email,
      scheduledFor: now,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      status: "running",
      queuedAt: now,
      startedAt: now,
    }).returning()

    try {
      const config: RunnableAgentConfig = {
        name: agent.name ?? "AI Agent",
        objective: agent.objective ?? agent.description ?? "Complete the saved agent task.",
        instructions: agent.instructions ?? "",
        tools: agent.tools ?? [],
        outputFormat: agent.outputFormat ?? "Summary",
      }
      const output = await executeAgent(userId, config.objective, config)
      await db.update(agentRun).set({ status: "completed", output, completedAt: new Date() }).where(eq(agentRun.id, run.id))
      return NextResponse.json({ runId: run.id, ...output })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent execution failed."
      await db.update(agentRun).set({ status: "failed", error: message, completedAt: new Date() }).where(eq(agentRun.id, run.id))
      const status = (error as { status?: number }).status
      return NextResponse.json({ error: message, runId: run.id }, { status: typeof status === "number" ? status : 500 })
    }
  } catch (error) {
    return databaseFailureResponse(error, "run this agent")
  }
}
