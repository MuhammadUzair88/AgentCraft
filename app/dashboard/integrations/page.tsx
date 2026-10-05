"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowUpRight, Check, Mail, RefreshCw, Send, Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"

type GoogleConnection = { connected: boolean; email: string | null }

const integrations = [
  { provider: "discord", name: "Discord", description: "Install the AgentCraft bot in a server so agents can manage channels.", mark: "D", tone: "bg-indigo-50 text-indigo-700" },
  { provider: "github", name: "GitHub", description: "Authorize repository access for repo creation and file management.", mark: "GH", tone: "bg-slate-100 text-slate-800" },
  { provider: "reddit", name: "Reddit", description: "Connect Reddit for account access and authorized workflows.", mark: "r/", tone: "bg-orange-50 text-orange-700" },
  { provider: "slack", name: "Slack", description: "Install the app in a workspace to connect its messaging bot.", mark: "S", tone: "bg-fuchsia-50 text-fuchsia-700" },
  { provider: "notion", name: "Notion", description: "Authorize a workspace and choose the pages it can share.", mark: "N", tone: "bg-slate-100 text-slate-900" },
  { provider: "linkedin", name: "LinkedIn", description: "Connect your LinkedIn member profile. Posting access requires LinkedIn approval.", mark: "in", tone: "bg-sky-50 text-sky-700" },
]
type ConnectedAccount = { provider: string; accountId: string; name: string }

export default function IntegrationsPage() {
  const [google, setGoogle] = useState<GoogleConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([])
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const notice = searchParams.get("google")
  const integrationError = searchParams.get("integration_error")
  const integrationConnected = searchParams.get("integration_connected")

  useEffect(() => {
    let active = true
    fetch("/api/google/status")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: GoogleConnection) => { if (active) setGoogle(data) })
      .catch(() => { if (active) setGoogle({ connected: false, email: null }) })
      .finally(() => { if (active) setLoading(false) })
    fetch("/api/integrations/status")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { accounts: ConnectedAccount[] }) => { if (active) setConnectedAccounts(data.accounts) })
      .catch(() => { if (active) setConnectedAccounts([]) })
    return () => { active = false }
  }, [])

  async function disconnect(provider: string, accountId: string) {
    const key = `${provider}:${accountId}`
    setDisconnecting(key)
    try {
      const response = await fetch(`/api/integrations/${provider}/disconnect?accountId=${encodeURIComponent(accountId)}`, { method: "DELETE" })
      if (!response.ok) throw new Error("Could not disconnect this account.")
      setConnectedAccounts((accounts) => accounts.filter((account) => !(account.provider === provider && account.accountId === accountId)))
    } finally {
      setDisconnecting(null)
    }
  }

  return (
    <main className="min-h-screen flex-1 bg-[#fafbfc] px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="text-sm font-medium text-violet-700">Workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Integrations</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Connect the accounts your agents need to work with. You control which services are available to each agent.</p></div>
          <div className="flex items-center gap-2 self-start rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 sm:self-auto"><span className={`size-2 rounded-full ${google?.connected || connectedAccounts.length ? "bg-emerald-500" : "bg-slate-300"}`} />{connectedAccounts.length + (google?.connected ? 1 : 0)} account{connectedAccounts.length + (google?.connected ? 1 : 0) === 1 ? "" : "s"} connected</div>
        </div>

        {notice === "connected" && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Google account connected successfully.</div>}
        {(notice === "error" || notice === "connection_failed") && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Google connection was not completed. Please try again.</div>}
        {integrationError && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{integrationError}</div>}
        {integrationConnected && <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{integrationConnected} account connected.</div>}

        <section aria-labelledby="email-heading">
          <div className="mb-3"><h2 id="email-heading" className="text-lg font-semibold text-slate-900">Email</h2><p className="mt-0.5 text-sm text-slate-500">Give agents access to the inboxes they need.</p></div>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.03)] sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><Mail className="size-6" /></div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">Gmail</h3><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700">Google</span></div><p className="mt-1 text-sm text-slate-500">Read inbox messages and send email from your connected account.</p>
                {google?.connected && <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-emerald-700"><Check className="size-4" />Connected as {google.email}</p>}
                <p className="mt-2 text-xs text-slate-400">Gmail send permission is requested when you connect or reconnect.</p></div>
              <Button disabled={loading} onClick={() => { window.location.href = "/api/google/connect" }} variant={google?.connected ? "outline" : "default"} className="shrink-0 rounded-full">{loading ? <><RefreshCw className="size-4 animate-spin" />Checking…</> : google?.connected ? "Reconnect account" : "Connect Gmail"}</Button>
            </div>
          </article>
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-slate-100/70 px-4 py-3 text-xs leading-5 text-slate-500"><Check className="mt-0.5 size-3.5 shrink-0 text-slate-400" />Your connection is private to your account. Reconnect it at any time to refresh access.</div>
        </section>

        <section aria-labelledby="services-heading" className="mt-10">
          <div className="mb-4"><h2 id="services-heading" className="text-lg font-semibold text-slate-900">Connected services</h2><p className="mt-0.5 text-sm text-slate-500">Authorize the workspaces and accounts your agents should use.</p></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{integrations.map(({ provider, name, description, mark, tone }) => {
            const accounts = connectedAccounts.filter((account) => account.provider === provider)
            return <article key={provider} className="flex min-h-48 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.03)]"><div className="flex items-start justify-between"><span className={`flex size-11 items-center justify-center rounded-xl text-lg font-bold ${tone}`}>{mark}</span><span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${accounts.length ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{accounts.length ? "Connected" : "Not connected"}</span></div><h3 className="mt-4 font-semibold text-slate-900">{name}</h3><p className="mt-1 flex-1 text-sm leading-5 text-slate-500">{description}</p>{accounts.map((account) => <div key={account.accountId} className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-emerald-50/70 px-3 py-2"><span className="truncate text-xs font-medium text-emerald-800">{account.name}</span><button type="button" aria-label={`Disconnect ${account.name}`} disabled={disconnecting === `${provider}:${account.accountId}`} onClick={() => void disconnect(provider, account.accountId)} className="text-emerald-700 hover:text-red-700 disabled:opacity-50"><Unplug className="size-4" /></button></div>)}<Button nativeButton={false} render={<a href={`/api/integrations/${provider}/connect`} />} variant="outline" className="mt-4 w-full rounded-full">{accounts.length ? "Connect another account" : "Connect"} <ArrowUpRight className="size-4" /></Button></article>
          })}</div>
        </section>

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div className="flex items-start gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Send className="size-5" /></span><div><h2 className="font-semibold text-slate-900">Connected services and agents</h2><p className="mt-1 text-sm leading-6 text-slate-500">Connections authorize account access. Agent actions depend on each provider's API permissions and are configured separately.</p></div></div></section>
      </div>
    </main>
  )
}
