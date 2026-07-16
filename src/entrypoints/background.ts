// Background Service Worker — OpenJobKit Orchestration Hub
//
// Responsibilities:
//   1. Listen for DETECT_JOB messages from content scripts
//   2. Call the AI API with user profile + job details
//   3. Return filled answers back to the content script
//   4. Track applications in InstantDB (local-first, auto cloud sync)

import { generateFormAnswers, generateCoverLetter } from '@/lib/ai/client'
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

  // Toolbar click opens the side panel (Jobright-style) instead of a popup.
  void browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => {
      console.warn('[OpenJobKit] sidePanel.setPanelBehavior failed:', err)
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

      const apiKey = settings.ai.apiKey?.trim()
      if (!apiKey) {
        const error =
          'AI is not configured. Add an API key in OpenJobKit Settings → AI before autofill.'
        await applicationsStorage.update(applicationId, {
          status: 'failed',
          error,
        })
        throw new Error(error)
      }

      await applicationsStorage.update(applicationId, { status: 'filling' })

      try {
        // 1. Resolve standard fields locally from profile (AI must still be configured)
        const localAnswers = resolveFieldsLocally(profile, fields)

        // Find fields that still need AI answers
        const unresolvedFields = fields.filter((f) => !localAnswers[f.id])
        let answers = { ...localAnswers }
        let coverLetter: string | undefined

        // 2. Use AI for remaining custom / open-ended questions
        if (unresolvedFields.length > 0) {
          try {
            const userPrompt = buildFillPrompt(
              profile,
              application.job,
              unresolvedFields,
            )
            const aiAnswers = await generateFormAnswers(
              settings.ai,
              SYSTEM_PROMPT,
              userPrompt,
            )
            answers = { ...answers, ...aiAnswers }
          } catch (aiError) {
            console.error('[OpenJobKit] AI generation failed:', aiError)
          }
        }

        // 3. Generate cover letter when the form has a cover letter field
        const hasCoverLetterField = fields.some(
          (f) =>
            f.label.toLowerCase().includes('cover letter') ||
            f.id.toLowerCase().includes('cover'),
        )

        if (hasCoverLetterField) {
          try {
            const clPrompt = buildCoverLetterPrompt(profile, application.job)
            coverLetter = await generateCoverLetter(
              settings.ai,
              SYSTEM_PROMPT,
              clPrompt,
            )
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
      const settings = await settingsStorage.get()
      if (!settings.ai.apiKey?.trim()) {
        throw new Error(
          'AI is not configured. Add an API key in OpenJobKit Settings → AI before autofill.',
        )
      }

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
            files: ['/content-scripts/content.js'],
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
            files: ['/content-scripts/content.js'],
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
// Local Deterministic Resolver for Core Fields
// (Used only after AI is confirmed configured — fills name/email/etc. without
// burning tokens, then AI handles the remaining open-ended questions.)
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
    // Education: School / Institution
    else if (
      label.includes('school') ||
      label.includes('university') ||
      label.includes('institution')
    ) {
      const edu = profile.education?.[0]
      if (edu) {
        if (field.type === 'select' && field.options) {
          answers[field.id] = fuzzyMatchOption(field.options, edu.institution)
        } else {
          answers[field.id] = edu.institution
        }
      }
    }
    // Education: Degree
    else if (label.includes('degree')) {
      const edu = profile.education?.[0]
      if (edu) {
        if (field.type === 'select' && field.options) {
          answers[field.id] = fuzzyMatchOption(field.options, edu.degree)
        } else {
          answers[field.id] = edu.degree
        }
      }
    }
    // Education: Discipline / Major / Field
    else if (
      label.includes('discipline') ||
      label.includes('major') ||
      label.includes('field of study') ||
      label.includes('department')
    ) {
      const edu = profile.education?.[0]
      if (edu) {
        if (field.type === 'select' && field.options) {
          answers[field.id] = fuzzyMatchOption(field.options, edu.field)
        } else {
          answers[field.id] = edu.field
        }
      }
    }
    // Education Start Month
    else if (
      label.includes('start') &&
      (label.includes('month') || label.includes('mo'))
    ) {
      const edu = profile.education?.[0]
      if (edu?.startDate) {
        const parts = edu.startDate.split('-')
        const monthNum = parts[1] || '01'
        if (field.type === 'select' && field.options) {
          answers[field.id] = matchMonthOption(field.options, monthNum)
        } else {
          answers[field.id] = monthNum
        }
      }
    }
    // Education Start Year
    else if (
      label.includes('start') &&
      (label.includes('year') || label.includes('yr'))
    ) {
      const edu = profile.education?.[0]
      if (edu?.startDate) {
        const parts = edu.startDate.split('-')
        const year = parts[0]
        if (field.type === 'select' && field.options) {
          answers[field.id] =
            field.options.find((o) => o.includes(year)) || year
        } else {
          answers[field.id] = year
        }
      }
    }
    // Education End Month
    else if (
      (label.includes('end') || label.includes('grad')) &&
      (label.includes('month') || label.includes('mo'))
    ) {
      const edu = profile.education?.[0]
      const endDate = edu?.endDate || new Date().toISOString().substring(0, 7)
      const parts = endDate.split('-')
      const monthNum = parts[1] || '01'
      if (field.type === 'select' && field.options) {
        answers[field.id] = matchMonthOption(field.options, monthNum)
      } else {
        answers[field.id] = monthNum
      }
    }
    // Education End Year
    else if (
      (label.includes('end') || label.includes('grad')) &&
      (label.includes('year') || label.includes('yr'))
    ) {
      const edu = profile.education?.[0]
      const endDate = edu?.endDate || new Date().toISOString().substring(0, 7)
      const parts = endDate.split('-')
      const year = parts[0]
      if (field.type === 'select' && field.options) {
        answers[field.id] = field.options.find((o) => o.includes(year)) || year
      } else {
        answers[field.id] = year
      }
    }
  }

  return answers
}

// ────────────────────────────────────────────────────────────────────────────
// Option Matching Helper Functions
// ────────────────────────────────────────────────────────────────────────────

function fuzzyMatchOption(options: Array<string>, target: string): string {
  const targetLower = target.toLowerCase()

  // 1. Exact or starts-with match
  for (const opt of options) {
    const oLower = opt.toLowerCase()
    if (
      oLower === targetLower ||
      oLower.includes(targetLower) ||
      targetLower.includes(oLower)
    ) {
      return opt
    }
  }

  // 2. Acronym or common abbreviations match (e.g. "B.Tech" or "Bachelor of Technology")
  if (
    targetLower.includes('bachelor') ||
    targetLower.includes('b.tech') ||
    targetLower.includes('b.s.')
  ) {
    for (const opt of options) {
      const oLower = opt.toLowerCase()
      if (
        (oLower.includes('bachelor') ||
          oLower.includes('b.s') ||
          oLower.includes('b.tech') ||
          oLower.includes('b.a')) &&
        ((targetLower.includes('tech') && oLower.includes('tech')) ||
          (targetLower.includes('science') && oLower.includes('science')) ||
          (targetLower.includes('engineering') &&
            oLower.includes('engineering')))
      ) {
        return opt
      }
    }
  }

  // 3. Fallback to first non-empty option
  return options[0] || target
}

function matchMonthOption(options: Array<string>, monthNumStr: string): string {
  const monthsShort = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const monthsFull = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  const mIndex = parseInt(monthNumStr, 10) - 1 // 0-based index
  if (isNaN(mIndex) || mIndex < 0 || mIndex > 11) return ''

  const shortName = monthsShort[mIndex].toLowerCase()
  const fullName = monthsFull[mIndex].toLowerCase()
  const numericValue = String(mIndex + 1)
  const paddedNumericValue = monthNumStr // '08'

  for (const opt of options) {
    const oLower = opt.toLowerCase()
    if (
      oLower === shortName ||
      oLower === fullName ||
      oLower === numericValue ||
      oLower === paddedNumericValue ||
      oLower.startsWith(shortName)
    ) {
      return opt
    }
  }
  return options[0] || '' // Fallback
}
