import React from 'react'

import SignIn from '@/components/SignIn'
import { db } from '@/lib/db'

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
  detected: '👁 Detected',
  filling: '⚡ Filling',
  filled: '✍️ Filled',
  reviewing: '🔍 Reviewing',
  applied: '✅ Applied',
  skipped: '⏭ Skipped',
  failed: '❌ Failed',
  saved: '🔖 Saved',
}

export default function App() {
  const { isLoading: isAuthLoading, user, error: authError } = db.useAuth()
  const [filter, setFilter] = React.useState<JobApplication['status'] | 'all'>(
    'all',
  )

  // Real-time reactive query — scopes data to user.id
  const { isLoading: isDataLoading, data } = db.useQuery(
    user
      ? {
          applications: {
            $: { where: { userId: user.id }, order: { updatedAt: 'desc' } },
          },
        }
      : null,
  )

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] text-sm text-white/50">
        Loading authentication state…
      </div>
    )
  }

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] text-sm text-red-400">
        Auth Error: {authError.message}
      </div>
    )
  }

  if (!user) {
    return <SignIn />
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
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0f0f13]/80 px-4 py-4 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold">
            J
          </div>
          <span className="text-sm font-semibold tracking-tight">
            Job Tracker
          </span>
          <span className="ml-auto text-xs text-white/40">
            {applications.length} total
          </span>
        </div>

        {/* Summary pills */}
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', '🗂 All', applications.length],
              ['applied', '✅', counts.applied ?? 0],
              ['filled', '✍️', counts.filled ?? 0],
              ['failed', '❌', counts.failed ?? 0],
            ] as const
          ).map(([val, label, count]) => (
            <button
              key={val}
              id={`filter-${val}`}
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
      </header>

      {/* Body */}
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

      {/* Footer */}
      <footer className="flex items-center justify-between border-t border-white/10 px-4 py-3">
        <span className="text-xs text-white/30">OpenJobKit v0.1</span>
        <button
          id="open-options"
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-xs text-violet-400 transition-colors hover:text-violet-300"
        >
          Settings →
        </button>
      </footer>
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
    <div className="group rounded-xl border border-white/8 bg-white/5 p-3 transition-colors hover:bg-white/8">
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
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl">
        {filter === 'all'
          ? '🎯'
          : filter === 'applied'
            ? '✅'
            : filter === 'failed'
              ? '❌'
              : '📝'}
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
