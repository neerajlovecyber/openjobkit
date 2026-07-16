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

      await applicationsStorage.update(applicationId, { status: 'filling' })

      try {
        // 1. Resolve standard fields locally first using profile data (no API key required)
        const localAnswers = resolveFieldsLocally(profile, fields)

        // Find fields that still need AI answers
        const unresolvedFields = fields.filter((f) => !localAnswers[f.id])
        let answers = { ...localAnswers }
        let coverLetter: string | undefined

        // 2. If we have custom questions left and have an API key, use AI to answer them
        if (unresolvedFields.length > 0) {
          if (settings.ai.apiKey) {
            try {
              const aiClient = createAIClient(settings.ai)
              const userPrompt = buildFillPrompt(
                profile,
                application.job,
                unresolvedFields,
              )
              const response = await aiClient.complete(
                SYSTEM_PROMPT,
                userPrompt,
              )
              const aiAnswers = JSON.parse(response.content) as Record<
                string,
                string
              >
              answers = { ...answers, ...aiAnswers }
            } catch (aiError) {
              console.error('[OpenJobKit] AI generation failed:', aiError)
            }
          } else {
            console.warn(
              '[OpenJobKit] No AI API key configured. Custom fields skipped.',
            )
          }
        }

        // 3. Generate cover letter if there's a cover letter field and API key is present
        const hasCoverLetterField = fields.some(
          (f) =>
            f.label.toLowerCase().includes('cover letter') ||
            f.id.toLowerCase().includes('cover'),
        )

        if (hasCoverLetterField && settings.ai.apiKey) {
          try {
            const aiClient = createAIClient(settings.ai)
            const clPrompt = buildCoverLetterPrompt(profile, application.job)
            const clResponse = await aiClient.complete(SYSTEM_PROMPT, clPrompt)
            coverLetter = clResponse.content
          } catch (clError) {
            console.error(
              '[OpenJobKit] Cover letter generation failed:',
              clError,
            )
          }
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

      let active = await activeApplicationsStorage.get(tab.id)

      // If no mapping exists (e.g. extension just reloaded and script context was lost),
      // try to dynamically inject the content script on-demand.
      if (!active) {
        try {
          console.log(
            '[OpenJobKit] No active application mapping found. Injecting content script on-demand...',
          )
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-scripts/content.js'],
          })
          // Wait briefly for the script to load and register the form
          await new Promise((resolve) => setTimeout(resolve, 300))
          active = await activeApplicationsStorage.get(tab.id)
        } catch (err) {
          console.error(
            '[OpenJobKit] Failed to inject content script on-demand:',
            err,
          )
        }
      }

      if (!active) {
        console.warn(
          '[OpenJobKit] No active application detected for tab:',
          tab.id,
        )
        return
      }

      // Send TRIGGER_FILL to the content script in the correct frame
      try {
        await browser.tabs.sendMessage(
          tab.id,
          {
            type: 'TRIGGER_FILL',
            payload: { applicationId: active.applicationId },
          },
          { frameId: active.frameId },
        )
      } catch (err) {
        // If the context is invalidated / orphaned, force a re-injection
        console.warn(
          '[OpenJobKit] Message failed, re-injecting content script...',
          err,
        )
        try {
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-scripts/content.js'],
          })
          // Wait briefly, get the fresh mapping, and re-send
          await new Promise((resolve) => setTimeout(resolve, 300))
          const freshActive = await activeApplicationsStorage.get(tab.id)
          if (freshActive) {
            await browser.tabs.sendMessage(
              tab.id,
              {
                type: 'TRIGGER_FILL',
                payload: { applicationId: freshActive.applicationId },
              },
              { frameId: freshActive.frameId },
            )
          }
        } catch (injectErr) {
          console.error('[OpenJobKit] Force re-injection failed:', injectErr)
        }
      }
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

// ────────────────────────────────────────────────────────────────────────────
// Local Deterministic Resolver for Core Fields (No API Key Required)
// ────────────────────────────────────────────────────────────────────────────

function resolveFieldsLocally(
  profile: UserProfile,
  fields: Array<FormField>,
): Record<string, string> {
  const answers: Record<string, string> = {}

  for (const field of fields) {
    const label = field.label.toLowerCase()

    // First Name
    if (label.includes('first name') || label.includes('given name')) {
      answers[field.id] = profile.firstName
    }
    // Last Name
    else if (
      label.includes('last name') ||
      label.includes('family name') ||
      label.includes('surname')
    ) {
      answers[field.id] = profile.lastName
    }
    // Full Name
    else if (
      label.includes('full name') ||
      (label.includes('name') &&
        !label.includes('first') &&
        !label.includes('last') &&
        !label.includes('middle') &&
        !label.includes('company') &&
        !label.includes('employer'))
    ) {
      answers[field.id] = `${profile.firstName} ${profile.lastName}`.trim()
    }
    // Email
    else if (label.includes('email') || label.includes('e-mail')) {
      answers[field.id] = profile.email
    }
    // Phone
    else if (
      label.includes('phone') ||
      label.includes('mobile') ||
      label.includes('telephone') ||
      label.includes('contact number')
    ) {
      answers[field.id] = profile.phone
    }
    // LinkedIn
    else if (label.includes('linkedin')) {
      answers[field.id] = profile.linkedinUrl || ''
    }
    // GitHub
    else if (label.includes('github')) {
      answers[field.id] = profile.githubUrl || ''
    }
    // Portfolio / Website
    else if (
      label.includes('portfolio') ||
      label.includes('website') ||
      label.includes('personal site') ||
      label.includes('link to')
    ) {
      answers[field.id] = profile.portfolioUrl || profile.website || ''
    }
    // Location / City
    else if (
      label.includes('location') ||
      label.includes('city') ||
      label.includes('reside') ||
      label.includes('address')
    ) {
      answers[field.id] = profile.location || ''
    }
    // Standard questions: Authorized to work
    else if (
      label.includes('authorized to work') ||
      label.includes('legal right to work') ||
      label.includes('legally authorized')
    ) {
      answers[field.id] = 'Yes'
    }
    // Standard questions: Sponsorship
    else if (label.includes('sponsor') || label.includes('visa')) {
      answers[field.id] = 'No'
    }
  }

  return answers
}
