// User settings and preferences

export type AIProvider = 'openai' | 'openrouter' | 'gemini'

export type ApplyMode =
  | 'review' // AI fills, user reviews every field, then manually submits
  | 'semi-auto' // AI fills, user reviews summary, then auto-submits
  | 'auto' // AI fills and submits automatically (use with caution!)

export interface AISettings {
  provider: AIProvider
  apiKey: string // Stored in InstantDB (encrypted at rest)
  model: string // e.g. "gpt-4o", "gemini-2.5-pro"
  temperature: number // 0–1, default 0.3
  maxTokens: number
}

export interface PlatformSettings {
  linkedin: boolean
  indeed: boolean
  greenhouse: boolean
  lever: boolean
  workday: boolean
  ashby: boolean
  smartrecruiters: boolean
}

export interface UserSettings {
  // Core behavior
  applyMode: ApplyMode
  autoDetect: boolean // Automatically detect job forms
  showFloatingButton: boolean // Show fill button on job pages

  // AI
  ai: AISettings

  // Platform toggles
  platforms: PlatformSettings

  // Data management
  trackApplications: boolean // Log all applications to history
  maxHistoryItems: number // Cap history at N items

  // UI
  theme: 'light' | 'dark' | 'system'
  language: string // BCP-47 language tag, default "en"

  // Onboarding
  hasCompletedOnboarding: boolean
  installedAt: string // ISO timestamp
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 2000,
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  linkedin: true,
  indeed: true,
  greenhouse: true,
  lever: true,
  workday: false,
  ashby: false,
  smartrecruiters: false,
}

export const DEFAULT_SETTINGS: UserSettings = {
  applyMode: 'review',
  autoDetect: true,
  showFloatingButton: true,
  ai: DEFAULT_AI_SETTINGS,
  platforms: DEFAULT_PLATFORM_SETTINGS,
  trackApplications: true,
  maxHistoryItems: 500,
  theme: 'system',
  language: 'en',
  hasCompletedOnboarding: false,
  installedAt: new Date().toISOString(),
}
