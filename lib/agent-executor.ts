import { Browserbase } from "@browserbasehq/sdk"
import { chromium } from "playwright-core"
import { decryptGoogleToken, getGoogleOAuthConfig } from "@/lib/google-auth"
import { db, googleConnections } from "@/db"
import { eq } from "drizzle-orm"

export type RunnableAgentConfig = {
  name: string
  objective: string
  instructions: string
  tools: string[]
  outputFormat: string
}

type GmailMessage = {
  id: string
  internalDate?: string
  snippet?: string
  payload?: {
    mimeType?: string
    headers?: Array<{ name: string; value: string }>
    body?: { data?: string }
    parts?: GmailMessage["payload"][]
  }
}

type SearchResult = { title: string; link: string; snippet?: string }
type Source = { title: string; url?: string; content: string }
function dateForRequest(task: string, timeZone: string) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone })
  const lower = task.toLowerCase()
  if (/\btomorrow\b/.test(lower)) {
    const [year, month, day] = today.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  }
  if (/\btoday\b/.test(lower)) return today
  const isoDate = task.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
  if (isoDate) return isoDate
  const writtenDate = task.match(/\b(?:on\s+)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i)
  if (writtenDate) {
    const year = Number(writtenDate[3] ?? today.slice(0, 4))
    const parsed = new Date(`${writtenDate[1]} ${writtenDate[2]}, ${year}`)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  }
  return null
}

function localDateTimeToUtc(date: string, hour: number, minute: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number)
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute)
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  })
  const parts = (instant: number) => Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, Number(value)]))
  let instant = wallClockUtc
  for (let attempt = 0; attempt < 2; attempt++) {
    const local = parts(instant)
    const representedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
    instant = wallClockUtc - (representedAsUtc - instant)
  }
  return new Date(instant)
}

function buildDeterministicSummary(config: RunnableAgentConfig, result: Record<string, unknown>, sources: Source[], emailSummaries: Array<{ from: string; date: string; subject: string; body: string }>, meetingUrl: string | null) {
  const lines = [`# ${config.name}`, "", config.objective]
  const searchResults = result.searchResults as SearchResult[] | undefined
  if (searchResults?.length) {
    lines.push("", "## Web results", ...searchResults.map((item) => `- [${item.title}](${item.link})${item.snippet ? ` — ${item.snippet}` : ""}`))
  }
  if (emailSummaries.length) {
    lines.push("", "## Important emails", ...emailSummaries.map((email) => `- **${email.subject}** — ${email.from}${email.date ? ` (${email.date})` : ""}\n  ${email.body.slice(0, 400)}`))
  }
  const createdEvent = result.createdCalendarEvent as { summary?: string; start?: { dateTime?: string }; htmlLink?: string } | undefined
  if (createdEvent) lines.push("", "## Calendar event", `- ${createdEvent.summary ?? "Meeting"}${createdEvent.start?.dateTime ? ` — ${createdEvent.start.dateTime}` : ""}${createdEvent.htmlLink ? ` ([open event](${createdEvent.htmlLink}))` : ""}`)
  const calendarEvents = result.calendarEvents as Array<{ summary?: string; start?: { dateTime?: string; date?: string }; htmlLink?: string }> | undefined
  if (calendarEvents?.length) lines.push("", "## Upcoming calendar events", ...calendarEvents.map((event) => `- ${event.summary ?? "Untitled event"}${event.start?.dateTime || event.start?.date ? ` — ${event.start.dateTime ?? event.start.date}` : ""}${event.htmlLink ? ` ([open event](${event.htmlLink}))` : ""}`))
  if (meetingUrl) lines.push("", `Google Meet: ${meetingUrl}`)
  const pageExtracts = sources.filter((source) => source.url && source.content && source.title !== "Important recent emails")
  if (pageExtracts.length) lines.push("", "## Page extracts", ...pageExtracts.map((source) => `- [${source.title}](${source.url})\n  ${source.content.slice(0, 1200)}`))
  if (!searchResults?.length && !emailSummaries.length && !createdEvent && !calendarEvents?.length && !meetingUrl) {
    const otherSources = (result.sourceCount as number) ?? 0
    lines.push("", otherSources ? `Collected ${otherSources} source(s).` : "The configured tools returned no results.")
  }
  return lines.join("\n")
}

function requestsCalendarWrite(text: string) {
  return /\b(schedule|create|book|add|set up|organize)\b[\s\S]{0,60}\b(meeting|event|appointment|call)\b|\b(meeting|event|appointment|call)\b[\s\S]{0,60}\b(schedule|create|book|add|set up|organize)\b/i.test(text)
}

