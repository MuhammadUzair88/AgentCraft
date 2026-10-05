import { Browserbase } from "@browserbasehq/sdk"
import { chromium } from "playwright-core"
import { decryptGoogleToken, getGoogleOAuthConfig } from "@/lib/google-auth"
import { db, googleConnections, serviceConnections } from "@/db"
import { and, eq } from "drizzle-orm"

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
  const discordChannel = result.discordChannel as { server: string; channel: string; url: string } | undefined
  if (discordChannel) lines.push("", "## Discord channel", `Created #${discordChannel.channel} in ${discordChannel.server} ([open channel](${discordChannel.url})).`)
  const githubRepository = result.githubRepository as { fullName: string; url: string; private: boolean } | undefined
  if (githubRepository) lines.push("", "## GitHub repository", `Created ${githubRepository.private ? "private" : "public"} repository [${githubRepository.fullName}](${githubRepository.url}).`)
  const githubFileAction = result.githubFileAction as { action: string; repository: string; path: string; url?: string; content?: string } | undefined
  if (githubFileAction) lines.push("", "## GitHub file action", `${githubFileAction.action} ${githubFileAction.path} in ${githubFileAction.repository}${githubFileAction.url ? ` ([open file](${githubFileAction.url}))` : ""}.${githubFileAction.content ? `\n\n${githubFileAction.content.slice(0, 5000)}` : ""}`)
  if (meetingUrl) lines.push("", `Google Meet: ${meetingUrl}`)
  const pageExtracts = sources.filter((source) => source.url && source.content && source.title !== "Important recent emails")
  if (pageExtracts.length) lines.push("", "## Page extracts", ...pageExtracts.map((source) => `- [${source.title}](${source.url})\n  ${source.content.slice(0, 1200)}`))
  if (!searchResults?.length && !emailSummaries.length && !createdEvent && !calendarEvents?.length && !meetingUrl && !discordChannel && !githubRepository && !githubFileAction) {
    const otherSources = (result.sourceCount as number) ?? 0
    lines.push("", otherSources ? `Collected ${otherSources} source(s).` : "The configured tools returned no results.")
  }
  return lines.join("\n")
}

function requestsCalendarWrite(text: string) {
  return /\b(schedule|create|book|add|set up|organize)\b[\s\S]{0,60}\b(meeting|event|appointment|call)\b|\b(meeting|event|appointment|call)\b[\s\S]{0,60}\b(schedule|create|book|add|set up|organize)\b/i.test(text)
}

