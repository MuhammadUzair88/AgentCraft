import { NextResponse } from "next/server"

function isConnectionFailure(error: unknown): boolean {
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current)
    const candidate = current as { message?: unknown; cause?: unknown }
    if (typeof candidate.message === "string" && /fetch failed|failed to fetch|connect(?:ion)? timed? ?out|network error/i.test(candidate.message)) {
      return true
    }
    current = candidate.cause
  }
  return false
}

export function databaseFailureResponse(error: unknown, action: string) {
  if (isConnectionFailure(error)) {
    console.error(`Database connection failed while trying to ${action}.`)
    return NextResponse.json(
      { error: "The app could not reach Neon. Check internet access for the running app and confirm DATABASE_URL is set, then retry." },
      { status: 503 },
    )
  }

  console.error(`Database operation failed while trying to ${action}.`)
  return NextResponse.json(
    { error: `Could not ${action}. Check that the database schema is up to date.` },
    { status: 500 },
  )
}
