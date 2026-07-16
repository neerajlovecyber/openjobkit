// Background Service Worker — OpenJobKit Orchestration Hub
//
// Responsibilities:
//   1. Listen for DETECT_JOB messages from content scripts
//   2. Call the AI API with user profile + job details
//   3. Return filled answers back to the content script
//   4. Track applications in chrome.storage.local

import { createAIClient } from '@/lib/ai/client'
import {
  SYSTEM_PROMPT,
  buildFillPrompt,
  buildCoverLetterPrompt,
} from '@/lib/ai/prompts'
import { onMessage } from '@/lib/messaging'
import {
  profileStorage,
  settingsStorage,
  applicationsStorage,
  activeApplicationsStorage,
} from '@/lib/storage'

import type { JobApplication } from '@/types/job'
import type { FormField } from '@/types/messages'
import type { UserProfile } from '@/types/profile'

export default defineBackground(() => {
  console.log('[OpenJobKit] Background service worker started', {
    id: browser.runtime.id,
  })

  const cleanup = onMessage({
    // ── Content script detected a job form ──────────────────────────────────
    DETECT_JOB: async (msg, sender) => {
      const { job } = msg.payload
      const settings = await settingsStorage.get()

      if (!settings.trackApplications) return

      // Create a new application record
      const application: JobApplication = {
        id: crypto.randomUUID(),
        job: {
          ...job,
          id: crypto.randomUUID(),
          detectedAt: new Date().toISOString(),
        },
        status: 'detected',
      }

      await applicationsStorage.add(application)
      console.log('[OpenJobKit] Detected job:', job.title, 'at', job.company)

      // Store the active application mapping for this tab and frame
      if (sender.tab?.id) {
        await activeApplicationsStorage.set(sender.tab.id, {
          applicationId: application.id,
          frameId: sender.frameId ?? 0,
        })
      }

      return { applicationId: application.id }
    },

    // ── Content script requests AI fill for a job form ──────────────────────
    FILL_JOB: async (msg, _sender) => {
      const { applicationId, fields } = msg.payload

      const [profile, settings, application] = await Promise.all([
        profileStorage.get(),
        settingsStorage.get(),
        applicationsStorage.getById(applicationId),
      ])

      if (!application) {
        throw new Error(`Application ${applicationId} not found.`)
      }
      if (!settings.ai.apiKey) {
        throw new Error(
          'No AI API key configured. Please add your API key in Settings.',
        )
      }

      await applicationsStorage.update(applicationId, { status: 'filling' })

      try {
        const aiClient = createAIClient(settings.ai)

        // Generate field answers
        const userPrompt = buildFillPrompt(profile, application.job, fields)
        const response = await aiClient.complete(SYSTEM_PROMPT, userPrompt)

        // Parse JSON response
        const answers = JSON.parse(response.content) as Record<string, string>

        // Generate cover letter if there's a cover letter field
        const hasCoverLetterField = fields.some(
          (f) =>
            f.label.toLowerCase().includes('cover letter') ||
            f.id.toLowerCase().includes('cover'),
        )

        let coverLetter: string | undefined
        if (hasCoverLetterField) {
          const clPrompt = buildCoverLetterPrompt(profile, application.job)
          const clResponse = await aiClient.complete(SYSTEM_PROMPT, clPrompt)
          coverLetter = clResponse.content
        }

        await applicationsStorage.update(applicationId, {
          status: 'filled',
          aiGeneratedAnswers: answers,
          coverLetter,
        })

        return { answers, coverLetter }
      } catch (error) {
        await applicationsStorage.update(applicationId, {
          status: 'failed',
          error: String(error),
        })
        throw error
      }
    },

    // ── User submitted the application ──────────────────────────────────────
    SUBMIT_JOB: async (msg) => {
      const { applicationId } = msg.payload
      await applicationsStorage.update(applicationId, {
        status: 'applied',
        appliedAt: new Date().toISOString(),
      })
      console.log('[OpenJobKit] Application submitted:', applicationId)
    },

    // ── Trigger fill on the active tab's detected form frame ────────────────
    TRIGGER_FILL_ACTIVE_TAB: async () => {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id) return

      const active = await activeApplicationsStorage.get(tab.id)
      if (!active) {
        console.warn(
          '[OpenJobKit] No active application detected for tab:',
          tab.id,
        )
        return
      }

      // Send TRIGGER_FILL to the content script in the correct frame
      await browser.tabs.sendMessage(
        tab.id,
        {
          type: 'TRIGGER_FILL',
          payload: { applicationId: active.applicationId },
        },
        { frameId: active.frameId },
      )
    },

    // ── Popup / Side panel requesting application list ───────────────────────
    GET_APPLICATIONS: async () => {
      const applications = await applicationsStorage.getAll()
      return { type: 'APPLICATIONS_RESPONSE', payload: { applications } }
    },
  })

  // Cleanup active mappings when tab is closed or reloaded
  browser.tabs.onRemoved.addListener((tabId) => {
    void activeApplicationsStorage.remove(tabId)
  })

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void activeApplicationsStorage.remove(tabId)
    }
  })

  // Cleanup listeners on extension unload (good practice)
  browser.runtime.onSuspend?.addListener(cleanup)
})