async function createCalendarEvent(accessToken: string, task: string, createMeet: boolean, defaultTitle: string) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  const title = task.match(/\b(?:titled|called|named)\s+["']([^"']+)["']/i)?.[1]
    ?? task.match(/\b(?:titled|called|named)\s+([^,.\n]+)/i)?.[1]?.trim()
  const time = task.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i)
    ?? task.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i)
  const duration = task.match(/\b(?:duration\s+of|for)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i)
    ?? task.match(/\b(\d+)\s*(minutes?|mins?|hours?|hrs?)\s+long\b/i)
  const date = dateForRequest(task, timeZone)
  if (!time || !date) {
    throw new Error("Please specify the meeting date and start time before scheduling it.")
  }
  let hour = Number(time[1])
  const minute = Number(time[2] ?? 0)
  const meridiem = time[3]?.toUpperCase()
  if (meridiem) hour = hour % 12 + (meridiem === "PM" ? 12 : 0)
  if (hour > 23 || minute > 59) throw new Error("The meeting start time is invalid. Please provide a valid time.")
  const start = localDateTimeToUtc(date, hour, minute, timeZone)
  // Title and duration are optional details. Use sensible defaults so they do
  // not prevent the rest of a multi-step agent (such as a Doc write) from running.
  const durationMinutes = duration
    ? Number(duration[1]) * (/^(hours?|hrs?)$/i.test(duration[2]) ? 60 : 1)
    : 30
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) {
    throw new Error("Meeting duration must be between 1 minute and 24 hours.")
  }
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const attendees = [...task.matchAll(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g)].map(([email]) => ({ email }))
  const event: Record<string, unknown> = {
    summary: (title || defaultTitle || "Scheduled meeting").trim(),
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
    const parsedUrl = new URL(url)
    const hostService = parsedUrl.hostname.replace(".googleapis.com", "")
    const service = hostService === "www" && parsedUrl.pathname.startsWith("/calendar/")
      ? "Google Calendar"
      : `Google ${hostService.charAt(0).toUpperCase()}${hostService.slice(1)}`
    const message = typeof data.error?.message === "string" ? data.error.message : "Google API request failed"
    const reason = data.error?.errors?.find((item: { reason?: string }) => item.reason)?.reason
    const details = reason ? ` (${reason})` : ""
    const permissionHelp = response.status === 403
      ? service === "Google Docs"
        ? " Enable the Google Docs API in the OAuth client's Google Cloud project, then reconnect Google to grant Docs access. Workspace administrators can also restrict Docs API access."
        : " Check that this API is enabled in the Google Cloud project, reconnect Google to grant its requested permissions, and confirm your Google account or Workspace allows this action."
      : ""
    throw Object.assign(new Error(`${service} API: ${message}${details}.${permissionHelp}`), { status: response.status })
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

function getDiscordChannelTask(task: string) {
  if (!/\b(?:create|make|add|set\s+up|setup)\b[\s\S]{0,80}\bchannel\b/i.test(task)) return null
  const quotedChannel = task.match(/\bchannel\s+(?:named|called)\s+["'“]([^"'”]+)["'”]/i)?.[1]
  const channelNamed = task.match(/\bchannel\s+(?:named|called)\s+([A-Za-z0-9_-]{1,100})\b/i)?.[1]
  const beforeChannel = task.match(/\b([A-Za-z0-9][A-Za-z0-9 _-]{0,80})\s+channel\b/i)?.[1]
  const channelName = (quotedChannel || channelNamed || beforeChannel)?.trim()
  if (!channelName) throw new Error("Specify the Discord channel name, for example: create a channel named 'announcements'.")
  const serverName = task.match(/\b(?:server|guild)\s+(?:named|called)\s+["'“]([^"'”]+)["'”]/i)?.[1]
    ?? task.match(/\b([A-Za-z0-9][A-Za-z0-9 _-]{0,80})\s+(?:Discord\s+)?server\b/i)?.[1]
  return { channelName, serverName: serverName?.trim() }
}

async function createDiscordChannel(clerkUserId: string, task: string) {
  const request = getDiscordChannelTask(task)
  if (!request) return null
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) throw new Error("Discord channel actions need DISCORD_BOT_TOKEN in the server environment. Add the Discord bot token and restart the app.")

  const connections = await db.select({ accountId: serviceConnections.accountId, accountName: serviceConnections.accountName })
    .from(serviceConnections).where(and(eq(serviceConnections.clerkUserId, clerkUserId), eq(serviceConnections.provider, "discord")))
  const [selectedGuild] = request.serverName
    ? connections.filter((connection) => connection.accountName.toLocaleLowerCase() === request.serverName!.toLocaleLowerCase())
    : connections.length === 1 ? connections : []
  if (!selectedGuild) {
    if (!request.serverName && connections.length > 1) throw new Error("More than one Discord server is connected. Include the exact server name in the agent task.")
    if (!connections.length) throw new Error("No Discord server is connected to this account. Create the server in Discord first, then use Integrations → Discord → Connect to install the bot into it.")
    const available = connections.map((connection) => connection.accountName).join(", ")
    throw new Error(`The requested Discord server is not connected${available ? `. Connected servers: ${available}` : ""}. Install the bot in that server from Integrations first.`)
  }

  const channelName = request.channelName.toLocaleLowerCase().replace(/\s+/g, "-")
  if (channelName.length > 100 || !/^[a-z0-9_-]+$/.test(channelName)) {
    throw new Error("Discord text channel names must use letters, numbers, hyphens, or underscores and be at most 100 characters.")
  }
  const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(selectedGuild.accountId)}/channels`, {
    method: "POST",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: channelName, type: 0 }),
    cache: "no-store",
  })
  const data = await response.json().catch(() => ({})) as { id?: string; name?: string; message?: string; code?: number }
  if (!response.ok || !data.id) {
    if (response.status === 403) throw new Error("Discord denied channel creation. Make sure the AgentCraft bot is installed in this server and has Manage Channels permission.")
    throw new Error(`Discord could not create the channel${data.message ? `: ${data.message}` : ` (HTTP ${response.status})`}.`)
  }
  return { server: selectedGuild.accountName, channel: data.name || channelName, url: `https://discord.com/channels/${selectedGuild.accountId}/${data.id}` }
}

