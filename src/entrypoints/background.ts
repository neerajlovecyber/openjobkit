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
    // ── Content script detected a job form (ephemeral — not saved to tracker) ─
    DETECT_JOB: async (msg, sender) => {
      const { job } = msg.payload

      // Reuse an existing tracker entry only if we already filled/failed this URL
      const existing = await applicationsStorage.getOpenByJobUrl(job.url)
      const applicationId = existing?.id ?? crypto.randomUUID()
      const fullJob: JobApplication['job'] = existing?.job ?? {
        ...job,
        id: crypto.randomUUID(),
        detectedAt: new Date().toISOString(),
      }

      if (sender.tab?.id) {
        await activeApplicationsStorage.set(sender.tab.id, {
          applicationId,
          frameId: sender.frameId ?? 0,
          job: {
            ...fullJob,
            title: job.title || fullJob.title,
            company: job.company || fullJob.company,
            location: job.location || fullJob.location,
            description: job.description || fullJob.description,
            url: job.url || fullJob.url,
          },
        })
      }

      console.log(
        '[OpenJobKit] Form ready (not tracked until fill):',
        job.title,
        'at',
        job.company,
      )

      return { applicationId }
    },

    // ── Content script requests AI fill for a job form ──────────────────────
    FILL_JOB: async (msg, sender) => {
      const { applicationId, fields } = msg.payload

      const [profile, settings] = await Promise.all([
        profileStorage.get(),
        settingsStorage.get(),
      ])

      const apiKey = settings.ai.apiKey?.trim()
      if (!apiKey) {
        throw new Error(
          'AI is not configured. Add an API key in OpenJobKit Settings → AI before autofill.',
        )
      }

      // Resolve job: InstantDB record, or ephemeral tab mapping from DETECT_JOB
      let application = await applicationsStorage.getById(applicationId)
      const active =
        sender.tab?.id != null
          ? await activeApplicationsStorage.get(sender.tab.id)
          : null
      const jobFromSession =
        active?.applicationId === applicationId ? active.job : null

      if (!application) {
        if (!jobFromSession) {
          throw new Error(
            'No job context for this page. Refresh and try autofill again.',
          )
        }
        application = {
          id: applicationId,
          job: jobFromSession,
          status: 'filling',
        }
        // Persist only when the user actually runs autofill
        if (settings.trackApplications) {
          await applicationsStorage.add(application)
        }
      } else if (settings.trackApplications) {
        await applicationsStorage.update(applicationId, { status: 'filling' })
      }

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

        if (settings.trackApplications) {
          await applicationsStorage.update(applicationId, {
            status: 'filled',
            aiGeneratedAnswers: answers,
            coverLetter,
          })
        }

        return { answers, coverLetter }
      } catch (error) {
        if (settings.trackApplications) {
          const existing = await applicationsStorage.getById(applicationId)
          if (existing) {
            await applicationsStorage.update(applicationId, {
              status: 'failed',
              error: String(error),
            })
          } else if (jobFromSession || application.job) {
            await applicationsStorage.add({
              id: applicationId,
              job: jobFromSession ?? application.job,
              status: 'failed',
              error: String(error),
            })
          }
        }
        throw error
      }
    },

    // ── User submitted the application ──────────────────────────────────────
    SUBMIT_JOB: async (msg) => {
      const { applicationId } = msg.payload
      const existing = await applicationsStorage.getById(applicationId)
      if (!existing) return
      await applicationsStorage.update(applicationId, {
        status: 'applied',
        appliedAt: new Date().toISOString(),
      })
      console.log('[OpenJobKit] Application submitted:', applicationId)
    },

    // ── Open autofill settings as a page overlay modal (Jobright-style) ─────
    OPEN_AUTOFILL_MODAL: async (msg) => {
      const tab = msg.payload?.tab ?? 'profile'
      const modalUrl = browser.runtime.getURL(
        `/autofill-modal.html?tab=${tab}` as `/autofill-modal.html${string}`,
      )

      const [active] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })

      const url = active?.url ?? ''
      const canInject =
        !!active?.id &&
        !url.startsWith('chrome://') &&
        !url.startsWith('chrome-extension://') &&
        !url.startsWith('edge://') &&
        !url.startsWith('about:') &&
        !url.startsWith('devtools://')

      if (!canInject || active.id == null) {
        await browser.windows.create({
          url: modalUrl,
          type: 'popup',
          width: 920,
          height: 760,
        })
        return
      }

      try {
        await browser.scripting.executeScript({
          target: { tabId: active.id },
          func: injectAutofillModalOverlay,
          args: [modalUrl],
        })
      } catch (err) {
        console.warn(
          '[OpenJobKit] Page inject failed, falling back to popup window:',
          err,
        )
        await browser.windows.create({
          url: modalUrl,
          type: 'popup',
          width: 920,
          height: 760,
        })
      }
    },

    CLOSE_AUTOFILL_MODAL: async () => {
      const [active] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!active?.id) return
      try {
        await browser.scripting.executeScript({
          target: { tabId: active.id },
          func: removeAutofillModalOverlay,
        })
      } catch {
        // Tab may not allow scripting (chrome:// etc.)
      }
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

/** Injected into the page — must stay self-contained (no imports). */
function injectAutofillModalOverlay(modalUrl: string) {
  const ROOT_ID = 'ojk-autofill-modal-root'
  document.getElementById(ROOT_ID)?.remove()

  const root = document.createElement('div')
  root.id = ROOT_ID
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    boxSizing: 'border-box',
    background: 'rgba(15, 15, 19, 0.55)',
    backdropFilter: 'blur(2px)',
  })

  const frame = document.createElement('iframe')
  frame.src = modalUrl
  frame.title = 'Your Autofill information'
  frame.allow = 'clipboard-write'
  Object.assign(frame.style, {
    width: 'min(920px, calc(100vw - 48px))',
    height: 'min(720px, calc(100vh - 48px))',
    border: 'none',
    borderRadius: '16px',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.45)',
    background: '#0f0f13',
    overflow: 'hidden',
  })

  root.addEventListener('click', (event) => {
    if (event.target === root) {
      // Runs in an isolated world — use the MV3 chrome API directly
      const ext = (
        globalThis as typeof globalThis & {
          chrome?: { runtime: { sendMessage: (msg: unknown) => void } }
          browser?: { runtime: { sendMessage: (msg: unknown) => void } }
        }
      ).chrome
      const runtime =
        ext?.runtime ??
        (
          globalThis as typeof globalThis & {
            browser?: { runtime: { sendMessage: (msg: unknown) => void } }
          }
        ).browser?.runtime
      runtime?.sendMessage({ type: 'CLOSE_AUTOFILL_MODAL' })
    }
  })

  root.appendChild(frame)
  document.documentElement.appendChild(root)
}

function removeAutofillModalOverlay() {
  document.getElementById('ojk-autofill-modal-root')?.remove()
}
