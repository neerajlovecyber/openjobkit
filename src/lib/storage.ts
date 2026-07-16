// Typed wrappers around chrome.storage.local
// All reads/writes go through these helpers to ensure type safety and
// consistent error handling across background, popup, content, and options.

import { DEFAULT_SETTINGS } from '@/types/settings'

import type { JobApplication } from '@/types/job'
import type { UserProfile } from '@/types/profile'
import type { UserSettings } from '@/types/settings'

// ────────────────────────────────────────────────────────────────────────────
// Storage Keys
// ────────────────────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  PROFILE: 'ojk_profile',
  SETTINGS: 'ojk_settings',
  APPLICATIONS: 'ojk_applications',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

// ────────────────────────────────────────────────────────────────────────────
// Generic read / write
// ────────────────────────────────────────────────────────────────────────────

async function storageGet<T>(key: StorageKey): Promise<T | null> {
  const result = await browser.storage.local.get(key)
  return (result[key] as T) ?? null
}

async function storageSet<T>(key: StorageKey, value: T): Promise<void> {
  await browser.storage.local.set({ [key]: value })
}

async function storageRemove(key: StorageKey): Promise<void> {
  await browser.storage.local.remove(key)
}

// ────────────────────────────────────────────────────────────────────────────
// Profile
// ────────────────────────────────────────────────────────────────────────────

export const profileStorage = {
  get: () => storageGet<UserProfile>(STORAGE_KEYS.PROFILE),
  set: (profile: UserProfile) => storageSet(STORAGE_KEYS.PROFILE, profile),
  update: async (partial: Partial<UserProfile>) => {
    const existing = await profileStorage.get()
    if (!existing)
      throw new Error('No profile found. Please set up your profile first.')
    await profileStorage.set({ ...existing, ...partial })
  },
  clear: () => storageRemove(STORAGE_KEYS.PROFILE),
}

// ────────────────────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────────────────────

export const settingsStorage = {
  get: async (): Promise<UserSettings> => {
    const stored = await storageGet<UserSettings>(STORAGE_KEYS.SETTINGS)
    // Merge with defaults so new settings fields are always populated
    return { ...DEFAULT_SETTINGS, ...stored }
  },
  set: (settings: UserSettings) => storageSet(STORAGE_KEYS.SETTINGS, settings),
  update: async (partial: Partial<UserSettings>) => {
    const existing = await settingsStorage.get()
    await settingsStorage.set({ ...existing, ...partial })
  },
  reset: () => storageSet(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS),
}

// ────────────────────────────────────────────────────────────────────────────
// Job Applications
// ────────────────────────────────────────────────────────────────────────────

export const applicationsStorage = {
  getAll: async (): Promise<Array<JobApplication>> => {
    return (
      (await storageGet<Array<JobApplication>>(STORAGE_KEYS.APPLICATIONS)) ?? []
    )
  },

  getById: async (id: string): Promise<JobApplication | null> => {
    const all = await applicationsStorage.getAll()
    return all.find((a) => a.id === id) ?? null
  },

  add: async (application: JobApplication): Promise<void> => {
    const all = await applicationsStorage.getAll()
    const settings = await settingsStorage.get()

    // Prepend new application and respect max history cap
    const updated = [application, ...all].slice(0, settings.maxHistoryItems)
    await storageSet(STORAGE_KEYS.APPLICATIONS, updated)
  },

  update: async (
    id: string,
    partial: Partial<JobApplication>,
  ): Promise<void> => {
    const all = await applicationsStorage.getAll()
    const updated = all.map((a) => (a.id === id ? { ...a, ...partial } : a))
    await storageSet(STORAGE_KEYS.APPLICATIONS, updated)
  },

  remove: async (id: string): Promise<void> => {
    const all = await applicationsStorage.getAll()
    await storageSet(
      STORAGE_KEYS.APPLICATIONS,
      all.filter((a) => a.id !== id),
    )
  },

  clear: () => storageRemove(STORAGE_KEYS.APPLICATIONS),
}
