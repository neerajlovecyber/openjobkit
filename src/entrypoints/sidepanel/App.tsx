import React, { useEffect, useState } from 'react'

import SettingsApp from '@/components/SettingsApp'
import SignIn from '@/components/SignIn'
import { db } from '@/lib/db'
import { sendToBackground } from '@/lib/messaging'
import { takeSidepanelView } from '@/lib/sidepanel'
import { activeApplicationsStorage } from '@/lib/storage'

import type { SidepanelView } from '@/lib/sidepanel'
import type { JobApplication } from '@/types/job'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToApp(row: any): JobApplication {
  return {
    id: row.appId as string,
    job: row.job as JobApplication['job'],
    status: row.status as JobApplication['status'],
    appliedAt: (row.appliedAt as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    coverLetter: (row.coverLetter as string | null) ?? undefined,
    aiGeneratedAnswers:
      (row.aiGeneratedAnswers as Record<string, string> | null) ?? undefined,
    error: (row.error as string | null) ?? undefined,
  }
}

const STATUS_COLORS: Record<JobApplication['status'], string> = {
  detected: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  filling: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  filled: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  reviewing: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  applied: 'bg-green-500/20 text-green-300 border-green-500/30',
  skipped: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  failed: 'bg-red-500/20 text-red-300 border-red-500/30',
  saved: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

const STATUS_LABELS: Record<JobApplication['status'], string> = {
  detected: 'Detected',
  filling: 'Filling',
  filled: 'Filled',
  reviewing: 'Reviewing',
  applied: 'Applied',
  skipped: 'Skipped',
  failed: 'Failed',
  saved: 'Saved',
}

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
}

const SUPPORTED_PATTERNS = [
  { pattern: /linkedin\.com\/jobs/i, platform: 'linkedin' },
  { pattern: /indeed\.com/i, platform: 'indeed' },
  { pattern: /greenhouse\.io/i, platform: 'greenhouse' },
  { pattern: /lever\.co/i, platform: 'lever' },
]

function detectPlatform(url: string): string | null {
  for (const { pattern, platform } of SUPPORTED_PATTERNS) {
    if (pattern.test(url)) return platform
  }
  return null
}

type TabState =
  | { status: 'loading' }
  | { status: 'unsupported'; url: string }
  | { status: 'supported'; platform: string; url: string }
  | { status: 'error'; message: string }

export default function App() {
  const { isLoading: isAuthLoading, user, error: authError } = db.useAuth()
  const [view, setView] = useState<SidepanelView>('home')
  const [filter, setFilter] = useState<JobApplication['status'] | 'all'>('all')
  const [tabState, setTabState] = useState<TabState>({ status: 'loading' })
  const [fillBusy, setFillBusy] = useState(false)

  const { isLoading: isDataLoading, data } = db.useQuery(
    user
      ? {
          applications: {
            $: { where: { userId: user.id }, order: { updatedAt: 'desc' } },
          },
        }
      : null,
  )

  useEffect(() => {
    void takeSidepanelView().then(setView)
  }, [])

  useEffect(() => {
    if (user && view === 'home') {
      void loadCurrentTab()
    }
  }, [user, view])

  async function loadCurrentTab() {
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id) return
      const url = tab.url ?? ''

      const activeMapping = await activeApplicationsStorage.get(tab.id)
      if (activeMapping) {
        const { data: appData } = await db.queryOnce({
          applications: {
            $: { where: { appId: activeMapping.applicationId } },
          },
        })
        const app = appData.applications[0]
        if (app) {
          const mapped = rowToApp(app)
          setTabState({
            status: 'supported',
            platform: mapped.job.platform,
            url: mapped.job.url,
          })
          try {
            await browser.tabs.sendMessage(tab.id, { type: 'PING' })
          } catch {
            // Ignored
          }
          return
        }
      }

      const platform = detectPlatform(url)
      if (platform) {
        setTabState({ status: 'supported', platform, url })
        try {
          await browser.tabs.sendMessage(tab.id, { type: 'PING' })
        } catch {
          // Ignored
        }
      } else {
        setTabState({ status: 'unsupported', url })
      }
    } catch (e) {
      setTabState({ status: 'error', message: String(e) })
    }
  }

  async function handleFillPage() {
    setFillBusy(true)
    try {
      await sendToBackground({ type: 'TRIGGER_FILL_ACTIVE_TAB' })
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Failed to trigger autofill.'
      setTabState({ status: 'error', message })
    } finally {
      setFillBusy(false)
    }
  }

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] text-sm text-white/50">
        Loading…
      </div>
    )
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] px-4 text-center text-sm text-red-400">
        Auth Error: {authError.message}
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0f0f13]">
        <SignIn compact />
      </div>
    )
  }

  if (view === 'settings') {
    return <SettingsApp embedded onBack={() => setView('home')} />
  }

  const applications = data?.applications.map(rowToApp) ?? []
  const filtered =
    filter === 'all'
      ? applications
      : applications.filter((a) => a.status === filter)

  const counts = applications.reduce(
    (acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  return (
    <div className="flex min-h-screen flex-col bg-[#0f0f13] font-[Inter,sans-serif] text-white">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0f0f13]/90 px-4 py-3 backdrop-blur">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold">
            J
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-tight font-semibold">OpenJobKit</p>
            <p className="truncate text-[10px] text-white/40">{user.email}</p>
          </div>
          <button
            type="button"
            aria-label="Settings"
            onClick={() => setView('settings')}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            Settings
          </button>
        </div>

        <PageStatus
          state={tabState}
          fillBusy={fillBusy}
          onFill={handleFillPage}
          onOpenSettings={() => setView('settings')}
        />
      </header>

      <div className="border-b border-white/8 px-4 py-2.5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-medium tracking-wider text-white/40 uppercase">
            Applications
          </p>
          <span className="text-[10px] text-white/30">
            {applications.length} total
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', 'All', applications.length],
              ['applied', 'Applied', counts.applied ?? 0],
              ['filled', 'Filled', counts.filled ?? 0],
              ['failed', 'Failed', counts.failed ?? 0],
            ] as const
          ).map(([val, label, count]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilter(val as typeof filter)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                filter === val
                  ? 'border-violet-500 bg-violet-600 text-white'
                  : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {label} {count}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {isDataLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-white/30">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          filtered.map((app) => <ApplicationRow key={app.id} app={app} />)
        )}
      </main>
    </div>
  )
}

