// Storage layer — InstantDB replaces chrome.storage.local as the primary store.
//
// Profile, settings, and applications are stored in InstantDB which gives us:
//   - Local-first reads (IndexedDB cache, no network required after first load)
//   - Automatic real-time cloud sync
//   - Reactive updates to all open extension pages via db.useQuery()
//
// The ONLY thing remaining in browser.storage.local is the ephemeral
// tab→applicationId mapping, which is tab-scoped and must not outlive the tab.

import { id as instantId } from '@instantdb/react'

import { db } from '@/lib/db'
import { DEMO_PROFILE } from '@/lib/demo-profile'
import { DEFAULT_SETTINGS } from '@/types/settings'

import type { JobApplication, JobListing } from '@/types/job'
import type { UserProfile } from '@/types/profile'
import type { UserSettings } from '@/types/settings'

// ────────────────────────────────────────────────────────────────────────────
// Helper: get the current authenticated user's ID
// ────────────────────────────────────────────────────────────────────────────

export async function getUserId(): Promise<string> {
  const user = await db.getAuth()
  if (!user) {
    throw new Error('Unauthenticated')
  }
  return user.id
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: map InstantDB application row → JobApplication
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Profile
// ────────────────────────────────────────────────────────────────────────────

export const profileStorage = {
  get: async (): Promise<UserProfile> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      profiles: { $: { where: { userId } } },
    })
    return (data.profiles[0]?.data as unknown as UserProfile) ?? DEMO_PROFILE
  },

  set: async (profile: UserProfile): Promise<void> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      profiles: { $: { where: { userId } } },
    })
    const recordId = data.profiles[0]?.id ?? instantId()
    await db.transact(
      db.tx.profiles[recordId].update({
        userId,
        data: profile as unknown as Record<string, unknown>,
        updatedAt: Date.now(),
      }),
    )
  },

  update: async (partial: Partial<UserProfile>): Promise<void> => {
    const existing = await profileStorage.get()
    await profileStorage.set({ ...existing, ...partial })
  },

  /** Linked resume PDF/DOC from InstantDB storage (for Easy Apply upload). */
  getResumeFile: async (): Promise<{
    name: string
    mimeType: string
    base64: string
  } | null> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      profiles: {
        $: { where: { userId } },
        resumeFile: {},
      },
    })
    const file = data.profiles[0]?.resumeFile as
      | { id: string; path: string; url: string }
      | undefined
      | null
    if (!file?.url) return null

    const res = await fetch(file.url)
    if (!res.ok) {
      throw new Error(`Failed to download resume (${res.status})`)
    }
    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    const base64 = btoa(binary)
    const name = file.path.split('/').pop() || 'resume.pdf'
    const mimeType =
      res.headers.get('content-type') ||
      (name.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : name.toLowerCase().endsWith('.doc')
          ? 'application/msword'
          : name.toLowerCase().endsWith('.docx')
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/octet-stream')

    return { name, mimeType, base64 }
  },
}

// ────────────────────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────────────────────

export const settingsStorage = {
  get: async (): Promise<UserSettings> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      settings: { $: { where: { userId } } },
    })
    const stored = data.settings[0]?.data as unknown as UserSettings | null
    if (!stored) return DEFAULT_SETTINGS

    // Deep-merge so new default fields added in a future release are always
    // populated even if the stored blob predates them.
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      ai: { ...DEFAULT_SETTINGS.ai, ...stored.ai },
      platforms: { ...DEFAULT_SETTINGS.platforms, ...stored.platforms },
    }
  },

  set: async (settings: UserSettings): Promise<void> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      settings: { $: { where: { userId } } },
    })
    const recordId = data.settings[0]?.id ?? instantId()
    await db.transact(
      db.tx.settings[recordId].update({
        userId,
        data: settings as unknown as Record<string, unknown>,
        updatedAt: Date.now(),
      }),
    )
  },

  update: async (partial: Partial<UserSettings>): Promise<void> => {
    const existing = await settingsStorage.get()
    await settingsStorage.set({
      ...existing,
      ...partial,
      ...(partial.ai && { ai: { ...existing.ai, ...partial.ai } }),
      ...(partial.platforms && {
        platforms: { ...existing.platforms, ...partial.platforms },
      }),
    })
  },

  reset: async (): Promise<void> => {
    await settingsStorage.set(DEFAULT_SETTINGS)
  },
}

