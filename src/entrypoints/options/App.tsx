import React, { useEffect, useRef, useState } from 'react'

import { id as instantId } from '@instantdb/react'

import SignIn from '@/components/SignIn'
import { db } from '@/lib/db'
import { DEMO_PROFILE } from '@/lib/demo-profile'
import { extractTextFromPdf } from '@/lib/pdf'
import { DEFAULT_SETTINGS } from '@/types/settings'

import type { UserProfile } from '@/types/profile'
import type { UserSettings } from '@/types/settings'

export default function App() {
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

  if (isDataLoading || !profile || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] text-sm text-white/50">
        Loading user data…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f0f13] font-[Inter,sans-serif] text-white">
      {/* Background decorations */}
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
            <p className="text-xs text-white/40">
              Logged in as{' '}
              <span className="font-semibold text-violet-400">
                {user.email}
              </span>
            </p>
          </div>
          {/* Live sync indicator */}
          <div className="ml-auto flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Connected
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

            <button
              onClick={handleSignOut}
              className="mt-6 flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-red-400 transition-all hover:bg-red-500/10"
            >
              <span>🚪</span> Sign Out
            </button>

            {/* Sync status callout */}
            <div className="mt-8 rounded-xl border border-violet-500/15 bg-violet-500/5 p-3 text-xs text-violet-300/70">
              <p className="font-semibold text-violet-200">
                🛡️ Secured Cloud Store
              </p>
              <p className="mt-1 text-white/40">
                Your AI settings, keys, and resume profile are locked in our
                secure database, accessible only by you.
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
                    <option value="openai">OpenAI / OpenRouter</option>
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
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-violet-500 focus:outline-none"
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
