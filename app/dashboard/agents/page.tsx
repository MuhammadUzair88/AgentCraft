"use client"

import { useEffect, useState, type FormEvent } from "react"
import {
  ArrowUp,
  BriefcaseBusiness,
  Mail,
  Plus,
  Search,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import axios from "axios"

type AgentConfig = {
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

type ConfigureResponse = {
  status: "needs_clarification" | "ready"
  clarificationQuestions: Array<{
    id: string
    question: string
    type: "single_select" | "multi_select" | "text"
    options: string[]
    allowCustom: boolean
    customPlaceholder: string
  }>
  config?: AgentConfig
}

type AgentRunResponse = {
  status?: "completed"
  messageCount?: number
  sourceCount?: number
  summary?: string
  warnings?: string[]
  documentUrl?: string | null
  meetingUrl?: string | null
  calendarEventUrl?: string | null
  runId?: string
  error?: string
  searchResults?: Array<{ title: string; link: string; snippet?: string }>
  calendarEvents?: Array<{ summary?: string; htmlLink?: string }>
}

type SavedAgent = {
  agentId: string
  name: string | null
  description: string | null
  objective: string | null
  tools: string[] | null
  createdAt: string
  latestRun: {
    status: string
    error: string | null
    output: AgentRunResponse | null
    completedAt: string | null
  } | null
}

const suggestions = [
  "Find AI jobs",
  "Inbox Summary",
  "Research Topic",
  "Plan My Day",
  "Reddit Trends",
]

const starterAgents = [
  {
    title: "Find latest jobs",
    description: "Search the web for the latest jobs matching my profile.",
    prompt: "Search the web for the latest jobs matching my profile.",
    icon: BriefcaseBusiness,
    color: "bg-orange-100 text-orange-600",
  },
  {
    title: "Daily inbox summary",
    description: "Summarize important emails and highlight what needs my attention.",
    prompt: "Check my inbox and summarize important emails, highlighting what needs my attention.",
    icon: Mail,
    color: "bg-blue-100 text-blue-600",
  },
  {
    title: "Research a topic",
    description: "Search the web and create a useful research summary for me.",
    prompt: "Search the web and create a useful research summary about a topic I choose.",
    icon: Search,
    color: "bg-purple-100 text-purple-600",
  },
]

export default function AgentsPage() {



  const [tab, setTab] = useState("create")
  const [prompt, setPrompt] = useState(
    "Check my inbox and summarize the most important emails, especially anything that requires my reply or attention."
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [response, setResponse] = useState<ConfigureResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [googleConnection, setGoogleConnection] = useState<{ connected: boolean; email: string | null }>({ connected: false, email: null })
  const [googleNotice, setGoogleNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runResult, setRunResult] = useState<AgentRunResponse | null>(null)
  const [agents, setAgents] = useState<SavedAgent[]>([])
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null)
  const [agentListError, setAgentListError] = useState<string | null>(null)

  const loadAgents = async () => {
    setIsLoadingAgents(true)
    setAgentListError(null)
    try {
      const { data } = await axios.get<{ agents: SavedAgent[] }>("/api/agents")
      setAgents(data.agents)
    } catch {
      setAgentListError("Could not load your saved agents. Check the database migration and try again.")
    } finally {
      setIsLoadingAgents(false)
    }
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const googleResult = query.get("google")
    const reason = query.get("google_reason")
    if (googleResult === "connected") {
      setGoogleNotice({ kind: "success", text: "Google connected. You can run your Google agents now." })
    } else if (googleResult === "connection_failed") {
      const messages: Record<string, string> = {
        access_denied: "Google access was declined. Choose Allow to grant the requested access.",
        invalid_state: "The connection expired or started on a different site address. Start Connect Google again in this same browser tab.",
        missing_code: "Google did not return an authorization code. Start Connect Google again.",
        redirect_uri_mismatch: "The Google OAuth redirect URI does not match. Add the exact callback URL shown below to your Google Cloud OAuth client.",
        token_exchange_failed: "Google rejected the OAuth code. Check the OAuth client ID and secret in .env, then restart the dev server.",
        email_scope: "Google did not return the account email. The app now requests the email scope; click Connect Google again.",
        missing_refresh_token: "Google did not issue an offline access token. Remove this app from your Google Account connections, then connect again.",
        server_error: "The callback could not save the Google connection. Check the server log and confirm the database migrations are applied.",
        google_oauth_error: "Google could not complete consent. Check the OAuth consent screen and add your Google account as a test user if the app is in Testing mode.",
      }
      setGoogleNotice({ kind: "error", text: messages[reason ?? ""] ?? "Google connection failed. Check the OAuth redirect URI and consent screen settings." })
    }
    if (googleResult) window.history.replaceState({}, "", window.location.pathname)

    axios.get("/api/google/status")
      .then(({ data }) => setGoogleConnection(data))
      .catch(() => setGoogleConnection({ connected: false, email: null }))
  }, [])

  useEffect(() => {
    if (tab === "mine") void loadAgents()
  }, [tab])

  const requestConfiguration = async (event: FormEvent<HTMLFormElement>, clarificationAnswers?: Record<string, string | string[]>) => {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    try {
      const result = await axios.post<ConfigureResponse>("/api/configure", {
        prompt: trimmedPrompt,
        answers: clarificationAnswers,
      })
      setResponse(result.data)
      if (result.data.status === "ready" && result.data.config) {
        setIsConfigOpen(true)
        setRunResult(null)
        setIsRunning(true)
        try {
          const saved = await axios.post<{ agent: { agentId: string } }>("/api/agents", { config: result.data.config })
          const run = await axios.post<AgentRunResponse>("/api/agents/run", { agentId: saved.data.agent.agentId })
          setRunResult(run.data)
          if (tab === "mine") await loadAgents()
        } catch (runError) {
          const message = axios.isAxiosError(runError) ? runError.response?.data?.error : null
          setRunResult({ error: typeof message === "string" ? message : "The agent could not run this task." })
        } finally {
          setIsRunning(false)
        }
        void loadAgents()
      }
      if (result.data.status === "needs_clarification") setAnswers({})
    } catch (requestError) {
      const message = axios.isAxiosError(requestError)
        ? requestError.response?.data?.error
        : null
      setError(typeof message === "string" ? message : "Unable to create an agent configuration. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const runSavedAgent = async (agentId: string) => {
    setRunningAgentId(agentId)
    setAgentListError(null)
    try {
      await axios.post("/api/agents/run", { agentId })
      await loadAgents()
    } catch (runError) {
      const message = axios.isAxiosError(runError) ? runError.response?.data?.error : null
      setAgentListError(typeof message === "string" ? message : "Could not run this agent.")
      await loadAgents()
    } finally {
      setRunningAgentId(null)
    }
  }

  const toggleMultiAnswer = (questionId: string, option: string, checked: boolean) => {
    const current = Array.isArray(answers[questionId]) ? answers[questionId] as string[] : []
    setAnswers({
      ...answers,
      [questionId]: checked ? [...current, option] : current.filter((value) => value !== option),
    })
  }

  const submitAnswers = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const questions = response?.clarificationQuestions ?? []
    const allAnswered = questions.every((question) => {
      const answer = answers[question.id]
      const custom = answers[`${question.id}-custom`]
      if (question.type === "multi_select") {
        return (Array.isArray(answer) && answer.length > 0) || (typeof custom === "string" && custom.trim().length > 0)
      }
      return (typeof answer === "string" && answer.trim().length > 0) || (typeof custom === "string" && custom.trim().length > 0)
    })
    if (!allAnswered) {
      setError("Please answer each question before continuing.")
      return
    }
    void requestConfiguration(event, answers)
  }




  return (
    <main className="min-h-svh flex-1 bg-white px-6 py-8 sm:px-10 lg:px-14">
      <div className="mx-auto w-full max-w-5xl">
        <Tabs value={tab} onValueChange={(value) => setTab(value as string)}>
          <TabsList className="h-9 rounded-xl bg-slate-100 p-1">
            <TabsTrigger value="create" className="rounded-lg px-3 text-sm data-active:bg-white data-active:shadow-sm">
              Create Agent
            </TabsTrigger>
            <TabsTrigger value="mine" className="rounded-lg px-3 text-sm data-active:bg-white data-active:shadow-sm">
              My Agents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-14">
            <header className="mb-7">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
                Create New Agent
              </h1>
              <p className="mt-1.5 text-sm text-slate-500 sm:text-base">
                Ask what type of agent you want to create. Type your goal, task, or workflow.
              </p>
            </header>

            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm">
                <p className="font-medium text-slate-800">Google account</p>
                <p className="mt-0.5 text-slate-500">{googleConnection.connected ? `Connected as ${googleConnection.email}` : "Google sign-in is needed only for Gmail, Docs, Calendar, and Meet tasks."}</p>
              </div>
              <Button type="button" variant="outline" onClick={() => { window.location.href = "/api/google/connect" }} className="rounded-full">
                {googleConnection.connected ? "Refresh Google permissions" : "Connect Google"}
              </Button>
            </div>
            {googleNotice && (
              <div role={googleNotice.kind === "error" ? "alert" : "status"} className={`mb-5 rounded-xl border px-4 py-3 text-sm ${googleNotice.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
                <p>{googleNotice.text}</p>
                {googleNotice.kind === "error" && <p className="mt-2">Authorized redirect URI: <code className="rounded bg-white px-1.5 py-0.5">{process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/google/callback</code></p>}
              </div>
            )}

            <form onSubmit={(event) => requestConfiguration(event)}>
              <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,0.06)] sm:p-5">
                <Textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Check my inbox and summarize the most important emails, especially anything that requires my reply or attention."
                  aria-label="Describe the agent you want to create"
                  className="min-h-24 resize-none border-0 p-0 text-[15px] leading-6 shadow-none placeholder:text-slate-500 focus-visible:border-0 focus-visible:ring-0 md:text-base"
                />
                <div className="mt-5 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-slate-500">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Add attachment" className="rounded-full">
                      <Plus className="size-5" />
                    </Button>
                    <span className="flex items-center gap-2 text-sm">
                      <Sparkles className="size-4" />
                      AI Agent Builder
                    </span>
                  </div>
                  <Button
                    type="submit"
                    size="icon"
                    aria-label="Create agent"
                    disabled={!prompt.trim() || isSubmitting}
                    className="size-10 rounded-full bg-purple-700 text-white shadow-md shadow-purple-200 hover:bg-purple-800 disabled:bg-purple-300"
                  >
                    {isSubmitting ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <ArrowUp className="size-5" />}
                  </Button>
                </div>
              </div>
            </form>

            {error && (
              <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {response?.status === "needs_clarification" && (
              <form onSubmit={submitAnswers} aria-live="polite" className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-7">
                <h2 className="text-lg font-semibold text-slate-900">A few details are needed</h2>
                <p className="mt-1 text-sm text-slate-500">Answer these questions and we’ll finish your configuration.</p>
                <ol className="mt-5 space-y-5">
                  {response.clarificationQuestions.map((item, index) => (
                    <li key={item.id} className="rounded-xl bg-white p-4">
                      <fieldset>
                        <legend className="font-medium text-slate-800">{index + 1}. {item.question}</legend>
                        {item.type === "text" ? (
                          <Textarea required value={typeof answers[item.id] === "string" ? answers[item.id] as string : ""} onChange={(event) => setAnswers({ ...answers, [item.id]: event.target.value })} placeholder={item.customPlaceholder || "Your answer"} className="mt-3 bg-white" />
                        ) : (
                          <div className="mt-3 space-y-2">
                            {item.options.map((option) => (
                              <label key={option} className="flex items-center gap-2 text-sm text-slate-600">
                                <input
                                  type={item.type === "single_select" ? "radio" : "checkbox"}
                                  name={item.id}
                                  value={option}
                                  checked={item.type === "single_select" ? answers[item.id] === option : Array.isArray(answers[item.id]) && (answers[item.id] as string[]).includes(option)}
                                  onChange={(event) => item.type === "single_select" ? setAnswers({ ...answers, [item.id]: option }) : toggleMultiAnswer(item.id, option, event.target.checked)}
                                  className="accent-purple-700"
                                />
                                {option}
                              </label>
                            ))}
                            {item.allowCustom && (
                              <Textarea value={typeof answers[`${item.id}-custom`] === "string" ? answers[`${item.id}-custom`] as string : ""} onChange={(event) => setAnswers({ ...answers, [`${item.id}-custom`]: event.target.value })} placeholder={item.customPlaceholder || "Other"} className="mt-2 bg-white" />
                            )}
                          </div>
                        )}
                      </fieldset>
                    </li>
                  ))}
                </ol>
                <Button type="submit" disabled={isSubmitting} className="mt-5 rounded-full bg-purple-700 hover:bg-purple-800">
                  {isSubmitting ? "Building configuration…" : "Submit answers"}
                </Button>
              </form>
            )}

            <Dialog open={isConfigOpen} onOpenChange={setIsConfigOpen}>
              <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-6 sm:p-8">
                {response?.status === "ready" && response.config ? (
                  <>
                    <DialogHeader>
                      <p className="text-sm font-medium text-purple-700">Agent configuration ready</p>
                      <DialogTitle className="text-xl font-semibold text-slate-950">{response.config.name}</DialogTitle>
                      <DialogDescription>{response.config.description}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div><h3 className="text-sm font-semibold text-slate-900">Objective</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{response.config.objective}</p></div>
                      <div><h3 className="text-sm font-semibold text-slate-900">Schedule</h3><p className="mt-1 text-sm leading-6 text-slate-600">{response.config.schedule.type === "once" ? "On demand" : `${response.config.schedule.frequency} at ${response.config.schedule.time}`}</p></div>
                      <div><h3 className="text-sm font-semibold text-slate-900">Tools</h3><p className="mt-1 text-sm leading-6 text-slate-600">{response.config.tools.length ? response.config.tools.join(", ") : "No tools required"}</p></div>
                      <div><h3 className="text-sm font-semibold text-slate-900">Skills</h3><p className="mt-1 text-sm leading-6 text-slate-600">{response.config.skills.join(", ") || "None specified"}</p></div>
                      <div><h3 className="text-sm font-semibold text-slate-900">Output format</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{response.config.outputFormat}</p></div>
                    </div>
                    <div className="border-t border-slate-200 pt-5"><h3 className="text-sm font-semibold text-slate-900">Instructions</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{response.config.instructions}</p></div>
                    <div className="border-t border-slate-200 pt-5" aria-live="polite">
                      <h3 className="text-sm font-semibold text-slate-900">Agent run</h3>
                      {isRunning ? <p className="mt-2 text-sm text-slate-500">Reading important recent emails and preparing your results…</p> : null}
                      {runResult?.error ? (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                          <p>{runResult.error}</p>
                          {!googleConnection.connected && <Button type="button" onClick={() => { window.location.href = "/api/google/connect" }} className="mt-3 rounded-full bg-purple-700 hover:bg-purple-800">Connect Google</Button>}
                        </div>
                      ) : null}
                      {runResult?.status === "completed" ? (
                        <>
                          {typeof runResult.messageCount === "number" && <p className="mt-2 text-sm text-slate-600">Checked {runResult.messageCount} important emails from the last 7 days.</p>}
                          {runResult.warnings?.map((warning) => <p key={warning} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>)}
                          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">{runResult.summary}</p>
                          {runResult.documentUrl && <a href={runResult.documentUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-medium text-purple-700 underline underline-offset-4">Open the Google Doc</a>}
                          {runResult.calendarEventUrl && <a href={runResult.calendarEventUrl} target="_blank" rel="noreferrer" className="mt-4 ml-4 inline-flex text-sm font-medium text-purple-700 underline underline-offset-4">Open calendar event</a>}
                          {runResult.meetingUrl && <a href={runResult.meetingUrl} target="_blank" rel="noreferrer" className="mt-4 ml-4 inline-flex text-sm font-medium text-purple-700 underline underline-offset-4">Open Google Meet</a>}
                        </>
                      ) : null}
                    </div>
                  </>
                ) : <DialogTitle>Configuration unavailable</DialogTitle>}
              </DialogContent>
            </Dialog>

            <div className="mt-4 flex flex-wrap gap-2.5">
              {suggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPrompt(suggestion)}
                  className="h-9 rounded-full border-slate-200 px-3.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 sm:text-sm"
                >
                  {suggestion}
                </Button>
              ))}
            </div>

            <section className="mt-12">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">Get started</h2>
                <Button type="button" variant="ghost" onClick={() => setTab("mine")} className="text-sm text-slate-500 hover:text-slate-900">
                  View all
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {starterAgents.map(({ title, description, prompt: starterPrompt, icon: Icon, color }) => (
                  <Card
                    key={title}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPrompt(starterPrompt)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        setPrompt(starterPrompt)
                      }
                    }}
                    className="cursor-pointer rounded-2xl border-slate-200 shadow-none transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                  >
                    <CardContent className="p-5 sm:p-6">
                      <span className={`mb-7 flex size-12 items-center justify-center rounded-2xl ${color}`}>
                        <Icon className="size-5" />
                      </span>
                      <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="mine" className="mt-14">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">My Agents</h1>
                <p className="mt-1 text-sm text-slate-500">Saved agents can be run again whenever you need them.</p>
              </div>
              <Button type="button" onClick={() => setTab("create")} className="rounded-full bg-purple-700 hover:bg-purple-800">
                <Sparkles className="size-4" /> Create agent
              </Button>
            </div>
            {agentListError && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{agentListError}</p>}
            {isLoadingAgents ? <p className="py-12 text-center text-sm text-slate-500">Loading your agents…</p> : agents.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-slate-200 px-6 py-16 text-center">
                <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-700"><Sparkles className="size-5" /></span>
                <h2 className="text-xl font-semibold text-slate-900">No saved agents yet</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Create an agent and it will appear here for future runs.</p>
                <Button type="button" onClick={() => setTab("create")} className="mt-5 rounded-full bg-purple-700 hover:bg-purple-800"><Sparkles className="size-4" /> Create your first agent</Button>
              </section>
            ) : (
              <div className="space-y-4">
                {agents.map((agent) => (
                  <Card key={agent.agentId} className="rounded-2xl border-slate-200 shadow-none">
                    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900">{agent.name || "Untitled agent"}</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{agent.description || agent.objective}</p>
                        <p className="mt-2 text-xs text-slate-400">Tools: {agent.tools?.join(", ") || "No external tools"}</p>
                        {agent.latestRun && <p className="mt-2 text-xs text-slate-500">Last run: <span className="capitalize">{agent.latestRun.status}</span>{agent.latestRun.completedAt ? ` · ${new Date(agent.latestRun.completedAt).toLocaleString()}` : ""}</p>}
                        {agent.latestRun?.output?.summary && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{agent.latestRun.output.summary}</p>}
                        {agent.latestRun?.output?.documentUrl && <a href={agent.latestRun.output.documentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-sm font-medium text-purple-700 underline underline-offset-4">Open latest Google Doc</a>}
                        {agent.latestRun?.output?.calendarEventUrl && <a href={agent.latestRun.output.calendarEventUrl} target="_blank" rel="noreferrer" className="ml-4 mt-2 inline-flex text-sm font-medium text-purple-700 underline underline-offset-4">Open latest calendar event</a>}
                        {agent.latestRun?.output?.meetingUrl && <a href={agent.latestRun.output.meetingUrl} target="_blank" rel="noreferrer" className="ml-4 mt-2 inline-flex text-sm font-medium text-purple-700 underline underline-offset-4">Open latest Google Meet</a>}
                        {agent.latestRun?.status === "failed" && agent.latestRun.error && <p role="alert" className="mt-2 text-sm text-red-600">{agent.latestRun.error}</p>}
                      </div>
                      <Button type="button" onClick={() => void runSavedAgent(agent.agentId)} disabled={runningAgentId === agent.agentId} className="shrink-0 rounded-full bg-purple-700 hover:bg-purple-800">
                        {runningAgentId === agent.agentId ? "Running…" : "Run agent"}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