// ────────────────────────────────────────────────────────────────────────────
// Job Applications
// ────────────────────────────────────────────────────────────────────────────

/** Strip hash + tracking params so the same job page matches across reloads. */
export function normalizeJobUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
    ]) {
      parsed.searchParams.delete(key)
    }
    // Drop trailing slash for stable comparison
    let normalized = parsed.toString()
    if (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
    return normalized
  } catch {
    return url.trim()
  }
}

export const applicationsStorage = {
  getAll: async (): Promise<Array<JobApplication>> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      applications: {
        $: { where: { userId }, order: { updatedAt: 'desc' } },
      },
    })
    const apps = data.applications.map(rowToApp)
    // Clean Filled+Applied twins from earlier ID drift
    const removed = await applicationsStorage.collapseDuplicates(apps)
    if (removed > 0) {
      const { data: fresh } = await db.queryOnce({
        applications: {
          $: { where: { userId }, order: { updatedAt: 'desc' } },
        },
      })
      return fresh.applications.map(rowToApp)
    }
    return apps
  },

  getById: async (appId: string): Promise<JobApplication | null> => {
    const { data } = await db.queryOnce({
      applications: { $: { where: { appId } } },
    })
    return data.applications[0] ? rowToApp(data.applications[0]) : null
  },

  /** Find the latest open application for this job URL (dedupe detections). */
  getOpenByJobUrl: async (url: string): Promise<JobApplication | null> => {
    const normalized = normalizeJobUrl(url)
    if (!normalized) return null

    const apps = await applicationsStorage.getAll()
    return (
      apps.find((app) => {
        if (normalizeJobUrl(app.job.url) !== normalized) return false
        // Treat applied/skipped as finished — allow a fresh detection later
        return app.status !== 'applied' && app.status !== 'skipped'
      }) ?? null
    )
  },

  /** Any application for this job URL (open preferred, else most recent). */
  getByJobUrl: async (url: string): Promise<JobApplication | null> => {
    const normalized = normalizeJobUrl(url)
    if (!normalized) return null

    const apps = await applicationsStorage.getAll()
    const matches = apps.filter(
      (app) => normalizeJobUrl(app.job.url) === normalized,
    )
    if (matches.length === 0) return null
    return (
      matches.find(
        (app) => app.status !== 'applied' && app.status !== 'skipped',
      ) ?? matches[0]
    )
  },

  /** Keep one application for a job URL; delete the rest (fixes Filled + Applied twins). */
  removeDuplicatesForJobUrl: async (
    url: string,
    keepAppId: string,
  ): Promise<number> => {
    const normalized = normalizeJobUrl(url)
    if (!normalized) return 0

    const apps = await applicationsStorage.getAllRaw()
    let removed = 0
    for (const app of apps) {
      if (app.id === keepAppId) continue
      if (normalizeJobUrl(app.job.url) !== normalized) continue
      await applicationsStorage.remove(app.id)
      removed++
    }
    return removed
  },

  /** Prefer Applied over Filled/etc. when the same job URL appears twice. */
  collapseDuplicates: async (apps?: Array<JobApplication>): Promise<number> => {
    const list = apps ?? (await applicationsStorage.getAllRaw())
    const byUrl = new Map<string, Array<JobApplication>>()
    for (const app of list) {
      const key = normalizeJobUrl(app.job.url)
      if (!key) continue
      const group = byUrl.get(key) ?? []
      group.push(app)
      byUrl.set(key, group)
    }

    const rank = (status: JobApplication['status']): number => {
      switch (status) {
        case 'applied':
          return 0
        case 'filled':
          return 1
        case 'reviewing':
          return 2
        case 'filling':
          return 3
        case 'failed':
          return 4
        case 'detected':
          return 5
        case 'saved':
          return 6
        case 'skipped':
          return 7
        default:
          return 9
      }
    }

    let removed = 0
    for (const group of byUrl.values()) {
      if (group.length < 2) continue
      group.sort((a, b) => {
        const r = rank(a.status) - rank(b.status)
        if (r !== 0) return r
        const at = a.appliedAt ? Date.parse(a.appliedAt) : 0
        const bt = b.appliedAt ? Date.parse(b.appliedAt) : 0
        return bt - at
      })
      const keep = group[0]
      for (const extra of group.slice(1)) {
        await applicationsStorage.remove(extra.id)
        removed++
      }
      void keep
    }
    return removed
  },

  getAllRaw: async (): Promise<Array<JobApplication>> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      applications: {
        $: { where: { userId }, order: { updatedAt: 'desc' } },
      },
    })
    return data.applications.map(rowToApp)
  },

  add: async (application: JobApplication): Promise<void> => {
    const userId = await getUserId()
    const settings = await settingsStorage.get()

    // Enforce the history cap: delete the oldest record when at limit
    const { data: existing } = await db.queryOnce({
      applications: {
        $: { where: { userId }, order: { updatedAt: 'asc' } },
      },
    })
    if (existing.applications.length >= settings.maxHistoryItems) {
      const oldest = existing.applications[0]
      if (oldest) {
        await db.transact(db.tx.applications[oldest.id].delete())
      }
    }

    await db.transact(
      db.tx.applications[instantId()].update({
        userId,
        appId: application.id,
        job: application.job as unknown as Record<string, unknown>,
        status: application.status,
        appliedAt: application.appliedAt ?? null,
        notes: application.notes ?? null,
        coverLetter: application.coverLetter ?? null,
        aiGeneratedAnswers:
          (application.aiGeneratedAnswers as Record<string, unknown>) ?? null,
        error: application.error ?? null,
        updatedAt: Date.now(),
      }),
    )
  },

  update: async (
    appId: string,
    partial: Partial<JobApplication>,
  ): Promise<void> => {
    const { data } = await db.queryOnce({
      applications: { $: { where: { appId } } },
    })
    const existing = data.applications[0]
    if (!existing) return

    const merged = { ...rowToApp(existing), ...partial }
    await db.transact(
      db.tx.applications[existing.id].update({
        appId: merged.id,
        job: merged.job as unknown as Record<string, unknown>,
        status: merged.status,
        appliedAt: merged.appliedAt ?? null,
        notes: merged.notes ?? null,
        coverLetter: merged.coverLetter ?? null,
        aiGeneratedAnswers:
          (merged.aiGeneratedAnswers as Record<string, unknown>) ?? null,
        error: merged.error ?? null,
        updatedAt: Date.now(),
      }),
    )
  },

  remove: async (appId: string): Promise<void> => {
    const { data } = await db.queryOnce({
      applications: { $: { where: { appId } } },
    })
    const existing = data.applications[0]
    if (existing) {
      await db.transact(db.tx.applications[existing.id].delete())
    }
  },

  clear: async (): Promise<void> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      applications: { $: { where: { userId } } },
    })
    if (data.applications.length === 0) return
    await db.transact(
      data.applications.map((a) => db.tx.applications[a.id].delete()),
    )
  },
}