function PageStatus({
  state,
  fillBusy,
  onFill,
  onOpenSettings,
}: {
  state: TabState
  fillBusy: boolean
  onFill: () => void
  onOpenSettings: () => void
}) {
  if (state.status === 'loading') {
    return (
      <div className="rounded-xl border border-white/8 bg-white/5 p-3 text-center text-xs text-white/40">
        Detecting page…
      </div>
    )
  }

  if (state.status === 'unsupported') {
    return (
      <div className="rounded-xl border border-white/8 bg-white/5 p-3">
        <p className="text-center text-xs text-white/50">
          Not a supported job page
        </p>
        <p className="mt-1 text-center text-[11px] text-white/30">
          Open LinkedIn, Indeed, Greenhouse, or Lever
        </p>
      </div>
    )
  }

  if (state.status === 'error') {
    const needsAi = state.message.toLowerCase().includes('api key')
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
        <p className="text-xs text-red-300">{state.message}</p>
        {needsAi && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-2 w-full rounded-lg bg-violet-600 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
          >
            Open AI Settings
          </button>
        )}
      </div>
    )
  }

  const platformLabel = PLATFORM_LABELS[state.platform] ?? state.platform

  return (
    <div className="rounded-xl border border-white/8 bg-white/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
        <span className="text-xs font-medium text-white/80">
          {platformLabel} detected
        </span>
      </div>
      <p className="mb-3 truncate text-[11px] text-white/40">{state.url}</p>
      <button
        type="button"
        disabled={fillBusy}
        onClick={onFill}
        className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 py-2 text-sm font-semibold text-white transition-all hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
      >
        {fillBusy ? 'Filling…' : 'Fill This Page'}
      </button>
    </div>
  )
}

function ApplicationRow({ app }: { app: JobApplication }) {
  const timeAgo = app.appliedAt
    ? formatTimeAgo(new Date(app.appliedAt))
    : app.job.detectedAt
      ? formatTimeAgo(new Date(app.job.detectedAt))
      : null

  return (
    <div className="rounded-xl border border-white/8 bg-white/5 p-3 transition-colors hover:bg-white/8">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-medium">
            {app.job.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-white/50">
            {app.job.company}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[app.status]}`}
        >
          {STATUS_LABELS[app.status]}
        </span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-white/35">
        <span className="capitalize">{app.job.platform}</span>
        {app.job.location && (
          <>
            <span>·</span>
            <span className="truncate">{app.job.location}</span>
          </>
        )}
        {timeAgo && (
          <>
            <span>·</span>
            <span className="ml-auto shrink-0">{timeAgo}</span>
          </>
        )}
      </div>

      {app.error && (
        <p className="mt-2 truncate rounded-lg bg-red-500/10 px-2 py-1 text-[10px] text-red-400/80">
          {app.error}
        </p>
      )}
    </div>
  )
}

function EmptyState({ filter }: { filter: string }) {
  return (
    <div className="flex h-52 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-lg text-white/40">
        ∅
      </div>
      <div>
        <p className="text-sm font-semibold">No applications found</p>
        <p className="mt-1 text-xs text-white/30">
          {filter === 'all'
            ? 'Start applying to jobs to see tracker cards here.'
            : `No jobs marked as '${filter}' currently.`}
        </p>
      </div>
    </div>
  )
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHour < 24) return `${diffHour}h ago`
  return `${diffDay}d ago`
}
