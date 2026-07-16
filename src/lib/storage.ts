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

import type { JobApplication } from '@/types/job'
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

export const applicationsStorage = {
  getAll: async (): Promise<Array<JobApplication>> => {
    const userId = await getUserId()
    const { data } = await db.queryOnce({
      applications: {
        $: { where: { userId }, order: { updatedAt: 'desc' } },
      },
    })
    return data.applications.map(rowToApp)
  },

  getById: async (appId: string): Promise<JobApplication | null> => {
    const { data } = await db.queryOnce({
      applications: { $: { where: { appId } } },
    })
    return data.applications[0] ? rowToApp(data.applications[0]) : null
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