function getDiscordPublishTarget(task: string) {
  if (!/\b(?:share|send|post|publish|deliver)\b/i.test(task) || !/\b(?:discord|channel)\b/i.test(task)) return null
  const channelName = task.match(/#([A-Za-z0-9_-]{1,100})\s+channel\b/i)?.[1]
    ?? task.match(/\b(?:in|to|into)\s+(?:the\s+)?#?([A-Za-z0-9_-]{1,100})\s+channel\b/i)?.[1]
    ?? task.match(/\bchannel\s+(?:named|called)\s+["'“]?([A-Za-z0-9_-]{1,100})/i)?.[1]
  if (!channelName) throw new Error("Specify the Discord channel name where the document should be shared.")
  const serverName = task.match(/\bin\s+([A-Za-z0-9][A-Za-z0-9 _-]{0,80})['’]s\s+server\b/i)?.[1]?.trim()
    ?? task.match(/\bon\s+([A-Za-z0-9][A-Za-z0-9 _-]{0,80})['’]s\s+Discord\s+server\b/i)?.[1]?.trim()
    ?? task.match(/\b(?:server|guild)\s+(?:named|called)\s+["'“]?([^"'”\n,.]+)["'”]?/i)?.[1]?.trim()
  return { channelName, serverName }
}
async function publishDiscordDocument(clerkUserId: string, target: { channelName: string; serverName?: string }, documentUrl: string) {
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) throw new Error("Discord publishing needs DISCORD_BOT_TOKEN in the server environment. Add it and restart the app.")
  const connections = await db.select({ accountId: serviceConnections.accountId, accountName: serviceConnections.accountName })
    .from(serviceConnections).where(and(eq(serviceConnections.clerkUserId, clerkUserId), eq(serviceConnections.provider, "discord")))
  const serverQuery = target.serverName?.toLocaleLowerCase()
  const matches = serverQuery
    ? connections.filter((guild) => guild.accountName.toLocaleLowerCase() === serverQuery || guild.accountName.toLocaleLowerCase().includes(serverQuery))
    : connections
  if (matches.length !== 1) {
    if (!connections.length) throw new Error("No Discord server is connected. Connect Discord and install the AgentCraft bot in the target server.")
    if (!matches.length) throw new Error(`The Discord server “${target.serverName}” is not connected. Connected servers: ${connections.map((guild) => guild.accountName).join(", ")}.`)
    throw new Error("More than one connected Discord server matches this request. Include the exact server name.")
  }
  const guild = matches[0]
  const api = `https://discord.com/api/v10`
  const headers = { authorization: `Bot ${botToken}`, "content-type": "application/json" }
  const channelListResponse = await fetch(`${api}/guilds/${encodeURIComponent(guild.accountId)}/channels`, { headers, cache: "no-store" })
  const channelList = await channelListResponse.json().catch(() => ({})) as Array<{ id?: string; name?: string }> & { message?: string }
  if (!channelListResponse.ok || !Array.isArray(channelList)) {
    if (channelListResponse.status === 404) throw new Error("Discord returned Unknown Guild for this saved connection. Disconnect the stale Discord connection, make sure DISCORD_BOT_TOKEN belongs to the bot installed in Muhammad Uzair's server, then reconnect Discord.")
    if (channelListResponse.status === 403) throw new Error("Discord denied access to the server channels. Reconnect Discord and grant Manage Channels and View Channels permissions.")
    throw new Error(`Discord could not list server channels${channelList.message ? `: ${channelList.message}` : ` (HTTP ${channelListResponse.status})`}.`)
  }
  const normalizedName = target.channelName.toLocaleLowerCase().replace(/\s+/g, "-")
  let channel: { id?: string; name?: string; message?: string } | undefined = channelList.find((item) => item.name?.toLocaleLowerCase() === normalizedName)
  if (!channel?.id) {
    const createResponse = await fetch(`${api}/guilds/${encodeURIComponent(guild.accountId)}/channels`, {
      method: "POST", headers, body: JSON.stringify({ name: normalizedName, type: 0 }), cache: "no-store",
    })
    channel = await createResponse.json().catch(() => ({})) as { id?: string; name?: string; message?: string }
    if (!createResponse.ok || !channel.id) {
      if (createResponse.status === 403) throw new Error("Discord denied channel creation. Reconnect Discord and grant Manage Channels permission.")
      throw new Error(`Discord could not create #${normalizedName}${channel.message ? `: ${channel.message}` : ` (HTTP ${createResponse.status})`}.`)
    }
  }
  const messageResponse = await fetch(`${api}/channels/${encodeURIComponent(channel.id)}/messages`, {
    method: "POST", headers, body: JSON.stringify({ content: `The requested document is ready: ${documentUrl}` }), cache: "no-store",
  })
  const message = await messageResponse.json().catch(() => ({})) as { id?: string; message?: string }
  if (!messageResponse.ok || !message.id) {
    if (messageResponse.status === 403) throw new Error(`Discord denied posting in #${channel.name ?? normalizedName}. Grant the bot View Channel and Send Messages permissions, then reconnect it.`)
    throw new Error(`Discord could not post the document link${message.message ? `: ${message.message}` : ` (HTTP ${messageResponse.status})`}.`)
  }
  return { server: guild.accountName, channel: channel.name ?? normalizedName, url: `https://discord.com/channels/${guild.accountId}/${channel.id}/${message.id}` }
}

function getGitHubRepositoryRequest(task: string) {
  if (!/\b(?:create|make|set\s+up)\s+(?:a\s+)?(?:(?:private|public)\s+)?(?:github\s+)?(?:repository|repo)\b/i.test(task)) return null
  const name = task.match(/\b(?:repository|repo)\s+(?:named|called)\s+["'“]?([A-Za-z0-9_.-]{1,100})/i)?.[1]
    ?? task.match(/\bcreate\s+(?:a\s+)?(?:private\s+|public\s+)?(?:github\s+)?(?:repository|repo)\s+["'“]?([A-Za-z0-9_.-]{1,100})/i)?.[1]
  if (!name) throw new Error("Specify the GitHub repository name, for example: create a private repository named 'AgenticAI'.")
  return { name, private: /\bprivate\b/i.test(task) }
}

async function createGitHubRepository(clerkUserId: string, request: { name: string; private: boolean }, initializeForFiles = false) {
  const [connection, ...otherConnections] = await db.select({
    accountId: serviceConnections.accountId,
    accountName: serviceConnections.accountName,
    encryptedAccessToken: serviceConnections.encryptedAccessToken,
  }).from(serviceConnections).where(and(
    eq(serviceConnections.clerkUserId, clerkUserId),
    eq(serviceConnections.provider, "github"),
  ))
  if (!connection) throw Object.assign(new Error("Connect your GitHub account before creating a repository."), { status: 409 })
  if (otherConnections.length) throw new Error("More than one GitHub account is connected. Disconnect the accounts you don't want this agent to use, then retry.")
  const response = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      authorization: `Bearer ${decryptGoogleToken(connection.encryptedAccessToken)}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ name: request.name, private: request.private, ...(initializeForFiles ? { auto_init: true } : {}) }),
    cache: "no-store",
  })
  const data = await response.json().catch(() => ({})) as { id?: number; name?: string; full_name?: string; html_url?: string; private?: boolean; message?: string }
  if (!response.ok || !data.id || !data.html_url) {
    if (response.status === 401) throw new Error("GitHub authorization expired. Reconnect GitHub and try again.")
    if (response.status === 403) throw new Error("GitHub denied repository creation. Reconnect GitHub and approve the repo permission; also check whether your account or organization allows private repository creation.")
    if (response.status === 422) throw new Error(data.message || `GitHub could not create '${request.name}'. The repository may already exist or the name may be unavailable.`)
    throw new Error(`GitHub could not create the repository${data.message ? `: ${data.message}` : ` (HTTP ${response.status})`}.`)
  }
  return { name: data.name || request.name, fullName: data.full_name || data.name || request.name, url: data.html_url, private: data.private ?? request.private }
}

async function getGitHubAccess(clerkUserId: string) {
  const [connection, ...otherConnections] = await db.select({
    encryptedAccessToken: serviceConnections.encryptedAccessToken,
  }).from(serviceConnections).where(and(
    eq(serviceConnections.clerkUserId, clerkUserId),
    eq(serviceConnections.provider, "github"),
  ))
  if (!connection) throw Object.assign(new Error("Connect your GitHub account before running this action."), { status: 409 })
  if (otherConnections.length) throw new Error("More than one GitHub account is connected. Disconnect extra accounts before running this agent.")
  return decryptGoogleToken(connection.encryptedAccessToken)
}

async function githubRequest(accessToken: string, path: string, init?: RequestInit) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...init?.headers,
    },
    cache: "no-store",
  })
  const data = await response.json().catch(() => ({})) as Record<string, any>
  return { response, data }
}

function getGitHubFileRequest(task: string, githubToolEnabled = false) {
  if ((!githubToolEnabled && !/\b(?:github|repository|repo)\b/i.test(task)) || !/\b(?:file|files|folder|directory)\b/i.test(task)) return null
  const mode = /\b(?:delete|remove)\b/i.test(task) ? "delete"
    : /\b(?:read|show|view|open)\b/i.test(task) ? "read"
      : /\b(?:update|edit|replace)\b/i.test(task) ? "update"
        : /\b(?:create|add|write)\b/i.test(task) ? "create" : null
  if (!mode) return null
  const path = task.match(/\b(?:file|path)\s+(?:named|called|at)\s+[`"']?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/i)?.[1]
    ?? task.match(/\b(?:at|to)\s+[`"']?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/i)?.[1]
    ?? task.match(/\bfile\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/i)?.[1]
    ?? task.match(/\b(?:create|add|write|read|update|edit|delete|remove)\s+([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)\s+file\b/i)?.[1]
  if (!path) throw new Error("Specify a repository file path, including folders, such as src/index.ts.")
  const repository = task.match(/\b(?:repository|repo)\s+(?:named\s+)?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)/i)?.[1]
    ?? task.match(/\b(?:in|inside|under)\s+(?:the\s+)?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)\s+(?:github\s+)?repository\b/i)?.[1]
    ?? task.match(/\b(?:in|inside|under)\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i)?.[1]
  const codeBlock = task.match(/```(?:[A-Za-z0-9_-]+)?\s*\r?\n([\s\S]*?)```/)?.[1]
  const content = codeBlock ?? task.match(/\bcontent\s*[:=]\s*["']([\s\S]*?)["']/i)?.[1]
    ?? task.match(/\bcontent\s*:\s*([\s\S]+?)(?=\r?\n\s*(?:then|after that|also)\b|$)/i)?.[1]?.trim()
  if ((mode === "create" || mode === "update") && content === undefined) throw new Error("Include the file contents after 'content:' or as a fenced code block.")
  return { mode, path, repository, content }
}

async function runGitHubFileAction(clerkUserId: string, request: NonNullable<ReturnType<typeof getGitHubFileRequest>>, createdRepository?: { fullName: string }) {
  const accessToken = await getGitHubAccess(clerkUserId)
  const who = await githubRequest(accessToken, "/user")
  if (!who.response.ok || typeof who.data.login !== "string") throw new Error(`GitHub could not identify the connected user${who.data.message ? `: ${who.data.message}` : "."}`)
  const repository = request.repository || createdRepository?.fullName
  const fullName = repository?.includes("/") ? repository : `${who.data.login}/${repository ?? ""}`
  const [owner, repo] = fullName.split("/")
  if (!repo) throw new Error("Specify the repository name for this file action.")
  const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${request.path.split("/").map(encodeURIComponent).join("/")}`
  const current = await githubRequest(accessToken, endpoint)
  if (request.mode === "read") {
    if (!current.response.ok) throw new Error(`GitHub could not read '${request.path}'${current.data.message ? `: ${current.data.message}` : ` (HTTP ${current.response.status})`}.`)
    return { action: "read", repository: fullName, path: request.path, content: Buffer.from(current.data.content ?? "", "base64").toString("utf8") }
  }
  if (request.mode === "delete") {
    if (!current.response.ok || typeof current.data.sha !== "string") throw new Error(`GitHub could not find '${request.path}' to delete.`)
    const deleted = await githubRequest(accessToken, endpoint, { method: "DELETE", body: JSON.stringify({ message: `Delete ${request.path}`, sha: current.data.sha }) })
    if (!deleted.response.ok) throw new Error(`GitHub could not delete '${request.path}': ${deleted.data.message || `HTTP ${deleted.response.status}`}.`)
    return { action: "deleted", repository: fullName, path: request.path, url: `https://github.com/${fullName}/blob/HEAD/${request.path}` }
  }
  if (request.mode === "create" && current.response.ok) throw new Error(`'${request.path}' already exists in ${fullName}. Ask to update it instead.`)
  if (request.mode === "update" && (!current.response.ok || typeof current.data.sha !== "string")) throw new Error(`GitHub could not find '${request.path}' to update.`)
  const saved = await githubRequest(accessToken, endpoint, {
    method: "PUT",
    body: JSON.stringify({ message: `${request.mode === "create" ? "Add" : "Update"} ${request.path}`, content: Buffer.from(request.content ?? "", "utf8").toString("base64"), ...(request.mode === "update" ? { sha: current.data.sha } : {}) }),
  })
  if (!saved.response.ok || typeof saved.data.content?.html_url !== "string") throw new Error(`GitHub could not ${request.mode} '${request.path}': ${saved.data.message || `HTTP ${saved.response.status}`}.`)
  return { action: request.mode === "create" ? "created" : "updated", repository: fullName, path: request.path, url: saved.data.content.html_url }
}

function getEmailRequest(task: string) {
  // Sending any artifact (for example, a Doc link to Discord) must not be
  // interpreted as an email action. Only parse this request when email is
  // explicitly named.
  if (!/\b(?:email|e-mail)\b/i.test(task)) return null
  const recipient = task.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]
  const subject = task.match(/\bsubject\s*[:=]?\s*["']([^"']+)["']/i)?.[1]
  const body = task.match(/\bbody\s*[:=]?\s*["']([^"']+)["']/i)?.[1]
  if (!recipient || !subject || !body) {
    throw new Error("To send an email, provide one recipient email address, a quoted subject, and a quoted body in the agent instructions.")
  }
  return { recipient, subject, body }
}

async function sendGmail(accessToken: string, email: { recipient: string; subject: string; body: string }) {
  const raw = [
    `To: ${email.recipient}`,
    `Subject: ${email.subject.replace(/[\r\n]/g, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    email.body,
  ].join("\r\n")
  const sent = await googleFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", accessToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(raw, "utf8").toString("base64url") }),
  })
  return { id: sent.id as string | undefined, recipient: email.recipient, subject: email.subject }
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
  const knownTools = new Set(["google_search", "serp_search", "browserbase", "gmail", "google_docs", "google_calendar", "google_meet", "github", "discord"])
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
  // Existing saved agents may predate Discord being listed as a selectable tool.
  if (config.tools.includes("discord") || (/\bdiscord\b/i.test(taskText) && /\bchannel\b/i.test(taskText))) {
    const discordChannel = await createDiscordChannel(clerkUserId, taskText)
    if (discordChannel) result.discordChannel = discordChannel
  }
  // Honor explicit GitHub repository requests in existing saved agents that
  // were configured before the GitHub tool was added to the picker.
  const githubFileRequest = getGitHubFileRequest(taskText, config.tools.includes("github"))
  const githubRepositoryRequest = getGitHubRepositoryRequest(taskText)
  if (githubRepositoryRequest) result.githubRepository = await createGitHubRepository(clerkUserId, githubRepositoryRequest, Boolean(githubFileRequest))
  if (githubFileRequest) result.githubFileAction = await runGitHubFileAction(clerkUserId, githubFileRequest, result.githubRepository as { fullName: string } | undefined)
  if ((config.tools.includes("github") || /\bgithub\b/i.test(taskText)) && !githubRepositoryRequest && !githubFileRequest) {
    throw new Error("This GitHub agent currently supports creating repositories and creating, reading, updating, or deleting files by path. Include the repo name, file path, and file content when writing a file.")
  }
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

  const emailRequest = getEmailRequest(taskText)
  if (emailRequest && !config.tools.includes("gmail")) {
    throw new Error("This agent does not have the Gmail tool. Add Gmail when configuring the agent, then reconnect Google with Gmail send permission.")
  }
  if (emailRequest && accessToken) result.emailSent = await sendGmail(accessToken, emailRequest)

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
      const event = await createCalendarEvent(accessToken, taskText, createMeetForTask, config.name)
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
    try {
      const meet = await googleFetch("https://meet.googleapis.com/v2/spaces", accessToken, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
      meetingUrl = typeof meet.meetingUri === "string" ? meet.meetingUri : null
      result.meetingUrl = meetingUrl
    } catch (error) {
      // A Meet space is a fallback when Calendar has not returned conference
      // details. Keep already completed search, Docs, and Calendar work usable.
      result.warnings = [error instanceof Error ? error.message : "Google Meet could not create a meeting link."]
    }
  }

  result.sourceCount = sources.length
  const summary = buildDeterministicSummary(config, result, sources, emailSummaries, meetingUrl)
  const sentEmail = result.emailSent as { recipient: string; subject: string } | undefined
  result.summary = sentEmail ? `${summary}\n\n## Email sent\nSent “${sentEmail.subject}” to ${sentEmail.recipient}.` : summary

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

  const discordPublishTarget = getDiscordPublishTarget(taskText)
  if (discordPublishTarget) {
    if (!config.tools.includes("discord")) throw new Error("This agent needs the Discord tool enabled to share its Google Doc.")
    if (!documentUrl) throw new Error("This agent could not create a Google Doc to share. Enable Google Docs and reconnect Google.")
    const discordPost = await publishDiscordDocument(clerkUserId, discordPublishTarget, documentUrl)
    result.discordPost = discordPost
    result.summary = `${result.summary}\n\n## Discord post\nShared the Google Doc in #${discordPost.channel} on ${discordPost.server} ([open message](${discordPost.url})).`
  }

  return { ...result, status: "completed", sourceCount: sources.length }
}
