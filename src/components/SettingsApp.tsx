import React, { useEffect, useRef, useState } from 'react'

import { id as instantId } from '@instantdb/react'

import SignIn from '@/components/SignIn'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { db } from '@/lib/db'
import { DEMO_PROFILE } from '@/lib/demo-profile'
import { extractTextFromPdf } from '@/lib/pdf'
import { DEFAULT_SETTINGS } from '@/types/settings'

import type { UserProfile } from '@/types/profile'
import type { UserSettings } from '@/types/settings'

const POPULAR_MODELS: Record<
  string,
  Array<{ value: string; label: string }>
> = {
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Recommended)' },
    { value: 'gpt-4o', label: 'GPT-4o (High Accuracy)' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recommended)' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  openrouter: [
    {
      value: 'google/gemini-2.5-flash',
      label: 'Gemini 2.5 Flash via OpenRouter (Recommended)',
    },
    {
      value: 'meta-llama/llama-3-8b-instruct:free',
      label: 'Llama 3 8B Instruct (Free)',
    },
    { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
    { value: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku' },
  ],
}

export default function SettingsApp({
  embedded = false,
  onBack,
}: {
  /** Compact layout for the side panel (no full-page chrome). */
  embedded?: boolean
  /** Shown in embedded mode to return to the main panel view. */
  onBack?: () => void
}) {
  const { isLoading: isAuthLoading, user, error: authError } = db.useAuth()
  const [activeTab, setActiveTab] = useState<'profile' | 'ai'>('profile')

  // ── Reactive cloud data ────────────────────────────────────────────────────
  const { isLoading: isDataLoading, data } = db.useQuery(
    user
      ? {
          profiles: {
            $: { where: { userId: user.id } },
            resumeFile: {}, // Fetch linked PDF/Text file
          },
          settings: {
            $: { where: { userId: user.id } },
          },
        }
      : null,
  )

  const cloudProfile = data?.profiles[0]
  const cloudSettings = data?.settings[0]

  // ── Local form state ───────────────────────────────────────────────────────
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const initialized = useRef(false)

  // Dropdown states for models presets
  const [selectedModelOption, setSelectedModelOption] = useState('custom')
  const [customModel, setCustomModel] = useState('')
  const [search, setSearch] = useState('')

  // Dynamic models list fetched from API
  const [fetchedModels, setFetchedModels] = useState<
    Array<{ value: string; label: string }>
  >([])
  const [fetchingModels, setFetchingModels] = useState(false)

  const filteredItems = React.useMemo(() => {
    const list = [
      ...fetchedModels,
      { value: 'custom', label: 'Custom Model...' },
    ]
    if (!search) return list
    const searchLower = search.toLowerCase()
    return list.filter(
      (item) =>
        item.label.toLowerCase().includes(searchLower) ||
        item.value.toLowerCase().includes(searchLower),
    )
  }, [fetchedModels, search])

  // Track if we should show the manual text editor for resumeText
  const [showTextEditor, setShowTextEditor] = useState(false)

  const [status, setStatus] = useState<{
    text: string
    type: 'success' | 'error' | 'info'
  } | null>(null)

  useEffect(() => {
    if (!isAuthLoading && !user) {
      // Clear forms on logout
      setProfile(null)
      setSettings(null)
      initialized.current = false
    }
  }, [isAuthLoading, user])

  useEffect(() => {
    if (user && !isDataLoading && !initialized.current) {
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
  }, [isDataLoading, cloudProfile, cloudSettings, user])

  // Fetch live models list dynamically from API keys
  useEffect(() => {
    if (!settings) return

    const provider = settings.ai.provider
    const apiKey = settings.ai.apiKey
    const controller = new AbortController()

    const fetchLiveModels = async () => {
      setFetchingModels(true)
      try {
        if (provider === 'openrouter') {
          const resp = await fetch('https://openrouter.ai/api/v1/models', {
            signal: controller.signal,
          })
          const json = await resp.json()
          const list = json.data.map((m: any) => ({
            value: m.id,
            label: m.name || m.id,
          }))
          setFetchedModels(list)
        } else if (provider === 'openai' && apiKey) {
          const resp = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
          })
          const json = await resp.json()
          const list = json.data
            .filter((m: any) => m.id.startsWith('gpt-') || m.id.startsWith('o'))
            .map((m: any) => ({ value: m.id, label: m.id }))
          setFetchedModels(list)
        } else if (provider === 'gemini' && apiKey) {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
            { signal: controller.signal },
          )
          const json = await resp.json()
          const list = json.models
            .filter((m: any) => m.name.startsWith('models/gemini'))
            .map((m: any) => {
              const shortId = m.name.replace('models/', '')
              return { value: shortId, label: m.displayName || shortId }
            })
          setFetchedModels(list)
        } else {
          setFetchedModels(POPULAR_MODELS[provider] || [])
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[OpenJobKit] Failed to fetch live models:', err)
          setFetchedModels(POPULAR_MODELS[provider] || [])
        }
      } finally {
        setFetchingModels(false)
      }
    }

    void fetchLiveModels()

    return () => {
      controller.abort()
    }
  }, [settings?.ai.provider, settings?.ai.apiKey])

  // Synchronize local dropdown state with settings and fetched models
  useEffect(() => {
    if (settings) {
      const matchedPreset = fetchedModels.find(
        (p) => p.value === settings.ai.model,
      )
      if (matchedPreset) {
        setSelectedModelOption(settings.ai.model)
      } else if (settings.ai.model) {
        setSelectedModelOption('custom')
        setCustomModel(settings.ai.model)
      }
    }
  }, [settings?.ai.provider, settings?.ai.model, fetchedModels])

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
    if (!profile || !user) return
    try {
      const recordId = cloudProfile?.id ?? instantId()
      await db.transact(
        db.tx.profiles[recordId].update({
          userId: user.id,
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

  // ── Resume File Upload Handler ─────────────────────────────────────────────

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user || !profile) return

    showStatus('Uploading & processing resume...', 'info')
    try {
      // 1. Upload the PDF/Text file to InstantDB Storage
      const path = `resumes/${user.id}/${Date.now()}_${file.name}`
      const uploadResp = await db.storage.uploadFile(path, file)

      // 2. Parse text client-side
      let extractedText = ''
      if (file.type === 'application/pdf') {
        const buffer = await file.arrayBuffer()
        extractedText = await extractTextFromPdf(buffer)
      } else {
        extractedText = await file.text()
      }

      if (!extractedText.trim()) {
        throw new Error(
          'Extracted text is empty. Please check your file content.',
        )
      }

      // 3. Save the text to profile and link the file in the database
      const profileRecordId = cloudProfile?.id ?? instantId()
      const updatedProfile = { ...profile, resumeText: extractedText }

      await db.transact([
        db.tx.profiles[profileRecordId]
          .update({
            userId: user.id,
            data: updatedProfile as unknown as Record<string, unknown>,
            updatedAt: Date.now(),
          })
          .link({ resumeFile: uploadResp.data.id }),
      ])

      setProfile(updatedProfile)
      showStatus('Resume uploaded & parsed successfully!', 'success')
    } catch (err) {
      console.error('[OpenJobKit] Resume process error:', err)
      showStatus(`Error processing resume: ${String(err)}`, 'error')
    }
  }

  const handleRemoveResume = async () => {
    if (!cloudProfile || !cloudProfile.resumeFile || !profile) return
    showStatus('Unlinking and deleting resume file...', 'info')
    try {
      const profileRecordId = cloudProfile.id
      const resumeFileId = cloudProfile.resumeFile.id

      // Unlink from profile and delete the file entity
      await db.transact([
        db.tx.profiles[profileRecordId].unlink({ resumeFile: resumeFileId }),
        db.tx.$files[resumeFileId].delete(),
      ])

      showStatus('Resume file deleted!', 'success')
    } catch (err) {
      showStatus(`Failed to delete resume: ${String(err)}`, 'error')
    }
  }

  // ── AI Settings handlers ───────────────────────────────────────────────────

  const handleAIChange = (key: keyof UserSettings['ai'], val: unknown) => {
    if (!settings) return
    setSettings({ ...settings, ai: { ...settings.ai, [key]: val } })
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings || !user) return
    try {
      const recordId = cloudSettings?.id ?? instantId()
      await db.transact(
        db.tx.settings[recordId].update({
          userId: user.id,
          data: settings as unknown as Record<string, unknown>,
          updatedAt: Date.now(),
        }),
      )
      showStatus('Settings saved!', 'success')
    } catch (err) {
      showStatus(`Failed to save settings: ${String(err)}`, 'error')
    }
  }

  const handleSignOut = async () => {
    try {
      await db.auth.signOut()
    } catch (err) {
      showStatus(`Failed to sign out: ${String(err)}`, 'error')
    }
  }

  // ── Render States ──────────────────────────────────────────────────────────

  if (isAuthLoading) {
    return (
      <div
        className={`flex items-center justify-center bg-[#0f0f13] text-sm text-white/50 ${embedded ? 'min-h-40 py-8' : 'min-h-screen'}`}
      >
        Loading authentication state…
      </div>
    )
  }

  if (authError) {
    return (
      <div
        className={`flex items-center justify-center bg-[#0f0f13] text-sm text-red-400 ${embedded ? 'min-h-40 py-8' : 'min-h-screen'}`}
      >
        Auth Error: {authError.message}
      </div>
    )
  }

  if (!user) {
    return <SignIn compact={embedded} />
  }

  if (isDataLoading || !profile || !settings) {
    return (
      <div
        className={`flex items-center justify-center bg-[#0f0f13] text-sm text-white/50 ${embedded ? 'min-h-40 py-8' : 'min-h-screen'}`}
      >
        Loading user data…
      </div>
    )
  }

  return (
    <div
      className={`bg-[#0f0f13] font-[Inter,sans-serif] text-white ${embedded ? 'flex min-h-full flex-col' : 'min-h-screen'}`}
    >
      {!embedded && (
        <>
          <div className="absolute top-0 right-0 -z-10 h-[500px] w-[500px] rounded-full bg-indigo-500/5 blur-[120px]" />
          <div className="absolute bottom-0 left-0 -z-10 h-[500px] w-[500px] rounded-full bg-violet-500/5 blur-[120px]" />
        </>
      )}

      <div
        className={
          embedded ? 'flex min-h-full flex-col' : 'mx-auto max-w-5xl px-6 py-12'
        }
      >
        {/* Header */}
        <div
          className={`flex items-center gap-3 ${embedded ? 'sticky top-0 z-10 border-b border-white/10 bg-[#0f0f13]/95 px-4 py-3 backdrop-blur' : 'mb-10 gap-4'}`}
        >
          {embedded && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              ← Back
            </button>
          )}
          {!embedded && (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-xl font-bold shadow-lg shadow-violet-500/10">
              J
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1
              className={`font-bold tracking-tight ${embedded ? 'text-sm' : 'text-2xl'}`}
            >
              {embedded ? 'Settings' : 'OpenJobKit'}
            </h1>
            <p className="truncate text-xs text-white/40">
              {embedded ? (
                user.email
              ) : (
                <>
                  Logged in as{' '}
                  <span className="font-semibold text-violet-400">
                    {user.email}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Connected
          </div>
        </div>

        {/* Status Toast */}
        {status && (
          <div
            className={`z-50 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur transition-all duration-300 ${
              embedded ? 'mx-4 mt-3' : 'fixed top-6 right-6'
            } ${
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

        <div
          className={
            embedded
              ? 'flex flex-1 flex-col gap-3 px-4 py-4'
              : 'grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]'
          }
        >
          {/* Navigation */}
          <nav
            className={
              embedded
                ? 'flex gap-1 rounded-xl border border-white/8 bg-white/5 p-1'
                : 'flex flex-col gap-1'
            }
          >
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-2 rounded-lg text-sm font-medium transition-all ${
                embedded
                  ? 'flex-1 justify-center px-3 py-2'
                  : 'gap-3 rounded-xl px-4 py-3'
              } ${
                activeTab === 'profile'
                  ? 'bg-white/10 font-semibold text-white shadow-inner'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span>👤</span> {embedded ? 'Profile' : 'Resume Profile'}
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex items-center gap-2 rounded-lg text-sm font-medium transition-all ${
                embedded
                  ? 'flex-1 justify-center px-3 py-2'
                  : 'gap-3 rounded-xl px-4 py-3'
              } ${
                activeTab === 'ai'
                  ? 'bg-white/10 font-semibold text-white shadow-inner'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span>🤖</span> AI
            </button>

            {!embedded && (
              <>
                <button
                  onClick={handleSignOut}
                  className="mt-6 flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-red-400 transition-all hover:bg-red-500/10"
                >
                  <span>🚪</span> Sign Out
                </button>

                <div className="mt-8 rounded-xl border border-violet-500/15 bg-violet-500/5 p-3 text-xs text-violet-300/70">
                  <p className="font-semibold text-violet-200">
                    🛡️ Secured Cloud Store
                  </p>
                  <p className="mt-1 text-white/40">
                    Your AI settings, keys, and resume profile are locked in our
                    secure database, accessible only by you.
                  </p>
                </div>
              </>
            )}
          </nav>

          {/* Tab Panes */}
          <div
            className={
              embedded
                ? 'rounded-xl border border-white/8 bg-white/5 p-4'
                : 'rounded-2xl border border-white/8 bg-white/5 p-6 backdrop-blur'
            }
          >
            {/* ── Profile Tab ─────────────────────────────────────────────── */}
            {activeTab === 'profile' && (
              <form onSubmit={handleSaveProfile} className="space-y-6">
                <div>
                  <h2 className="text-lg leading-none font-semibold">
                    Resume Profile
                  </h2>
                  <p className="mt-1 text-sm text-white/40">
                    Upload your resume file. AI parses it instantly for form
                    filling context.
                  </p>
                </div>

                {/* File Upload Section */}
                <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
                  <span className="text-xs font-semibold text-white/60">
                    Resume File (PDF or TXT)
                  </span>

                  {cloudProfile?.resumeFile ? (
                    <div className="flex items-center gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                      <span className="text-xl">📄</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-violet-300">
                          {cloudProfile.resumeFile.path.split('/').pop() ||
                            'Resume file'}
                        </p>
                        <a
                          href={cloudProfile.resumeFile.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-block text-[10px] text-white/40 underline hover:text-white/60"
                        >
                          View uploaded file
                        </a>
                      </div>
                      <button
                        type="button"
                        onClick={handleRemoveResume}
                        className="rounded-lg bg-red-500/10 p-2 text-xs font-semibold text-red-400 transition-all hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="relative flex flex-col items-center justify-center rounded-lg border border-dashed border-white/20 px-6 py-8 transition-all hover:border-violet-500/40 hover:bg-white/8">
                      <input
                        type="file"
                        accept=".pdf,.txt"
                        onChange={handleResumeUpload}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                      <span className="mb-2 text-2xl">📁</span>
                      <span className="text-xs font-medium text-white/80">
                        Click or drag PDF or TXT resume here
                      </span>
                      <span className="mt-1 text-[10px] text-white/40">
                        Max size 5MB
                      </span>
                    </div>
                  )}

                  {/* Extract Preview toggle */}
                  {profile.resumeText && (
                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        onClick={() => setShowTextEditor(!showTextEditor)}
                        className="text-[11px] text-violet-400 hover:underline"
                      >
                        {showTextEditor
                          ? 'Hide plain text preview'
                          : 'View extracted plain text'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Hidden Textarea for manual text corrections */}
                {showTextEditor && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      Extracted Resume Text (Correct manually if needed)
                    </label>
                    <textarea
                      rows={6}
                      value={profile.resumeText}
                      onChange={(e) =>
                        handleProfileChange('resumeText', e.target.value)
                      }
                      required
                      placeholder="Upload a resume above or paste your text resume manually..."
                      className="w-full rounded-xl border border-white/10 bg-[#16161c] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                )}

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
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
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
                    className="w-full rounded-xl border border-white/10 bg-[#16161c] px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-white/60">
                    API Key
                  </label>
                  <input
                    type="password"
                    placeholder={
                      settings.ai.provider === 'openrouter'
                        ? 'sk-or-...'
                        : settings.ai.provider === 'gemini'
                          ? 'AIzaSy...'
                          : 'sk-...'
                    }
                    value={settings.ai.apiKey}
                    onChange={(e) => handleAIChange('apiKey', e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-white/60">
                    Model Preset
                  </label>
                  <Combobox
                    value={selectedModelOption}
                    onValueChange={(val) => {
                      if (!val) return
                      setSelectedModelOption(val)
                      if (val !== 'custom') {
                        handleAIChange('model', val)
                      } else {
                        handleAIChange('model', customModel)
                      }
                    }}
                    onInputValueChange={(val) => {
                      setSearch(val)
                    }}
                  >
                    <ComboboxInput
                      placeholder={
                        fetchingModels
                          ? 'Loading live models...'
                          : 'Select or search a model...'
                      }
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>No matching models found.</ComboboxEmpty>
                      <ComboboxList>
                        {filteredItems.map((item) => (
                          <ComboboxItem key={item.value} value={item.value}>
                            {item.label}
                          </ComboboxItem>
                        ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>

                  {selectedModelOption === 'custom' && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                        Custom Model Name
                      </label>
                      <input
                        type="text"
                        value={customModel}
                        onChange={(e) => {
                          const val = e.target.value
                          setCustomModel(val)
                          handleAIChange('model', val)
                        }}
                        required
                        placeholder={
                          settings.ai.provider === 'openrouter'
                            ? 'e.g. google/gemini-2.5-flash'
                            : settings.ai.provider === 'gemini'
                              ? 'e.g. gemini-2.5-flash'
                              : 'e.g. gpt-4o-mini'
                        }
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
                      />
                    </div>
                  )}
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

          {embedded && (
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-xl px-3 py-2 text-left text-xs font-medium text-red-400 transition-all hover:bg-red-500/10"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
