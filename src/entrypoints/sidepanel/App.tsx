import React, { useEffect, useState } from 'react'

import SignIn from '@/components/SignIn'
import { db } from '@/lib/db'
import { sendToBackground } from '@/lib/messaging'
import { activeApplicationsStorage, applicationsStorage } from '@/lib/storage'

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
    if (user) void loadCurrentTab()
  }, [user])

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

  async function openAutofillModal(tab: 'profile' | 'ai' = 'profile') {
    try {
      await sendToBackground({
        type: 'OPEN_AUTOFILL_MODAL',
        payload: { tab },
      })
    } catch (e) {
      setTabState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  async function handleClearApplications() {
    if (applications.length === 0) return
    const ok = window.confirm(
      `Clear all ${applications.length} tracked applications? This cannot be undone.`,
    )
    if (!ok) return
    try {
      await applicationsStorage.clear()
    } catch (e) {
      setTabState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0f0f13] text-sm text-white/50">
        Loading…
      </div>
    )
  }

  if (authError) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0f0f13] px-4 text-center text-sm text-red-400">
        Auth Error: {authError.message}
      </div>
    )
  }

  if (!user) {
    return (
      <div className="ojk-scroll h-full overflow-y-auto bg-[#0f0f13]">
        <SignIn compact />
      </div>
    )
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

  const needsAi =
    tabState.status === 'error' &&
    tabState.message.toLowerCase().includes('api key')

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0f0f13] font-[Inter,sans-serif] text-white">
      {/* Top chrome — fixed, never scrolls */}
      <header className="shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold">
            J
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-tight font-semibold">OpenJobKit</p>
            <p className="truncate text-[10px] text-white/40">{user.email}</p>
          </div>
          <button
            type="button"
            aria-label="Settings"
            onClick={() => void openAutofillModal('ai')}
            className="flex size-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/8 hover:text-white"
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="shrink-0 space-y-3 px-4 pb-3">
        <PageBanner state={tabState} />

        <button
          type="button"
          disabled={fillBusy || tabState.status === 'unsupported'}
          onClick={() => void handleFillPage()}
          className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition-all hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
        >
          {fillBusy ? 'Filling…' : '+ Autofill This Page'}
        </button>

        {needsAi && (
          <button
            type="button"
            onClick={() => void openAutofillModal('ai')}
            className="w-full rounded-lg border border-violet-500/30 bg-violet-500/10 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"
          >
            Configure AI to enable autofill
          </button>
        )}

        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
          <MenuRow
            title="Your Autofill Information"
            subtitle="Profile, resume & answers"
            onClick={() => void openAutofillModal('profile')}
          />
          <MenuRow
            title="AI Settings"
            subtitle="Provider, API key & model"
            onClick={() => void openAutofillModal('ai')}
            last
          />
        </div>
      </div>

      {/* Applications — only this region scrolls */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-white/8">
        <div className="shrink-0 px-4 pt-3 pb-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium tracking-wider text-white/40 uppercase">
              Applications
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/30">
                {applications.length}
              </span>
              {applications.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleClearApplications()}
                  className="text-[10px] font-medium text-white/35 transition-colors hover:text-red-400"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="ojk-scroll-hide flex gap-1.5 overflow-x-auto pb-0.5">
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
                className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
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

        <main className="ojk-scroll min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-3">
          {isDataLoading ? (
            <div className="flex h-32 items-center justify-center text-sm text-white/30">
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            filtered.map((app) => <ApplicationRow key={app.id} app={app} />)
          )}
        </main>
      </div>
    </div>
  )
}

function PageBanner({ state }: { state: TabState }) {
  if (state.status === 'loading') {
    return (
      <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-center text-xs text-white/40">
        Detecting page…
      </div>
    )
  }

  if (state.status === 'unsupported') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-xs">
        <span className="text-white/60">Autofill not supported here</span>
        <span className="shrink-0 text-white/30">Open a job page</span>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
        {state.message}
      </div>
    )
  }

  const platformLabel = PLATFORM_LABELS[state.platform] ?? state.platform
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
      <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
      {platformLabel} ready
    </div>
  )
}

function MenuRow({
  title,
  subtitle,
  onClick,
  last = false,
}: {
  title: string
  subtitle: string
  onClick: () => void
  last?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.06] ${
        last ? '' : 'border-b border-white/8'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-white/90">{title}</span>
        <span className="block text-[11px] text-white/40">{subtitle}</span>
      </span>
      <span className="text-white/25" aria-hidden>
        ›
      </span>
    </button>
  )
}

function ApplicationRow({ app }: { app: JobApplication }) {
  const timeAgo = app.appliedAt
    ? formatTimeAgo(new Date(app.appliedAt))
    : app.job.detectedAt
      ? formatTimeAgo(new Date(app.job.detectedAt))
      : null

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-medium">
            {app.job.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-white/45">
            {app.job.company}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[app.status]}`}
        >
          {STATUS_LABELS[app.status]}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/30">
        <span className="capitalize">{app.job.platform}</span>
        {timeAgo && (
          <>
            <span>·</span>
            <span>{timeAgo}</span>
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
    <div className="flex h-36 flex-col items-center justify-center gap-1.5 px-6 text-center">
      <p className="text-sm font-semibold text-white/80">No applications yet</p>
      <p className="text-xs text-white/30">
        {filter === 'all'
          ? 'Apply to jobs to see them tracked here.'
          : `No jobs marked as '${filter}'.`}
      </p>
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
