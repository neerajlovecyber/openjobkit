import React, { useEffect, useState } from 'react'

import { DEMO_PROFILE } from '@/lib/demo-profile'
import {
  profileStorage,
  settingsStorage,
  applicationsStorage,
} from '@/lib/storage'

import type { UserProfile } from '@/types/profile'
import type { UserSettings } from '@/types/settings'

export default function App() {
  const [activeTab, setActiveTab] = useState<'profile' | 'ai' | 'sync'>(
    'profile',
  )
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [settings, setSettings] = useState<UserSettings | null>(null)

  const [status, setStatus] = useState<{
    text: string
    type: 'success' | 'error' | 'info'
  } | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)

  useEffect(() => {
    void loadData()
  }, [])

  async function loadData() {
    const [p, s] = await Promise.all([
      profileStorage.get(),
      settingsStorage.get(),
    ])

    setProfile(p)
    setSettings(s)
  }

  function showStatus(
    text: string,
    type: 'success' | 'error' | 'info' = 'info',
  ) {
    setStatus({ text, type })
    setTimeout(() => setStatus(null), 5000)
  }

  // ─── Profile handlers ──────────────────────────────────────────────────────

  const handleProfileChange = (key: keyof UserProfile, val: any) => {
    if (!profile) return
    setProfile({ ...profile, [key]: val })
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    try {
      await profileStorage.set(profile)
      showStatus('Profile settings saved successfully!', 'success')
    } catch (err) {
      showStatus(`Failed to save profile: ${String(err)}`, 'error')
    }
  }

  const handleLoadDemoProfile = () => {
    setProfile(DEMO_PROFILE)
    showStatus("Loaded Neeraj's demo profile. Click Save to apply.", 'info')
  }

  // ─── Settings handlers ─────────────────────────────────────────────────────

  const handleAIChange = (key: keyof UserSettings['ai'], val: any) => {
    if (!settings) return
    setSettings({
      ...settings,
      ai: { ...settings.ai, [key]: val },
    })
  }

  const handleSupabaseChange = (
    key: keyof UserSettings['supabase'],
    val: any,
  ) => {
    if (!settings) return
    setSettings({
      ...settings,
      supabase: { ...settings.supabase, [key]: val },
    })
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settings) return
    try {
      await settingsStorage.set(settings)
      showStatus('Settings saved successfully!', 'success')
    } catch (err) {
      showStatus(`Failed to save settings: ${String(err)}`, 'error')
    }
  }

  // ─── Supabase Sync Actions ─────────────────────────────────────────────────

  const handleTestSupabaseConnection = async () => {
    if (
      !settings?.supabase.supabaseUrl ||
      !settings?.supabase.supabaseAnonKey
    ) {
      showStatus('Please enter your Supabase URL and Anon Key.', 'error')
      return
    }
    setTestLoading(true)
    try {
      const { testSupabaseConnection } = await import('@/lib/supabase')
      const isConnected = await testSupabaseConnection(
        settings.supabase.supabaseUrl,
        settings.supabase.supabaseAnonKey,
      )
      if (isConnected) {
        showStatus('Connection successful! Supabase is reachable.', 'success')
      } else {
        showStatus('Connection failed. Please check your credentials.', 'error')
      }
    } catch (err) {
      showStatus(`Connection test error: ${String(err)}`, 'error')
    } finally {
      setTestLoading(false)
    }
  }

  const handlePushToCloud = async () => {
    if (
      !settings?.supabase.supabaseUrl ||
      !settings?.supabase.supabaseAnonKey
    ) {
      showStatus('Please configure your Supabase settings first.', 'error')
      return
    }
    if (
      !confirm(
        'Are you sure you want to push all local data to Supabase? This will overwrite your cloud database.',
      )
    ) {
      return
    }

    setSyncLoading(true)
    try {
      const { pushProfileToSupabase, pushApplicationToSupabase } =
        await import('@/lib/supabase')
      const url = settings.supabase.supabaseUrl
      const key = settings.supabase.supabaseAnonKey

      const localProfile = await profileStorage.get()
      const localApps = await applicationsStorage.getAll()

      // Sync Profile
      await pushProfileToSupabase(url, key, localProfile)

      // Sync Applications
      for (const app of localApps) {
        await pushApplicationToSupabase(url, key, app)
      }

      showStatus(
        `Successfully pushed profile and ${localApps.length} applications to Supabase.`,
        'success',
      )
    } catch (err) {
      showStatus(`Failed to push data to cloud: ${String(err)}`, 'error')
    } finally {
      setSyncLoading(false)
    }
  }

  const handlePullFromCloud = async () => {
    if (
      !settings?.supabase.supabaseUrl ||
      !settings?.supabase.supabaseAnonKey
    ) {
      showStatus('Please configure your Supabase settings first.', 'error')
      return
    }
    if (
      !confirm(
        'Are you sure you want to restore from Supabase? This will overwrite your local profile and history.',
      )
    ) {
      return
    }

    setSyncLoading(true)
    try {
      const { pullSupabaseData } = await import('@/lib/supabase')
      const { profile: cloudProfile, applications: cloudApps } =
        await pullSupabaseData(
          settings.supabase.supabaseUrl,
          settings.supabase.supabaseAnonKey,
        )

      if (cloudProfile) {
        await profileStorage.set(cloudProfile)
        setProfile(cloudProfile)
      }

      // Overwrite local applications list in local storage
      await browser.storage.local.set({ ojk_applications: cloudApps })

      showStatus(
        `Successfully restored profile and ${cloudApps.length} applications from Supabase.`,
        'success',
      )
    } catch (err) {
      showStatus(`Failed to restore data from cloud: ${String(err)}`, 'error')
    } finally {
      setSyncLoading(false)
    }
  }

  const sqlSetupScript = `-- 1. Create Profile Table
CREATE TABLE IF NOT EXISTS ojk_profile (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create Job Applications Table
CREATE TABLE IF NOT EXISTS ojk_applications (
  id VARCHAR(255) PRIMARY KEY,
  job JSONB NOT NULL,
  status VARCHAR(50) NOT NULL,
  applied_at VARCHAR(100),
  notes TEXT,
  cover_letter TEXT,
  ai_generated_answers JSONB,
  error TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Enable Row-Level Security (RLS) for privacy
ALTER TABLE ojk_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE ojk_applications ENABLE ROW LEVEL SECURITY;

-- 4. Enable public API access
CREATE POLICY "Allow all operations for everyone" ON ojk_profile FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for everyone" ON ojk_applications FOR ALL USING (true) WITH CHECK (true);`

  if (!profile || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0f13] text-sm text-white/50">
        Loading settings…
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
              Manage your profile, AI configurations, and cloud synchronization
            </p>
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
              onClick={() => setActiveTab('sync')}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                activeTab === 'sync'
                  ? 'bg-white/10 font-semibold text-white shadow-inner'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span>☁️</span> Cloud Database (Supabase)
            </button>
          </nav>

          {/* Tab Panes */}
          <div className="rounded-2xl border border-white/8 bg-white/5 p-6 backdrop-blur">
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
                    Reset to Neeraj's Resume (Demo)
                  </button>
                </div>
              </form>
            )}

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
                      handleAIChange('provider', e.target.value as any)
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

            {activeTab === 'sync' && (
              <form onSubmit={handleSaveSettings} className="space-y-6">
                <div>
                  <h2 className="text-lg leading-none font-semibold">
                    Cloud Synchronization (Supabase)
                  </h2>
                  <p className="mt-1 text-sm text-white/40">
                    Sync your profile data and application tracker to your
                    private Supabase database.
                  </p>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-4">
                  <input
                    type="checkbox"
                    id="syncToSupabase"
                    checked={settings.supabase.syncToSupabase}
                    onChange={(e) =>
                      handleSupabaseChange('syncToSupabase', e.target.checked)
                    }
                    className="h-4 w-4 rounded border-white/10 bg-[#16161c] text-violet-600 focus:ring-violet-500"
                  />
                  <label
                    htmlFor="syncToSupabase"
                    className="flex cursor-pointer flex-col"
                  >
                    <span className="text-sm font-semibold text-white">
                      Enable Supabase Cloud Synchronization
                    </span>
                    <span className="text-xs text-white/40">
                      When enabled, edits and applications are backed up
                      dynamically in the background.
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      Supabase URL
                    </label>
                    <input
                      type="text"
                      placeholder="https://your-project.supabase.co"
                      value={settings.supabase.supabaseUrl}
                      onChange={(e) =>
                        handleSupabaseChange('supabaseUrl', e.target.value)
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-white/60">
                      Supabase Anon/Publishable Key
                    </label>
                    <input
                      type="password"
                      placeholder="sb_publishable_..."
                      value={settings.supabase.supabaseAnonKey}
                      onChange={(e) =>
                        handleSupabaseChange('supabaseAnonKey', e.target.value)
                      }
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition-all placeholder:text-white/20 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4 text-xs text-yellow-200/90">
                  <p className="font-semibold">
                    ⚠️ Database Schema Setup Required
                  </p>
                  <p>
                    Before syncing, please run this script in your{' '}
                    <strong>Supabase SQL Editor</strong> dashboard to initialize
                    the profile and application database tables:
                  </p>
                  <pre className="mt-2 block max-h-40 overflow-y-auto rounded-lg border border-white/5 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-white/80 select-all">
                    {sqlSetupScript}
                  </pre>
                </div>

                <div className="flex flex-wrap gap-3 border-t border-white/8 pt-6">
                  <button
                    type="submit"
                    className="cursor-pointer rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold shadow-md shadow-violet-500/10 transition-all hover:bg-violet-700 active:scale-[0.98]"
                  >
                    Save Settings
                  </button>

                  <button
                    type="button"
                    onClick={handleTestSupabaseConnection}
                    disabled={testLoading}
                    className="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold transition-all hover:bg-white/10 active:scale-[0.98] disabled:opacity-50"
                  >
                    {testLoading ? 'Testing...' : '🔌 Test Connection'}
                  </button>

                  <button
                    type="button"
                    onClick={handlePushToCloud}
                    disabled={syncLoading}
                    className="cursor-pointer rounded-xl border border-amber-500/20 bg-amber-500/10 px-5 py-2.5 text-sm font-semibold text-amber-300 transition-all hover:bg-amber-500/20 active:scale-[0.98] disabled:opacity-50"
                  >
                    {syncLoading ? 'Syncing...' : '☁️ Push Local Data to Cloud'}
                  </button>

                  <button
                    type="button"
                    onClick={handlePullFromCloud}
                    disabled={syncLoading}
                    className="cursor-pointer rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-2.5 text-sm font-semibold text-emerald-300 transition-all hover:bg-emerald-500/20 active:scale-[0.98] disabled:opacity-50"
                  >
                    {syncLoading ? 'Syncing...' : '📥 Sync Cloud Data to Local'}
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
