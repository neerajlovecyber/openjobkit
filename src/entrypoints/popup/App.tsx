import React from 'react'

import { db, USER_ID } from '@/lib/db'
import { sendToBackground } from '@/lib/messaging'
import { activeApplicationsStorage } from '@/lib/storage'

import type { JobApplication } from '@/types/job'

type TabState =
  | { status: 'loading' }
  | { status: 'unsupported'; url: string }
  | { status: 'supported'; platform: string; url: string }
  | { status: 'error'; message: string }

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToApp(row: any): JobApplication {
  return {
    id: row.appId as string,
    job: row.job as JobApplication['job'],
    status: row.status as JobApplication['status'],
    appliedAt: (row.appliedAt as string | null) ?? undefined,
  }
}

export default function App() {
  const [tabState, setTabState] = React.useState<TabState>({
    status: 'loading',
  })

  // Reactive — updates in real-time as background SW writes new apps
  const { data } = db.useQuery({
    applications: {
      $: { where: { userId: USER_ID }, order: { updatedAt: 'desc' }, limit: 3 },
    },
  })
  const recentApps = data?.applications.map(rowToApp) ?? []

  React.useEffect(() => {
    void loadCurrentTab()
  }, [])

  async function loadCurrentTab() {
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id) return
      const url = tab.url ?? ''

      // Check if we already have a detected job form for this tab
      const activeMapping = await activeApplicationsStorage.get(tab.id)
      if (activeMapping) {
        // We have a mapping — look up the app to get platform + url from its job data
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

      // Fallback to top-level URL pattern matching
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
    try {
      await sendToBackground({ type: 'TRIGGER_FILL_ACTIVE_TAB' })
    } catch (e) {
      console.error('[OpenJobKit] Failed to trigger fill:', e)
    }
  }

  return (
    <div className="w-80 bg-[#0f0f13] font-[Inter,sans-serif] text-white">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/10 px-4 pt-4 pb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold">
          J
        </div>
        <div>
          <p className="text-sm leading-tight font-semibold">OpenJobKit</p>
          <p className="text-[11px] text-white/40">AI Job Assistant</p>
        </div>
        <button
          id="open-sidepanel"
          onClick={() => browser.runtime.openOptionsPage()}
          className="ml-auto text-[11px] text-white/40 transition-colors hover:text-white/70"
        >
          Settings
        </button>
      </div>

      {/* Current page status */}
      <div className="px-4 py-3">
        <p className="mb-2 text-[11px] font-medium tracking-wider text-white/40 uppercase">
          Current Page
        </p>
        <PageStatus state={tabState} onFill={handleFillPage} />
      </div>

      {/* Recent applications */}
      {recentApps.length > 0 && (
        <div className="border-t border-white/8 px-4 pb-3">
          <p className="mt-3 mb-2 text-[11px] font-medium tracking-wider text-white/40 uppercase">
            Recent
          </p>
          <div className="space-y-1.5">
            {recentApps.map((app) => (
              <div key={app.id} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate text-white/60">
                  {app.job.title}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    app.status === 'applied'
                      ? 'bg-green-500/20 text-green-300'
                      : app.status === 'failed'
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-white/10 text-white/50'
                  }`}
                >
                  {app.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/8 px-4 py-2.5">
        <span className="text-[10px] text-white/25">v0.1.0</span>
        <button
          id="open-options"
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-[11px] text-violet-400 transition-colors hover:text-violet-300"
        >
          Full settings →
        </button>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PageStatus({
  state,
  onFill,
}: {
  state: TabState
  onFill: () => void
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
          Not a supported job page.
        </p>
        <p className="mt-1 text-center text-[11px] text-white/30">
          Go to LinkedIn, Indeed, Greenhouse, or Lever
        </p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
        <p className="text-xs text-red-300">{state.message}</p>
      </div>
    )
  }

  const platformLabel = PLATFORM_LABELS[state.platform] ?? state.platform

  return (
    <div className="space-y-3 rounded-xl border border-white/8 bg-white/5 p-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
        <span className="text-xs font-medium text-white/80">
          {platformLabel} detected
        </span>
      </div>
      <p className="truncate text-[11px] text-white/40">{state.url}</p>
      <button
        id="fill-current-page"
        onClick={onFill}
        className="w-full rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 py-2 text-sm font-semibold text-white transition-all hover:from-violet-500 hover:to-indigo-500 active:scale-95"
      >
        ✨ Fill This Page
      </button>
    </div>
  )
}