// ────────────────────────────────────────────────────────────────────────────
// Active Tab Mappings (ephemeral — stays in browser.storage.local)
//
// This maps tabId → { applicationId, frameId } so the background SW knows
// which application is active on each tab. Tab-scoped by nature; cleared on
// tab close / page navigation. InstantDB has no concept of tab IDs, so this
// stays local.
// ────────────────────────────────────────────────────────────────────────────

export interface ActiveAppMapping {
  applicationId: string
  frameId: number
  /** Scraped job details — kept ephemeral until autofill actually runs */
  job: JobListing
}

export const activeApplicationsStorage = {
  get: async (tabId: number): Promise<ActiveAppMapping | null> => {
    const map = await browser.storage.local.get('ojk_active_applications')
    return (
      (
        map['ojk_active_applications'] as
          | Record<number, ActiveAppMapping>
          | undefined
      )?.[tabId] ?? null
    )
  },
  set: async (tabId: number, mapping: ActiveAppMapping): Promise<void> => {
    const result = await browser.storage.local.get('ojk_active_applications')
    const map =
      (result['ojk_active_applications'] as Record<number, ActiveAppMapping>) ??
      {}
    map[tabId] = mapping
    await browser.storage.local.set({ ojk_active_applications: map })
  },
  remove: async (tabId: number): Promise<void> => {
    const result = await browser.storage.local.get('ojk_active_applications')
    const map = result['ojk_active_applications'] as
      | Record<number, ActiveAppMapping>
      | undefined
    if (map) {
      delete map[tabId]
      await browser.storage.local.set({ ojk_active_applications: map })
    }
  },
  clear: () => browser.storage.local.remove('ojk_active_applications'),
}
