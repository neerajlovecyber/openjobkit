import React, { useEffect, useRef, useState } from 'react'

import { id as instantId } from '@instantdb/react'

import { db, USER_ID } from '@/lib/db'
import { DEMO_PROFILE } from '@/lib/demo-profile'
import { DEFAULT_SETTINGS } from '@/types/settings'

import type { UserProfile } from '@/types/profile'
import type { UserSettings } from '@/types/settings'

export default function App() {
  const [activeTab, setActiveTab] = useState<'profile' | 'ai'>('profile')

  // ── Reactive cloud data ────────────────────────────────────────────────────
  // db.useQuery() reads from InstantDB's local IndexedDB cache first (fast),
  // then syncs from cloud. Updates propagate to all open extension pages.
  const { isLoading, data } = db.useQuery({
    profiles: { $: { where: { userId: USER_ID } } },
    settings: { $: { where: { userId: USER_ID } } },
  })

  const cloudProfile = data?.profiles[0]
  const cloudSettings = data?.settings[0]

  // ── Local form state ───────────────────────────────────────────────────────
  // Initialized once from cloud data. After that, local state drives the form.
  // Saves are explicit (form submit) via db.transact().
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const initialized = useRef(false)

  const [status, setStatus] = useState<{
    text: string
    type: 'success' | 'error' | 'info'
  } | null>(null)

  useEffect(() => {
    if (!isLoading && !initialized.current) {
      initialized.current = true
      setProfile((cloudProfile?.data as unknown as UserProfile) ?? DEMO_PROFILE)
      const stored = cloudSettings?.data as unknown as UserSettings | null
      setSettings(
        stored
          ? {
              ...DEFAULT_SETTINGS,
              ...stored,
              ai: { ...DEFAULT_SETTINGS.ai, ...stored.ai },
              platforms: {
                ...DEFAULT_SETTINGS.platforms,
                ...stored.platforms,
              },
            }
          : DEFAULT_SETTINGS,
      )
    }
  }, [isLoading, cloudProfile, cloudSettings])

  function showStatus(
    text: string,
    type: 'success' | 'error' | 'info' = 'info',
  ) {
    setStatus({ text, type })
    setTimeout(() => setStatus(null), 5000)
  }

  // ── Profile handlers ───────────────────────────────────────────────────────

  const handleProfileChange = (key: keyof UserProfile, val: unknown) => {
    if (!profile) return
    setProfile({ ...profile, [key]: val })
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    try {
      const recordId = cloudProfile?.id ?? instantId()
      await db.transact(
        db.tx.profiles[recordId].update({
          userId: USER_ID,
          data: profile as unknown as Record<string, unknown>,
          updatedAt: Date.now(),
        }),
      )
      showStatus('Profile saved!', 'success')
    } catch (err) {
      showStatus(`Failed to save profile: ${String(err)}`, 'error')
    }
  }

  const handleLoadDemoProfile = () => {
    setProfile(DEMO_PROFILE)
    showStatus('Loaded demo profile. Click Save to apply.', 'info')
  }

  // ── AI Settings handlers ───────────────────────────────────────────────────

  const handleAIChange = (key: keyof UserSettings['ai'], val: unknown) => {
    if (!settings) return
    setSettings({ ...settings, ai: { ...settings.ai, [key]: val } })
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings) return
    try {
      const recordId = cloudSettings?.id ?? instantId()
      await db.transact(
        db.tx.settings[recordId].update({
          userId: USER_ID,
          data: settings as unknown as Record<string, unknown>,
          updatedAt: Date.now(),
        }),
      )
      showStatus('Settings saved!', 'success')
    } catch (err) {
      showStatus(`Failed to save settings: ${String(err)}`, 'error')
    }
  }

  if (isLoading || !profile || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] text-sm text-white/50">
        Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f0f13] font-[Inter,sans-serif] text-white">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 -z-10 h-[500px] w-[500px] rounded-full bg-indigo-500/5 blur-[120px]" />
      <div className="absolute bottom-0 left-0 -z-10 h-[500px] w-[500px] rounded-full bg-violet-500/5 blur-[120px]" />

      <div className="mx-auto max-w-5xl px-6 py-12">
        {/* Header */}
        <div className="mb-10 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-xl font-bold shadow-lg shadow-violet-500/10">
            J
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">OpenJobKit</h1>
            <p className="text-sm text-white/40">
              Manage your profile and AI configuration
            </p>
          </div>
          {/* Live sync indicator */}
          <div className="ml-auto flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Live sync active
          </div>
        </div>

        {/* Status Toast */}
        {status && (
          <div
            className={`fixed top-6 right-6 z-50 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur transition-all duration-300 ${
              status.type === 'success'
                ? 'border-green-500/20 bg-green-500/10 text-green-300'
                : status.type === 'error'
                  ? 'border-red-500/20 bg-red-500/10 text-red-300'
                  : 'border-blue-500/20 bg-blue-500/10 text-blue-300'
            }`}
          >
            {status.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
          {/* Navigation Sidebar */}
          <nav className="flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                activeTab === 'profile'
                  ? 'bg-white/10 font-semibold text-white shadow-inner'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span>👤</span> Resume Profile
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                activeTab === 'ai'
                  ? 'bg-white/10 font-semibold text-white shadow-inner'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span>🤖</span> AI Settings
            </button>

            {/* Sync status callout */}
            <div className="mt-4 rounded-xl border border-violet-500/15 bg-violet-500/5 p-3 text-xs text-violet-300/70">
              <p className="font-semibold text-violet-200">☁️ Always synced</p>
              <p className="mt-1 text-white/40">
                Your data syncs automatically to InstantDB in real-time. No
                manual backup needed.
              </p>
            </div>
          </nav>

          {/* Tab Panes */}
          <div className="rounded-2xl border border-white/8 bg-white/5 p-6 backdrop-blur">
            {/* ── Profile Tab ─────────────────────────────────────────────── */}
            {activeTab === 'profile' && (
              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div>
                  <h2 className="text-lg leading-none font-semibold">
                    Resume Profile
                  </h2>
                  <p className="mt-1 text-sm text-white/40">
                    This data is parsed locally to auto-fill common form fields.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      First Name
                    </label>
                    <input
                      type="text"
                      value={profile.firstName}
                      onChange={(e) =>
                        handleProfileChange('firstName', e.target.value)
                      }
                      required
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={profile.lastName}
                      onChange={(e) =>
                        handleProfileChange('lastName', e.target.value)
                      }
                      required
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      Email
                    </label>
                    <input
                      type="email"
                      value={profile.email}
                      onChange={(e) =>
                        handleProfileChange('email', e.target.value)
                      }
                      required
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      Phone
                    </label>
                    <input
                      type="text"
                      value={profile.phone}
                      onChange={(e) =>
                        handleProfileChange('phone', e.target.value)
                      }
                      required
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-white/60">
                    Location / City
                  </label>
                  <input
                    type="text"
                    value={profile.location}
                    onChange={(e) =>
                      handleProfileChange('location', e.target.value)
                    }
                    required
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      LinkedIn URL
                    </label>
                    <input
                      type="url"
                      value={profile.linkedinUrl || ''}
                      onChange={(e) =>
                        handleProfileChange('linkedinUrl', e.target.value)
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      GitHub URL
                    </label>
                    <input
                      type="url"
                      value={profile.githubUrl || ''}
                      onChange={(e) =>
                        handleProfileChange('githubUrl', e.target.value)
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-white/60">
                    Resume Plain Text (AI Context)
                  </label>
                  <textarea
                    rows={8}
                    value={profile.resumeText}
                    onChange={(e) =>
                      handleProfileChange('resumeText', e.target.value)
                    }
                    required
                    placeholder="Paste the full text of your resume here..."
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-4 border-t border-white/8 pt-6">
                  <button
                    type="submit"
                    className="cursor-pointer rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold shadow-md shadow-violet-500/10 transition-all hover:bg-violet-700 active:scale-[0.98]"
                  >
                    Save Profile
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadDemoProfile}
                    className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold transition-all hover:bg-white/10 active:scale-[0.98]"
                  >
                    Reset to Demo Profile
                  </button>
                </div>
              </form>
            )}

            {/* ── AI Settings Tab ──────────────────────────────────────────── */}
            {activeTab === 'ai' && (
              <form onSubmit={handleSaveSettings} className="space-y-6">
                <div>
                  <h2 className="text-lg leading-none font-semibold">
                    AI Configuration
                  </h2>
                  <p className="mt-1 text-sm text-white/40">
                    Set up the LLM engine to answer open-ended job questions.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-white/60">
                    AI Provider
                  </label>
                  <select
                    value={settings.ai.provider}
                    onChange={(e) =>
                      handleAIChange('provider', e.target.value as never)
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#16161c] px-3 py-2 text-sm text-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                  >
                    <option value="openai">OpenAI (ChatGPT)</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-white/60">
                    API Key
                  </label>
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={settings.ai.apiKey}
                    onChange={(e) => handleAIChange('apiKey', e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      Model Name
                    </label>
                    <input
                      type="text"
                      value={settings.ai.model}
                      onChange={(e) => handleAIChange('model', e.target.value)}
                      required
                      placeholder="e.g. gpt-4o-mini"
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      Temperature (Creativity)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={settings.ai.temperature}
                      onChange={(e) =>
                        handleAIChange(
                          'temperature',
                          parseFloat(e.target.value),
                        )
                      }
                      required
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="border-t border-white/8 pt-6">
                  <button
                    type="submit"
                    className="cursor-pointer rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold shadow-md shadow-violet-500/10 transition-all hover:bg-violet-700 active:scale-[0.98]"
                  >
                    Save Settings
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