async function createCalendarEvent(accessToken: string, task: string, createMeet: boolean) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  const title = task.match(/\b(?:titled|called|named)\s+["']([^"']+)["']/i)?.[1]
    ?? task.match(/\b(?:titled|called|named)\s+([^,.\n]+)/i)?.[1]?.trim()
  const time = task.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i)
    ?? task.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i)
  const duration = task.match(/\b(?:duration\s+of|for)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i)
    ?? task.match(/\b(\d+)\s*(minutes?|mins?|hours?|hrs?)\s+long\b/i)
  const date = dateForRequest(task, timeZone)
  if (!title || !time || !duration || !date) {
    throw new Error("Please specify the meeting title, date, start time, and duration before scheduling it.")
  }
  let hour = Number(time[1])
  const minute = Number(time[2] ?? 0)
  const meridiem = time[3]?.toUpperCase()
  if (meridiem) hour = hour % 12 + (meridiem === "PM" ? 12 : 0)
  if (hour > 23 || minute > 59) throw new Error("The meeting start time is invalid. Please provide a valid time.")
  const start = localDateTimeToUtc(date, hour, minute, timeZone)
  const durationMinutes = Number(duration[1]) * (/^(hours?|hrs?)$/i.test(duration[2]) ? 60 : 1)
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) {
    throw new Error("Meeting duration must be between 1 minute and 24 hours.")
  }
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const attendees = [...task.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g)].map(([email]) => ({ email }))
  const event: Record<string, unknown> = {
    summary: title.trim(),
    description: "Scheduled by your AI agent.",
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
  }
  if (attendees.length) event.attendees = attendees
  const query = new URLSearchParams()
  if (createMeet) {
    query.set("conferenceDataVersion", "1")
    event.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    }
  }
  const result = await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`, accessToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  })
  let created = result as {
    id?: string
    summary?: string
    htmlLink?: string
    hangoutLink?: string
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
    start?: unknown
    end?: unknown
  }
  // Google creates conference details asynchronously after inserting the event.
  if (createMeet && created.id) {
    const eventId = created.id
    for (let attempt = 0; attempt < 5 && !created.conferenceData?.entryPoints?.some((point) => point.entryPointType === "video" && point.uri); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 700))
      created = await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, accessToken)
    }
    created.hangoutLink = created.conferenceData?.entryPoints?.find((point) => point.entryPointType === "video")?.uri ?? created.hangoutLink
  }
  return created
}

async function googleFetch(url: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...init?.headers },
    cache: "no-store",
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data.error?.message === "string" ? data.error.message : "Google API request failed"
    throw Object.assign(new Error(message), { status: response.status })
  }
  return data
}

async function getGoogleAccessToken(clerkUserId: string) {
  const [connection] = await db.select().from(googleConnections)
    .where(eq(googleConnections.clerkUserId, clerkUserId))
    .limit(1)
  if (!connection) throw Object.assign(new Error("Connect your Google account before running this agent."), { status: 409 })

  const { clientId, clientSecret } = getGoogleOAuthConfig()
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptGoogleToken(connection.encryptedRefreshToken),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  })
  const tokenData = await tokenResponse.json()
  if (!tokenResponse.ok || typeof tokenData.access_token !== "string") {
    throw Object.assign(new Error("Google authorization expired. Reconnect your Google account."), { status: 401 })
  }
  return tokenData.access_token as string
}

function decodeBody(data?: string) {
  return data ? Buffer.from(data, "base64url").toString("utf8") : ""
}

function getPlainText(payload?: GmailMessage["payload"]): string {
  if (!payload) return ""
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBody(payload.body.data)
  for (const part of payload.parts ?? []) {
    const text = getPlainText(part)
    if (text) return text
  }
  return payload.body?.data ? decodeBody(payload.body.data) : ""
}

function getHeader(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? ""
}

async function searchWeb(query: string): Promise<SearchResult[]> {
  const key = process.env.SERPAPI_API_KEY
  if (!key) throw new Error("SERPAPI_API_KEY is not configured on the server.")
  const url = new URL("https://serpapi.com/search.json")
  url.search = new URLSearchParams({ engine: "google", q: query, api_key: key, num: "5" }).toString()
  const response = await fetch(url, { cache: "no-store" })
  const data = await response.json()
  if (!response.ok || data.error) throw new Error(typeof data.error === "string" ? data.error : "SerpApi search failed.")
  return (data.organic_results ?? []).slice(0, 5).map((item: { title?: string; link?: string; snippet?: string }) => ({
    title: item.title ?? "Search result",
    link: item.link ?? "",
    snippet: item.snippet ?? "",
  })).filter((item: SearchResult) => item.link)
}

async function readWithBrowserbase(urls: string[]) {
  const apiKey = process.env.BROWSERBASE_API_KEY
  const projectId = process.env.BROWSERBASE_PROJECT_ID
  if (!apiKey || !projectId) throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required for browser tasks.")
  if (!urls.length) return [] as Source[]

  const browserbase = new Browserbase({ apiKey })
  // Do not enable Browserbase proxies by default; proxies require a paid plan.
  const session = await browserbase.sessions.create({ projectId })
  const browser = await chromium.connectOverCDP(session.connectUrl)
  try {
    const page = browser.contexts()[0]?.pages()[0] ?? await browser.newPage()
    const output: Source[] = []
    for (const url of urls.slice(0, 3)) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 })
        const title = await page.title()
        const content = await page.locator("body").innerText({ timeout: 10000 })
        output.push({ title: title || url, url, content: content.slice(0, 8000) })
      } catch {
        output.push({ title: url, url, content: "Could not extract page text from this result." })
      }
    }
    return output
  } finally {
    await browser.close()
  }
}

export async function executeAgent(clerkUserId: string, prompt: string, config: RunnableAgentConfig) {
  const knownTools = new Set(["google_search", "serp_search", "browserbase", "gmail", "google_docs", "google_calendar", "google_meet"])
  const unsupported = config.tools.filter((tool) => !knownTools.has(tool))
  if (unsupported.length) throw Object.assign(new Error(`Unsupported agent tools: ${unsupported.join(", ")}`), { status: 501 })

  const googleTools = config.tools.filter((tool) => ["gmail", "google_docs", "google_calendar", "google_meet"].includes(tool))
  const needsGoogle = googleTools.length > 0
  const accessToken = needsGoogle ? await getGoogleAccessToken(clerkUserId) : null
  const sources: Source[] = []
  const result: Record<string, unknown> = {}
  const emailSummaries: Array<{ from: string; date: string; subject: string; body: string }> = []
  let documentUrl: string | null = null
  let meetingUrl: string | null = null
  const taskText = `${prompt}\n${config.instructions}`
  const createMeetForTask = config.tools.includes("google_meet") || /\bmeeting\b/i.test(taskText)

  if (config.tools.includes("google_search") || config.tools.includes("serp_search") || config.tools.includes("browserbase")) {
    const results = await searchWeb(`${config.objective}\n${config.instructions}`)
    result.searchResults = results
    if (config.tools.includes("browserbase")) {
      sources.push(...await readWithBrowserbase(results.map((item) => item.link)))
    } else {
      sources.push(...results.map((item) => ({ title: item.title, url: item.link, content: item.snippet ?? "" })))
    }
  }

  if (config.tools.includes("gmail") && accessToken) {
    const list = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is%3Aimportant%20newer_than%3A7d&maxResults=10", accessToken)
    const ids = (list.messages ?? []).map((message: { id: string }) => message.id).slice(0, 10)
    const messages: GmailMessage[] = await Promise.all(ids.map((id: string) =>
      googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, accessToken),
    ))
    emailSummaries.push(...messages.map((message) => ({
      from: getHeader(message, "from"),
      date: getHeader(message, "date") || (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : ""),
      subject: getHeader(message, "subject") || "(no subject)",
      body: getPlainText(message.payload).slice(0, 4000) || message.snippet || "",
    })))
    result.messageCount = emailSummaries.length
    sources.push({ title: "Important recent emails", content: JSON.stringify(emailSummaries) })
  }

  if (config.tools.includes("google_calendar") && accessToken) {
    if (requestsCalendarWrite(taskText)) {
      const event = await createCalendarEvent(accessToken, taskText, createMeetForTask)
      result.createdCalendarEvent = event
      result.calendarEventUrl = event.htmlLink ?? null
      if (event.hangoutLink) meetingUrl = event.hangoutLink
      if (meetingUrl) result.meetingUrl = meetingUrl
      sources.push({ title: "Calendar event created", url: event.htmlLink, content: JSON.stringify({ title: event.summary, start: event.start, end: event.end, meetingUrl: event.hangoutLink }) })
    } else {
    const now = new Date()
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const calendarUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events")
    calendarUrl.search = new URLSearchParams({
      timeMin: now.toISOString(), timeMax: nextWeek.toISOString(), maxResults: "20", singleEvents: "true", orderBy: "startTime",
    }).toString()
    const calendar = await googleFetch(calendarUrl.toString(), accessToken)
    result.calendarEvents = calendar.items ?? []
    sources.push({ title: "Upcoming calendar events", content: JSON.stringify((calendar.items ?? []).map((event: { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; htmlLink?: string }) => ({
      title: event.summary, start: event.start, end: event.end, link: event.htmlLink,
    }))) })
    }
  }

  if (config.tools.includes("google_meet") && accessToken && !meetingUrl) {
    const meet = await googleFetch("https://meet.googleapis.com/v2/spaces", accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    meetingUrl = typeof meet.meetingUri === "string" ? meet.meetingUri : null
    result.meetingUrl = meetingUrl
  }

  result.sourceCount = sources.length
  const summary = buildDeterministicSummary(config, result, sources, emailSummaries, meetingUrl)
  result.summary = summary

  if (config.tools.includes("google_docs") && accessToken) {
    const title = config.name || "Agent Results"
    const document = await googleFetch("https://docs.googleapis.com/v1/documents", accessToken, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }),
    })
    const documentId = document.documentId as string | undefined
    if (!documentId) throw new Error("Google Docs did not return a document ID")
    const bodyText = `${title}\n\n${summary}${meetingUrl ? `\n\nGoogle Meet: ${meetingUrl}` : ""}`
    await googleFetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, accessToken, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: bodyText } }] }),
    })
    documentUrl = `https://docs.google.com/document/d/${documentId}/edit`
    result.documentUrl = documentUrl
  }

  return { ...result, status: "completed", sourceCount: sources.length }
}
