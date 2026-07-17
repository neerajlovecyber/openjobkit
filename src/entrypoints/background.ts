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
import {
  finalizeFieldAnswers,
  isAdditionalMonthsQuestion,
  isNoticePeriodQuestion,
  isSalaryCtcQuestion,
  isYearsExperienceQuestion,
  monthsExperienceAnswer,
  noticeAnswerForProfile,
  salaryAnswerForProfile,
} from '@/lib/autofill/normalize'
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
      const { applicationId, fields, job: jobSnapshot } = msg.payload

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

      // Resolve job: InstantDB record, ephemeral tab mapping, or payload snapshot
      let application = await applicationsStorage.getById(applicationId)
      const active =
        sender.tab?.id != null
          ? await activeApplicationsStorage.get(sender.tab.id)
          : null

      // Prefer session job even when applicationId drifted (common after re-DETECT)
      const jobFromSession = active?.job ?? null
      const jobUrl =
        jobFromSession?.url ?? jobSnapshot?.url ?? application?.job.url ?? ''

      // Reuse open tracker row for this job URL before creating a twin
      if (!application && jobUrl) {
        application = await applicationsStorage.getOpenByJobUrl(jobUrl)
      }
      if (
        !application &&
        active?.applicationId &&
        active.applicationId !== applicationId
      ) {
        application = await applicationsStorage.getById(active.applicationId)
      }

      const resolvedId =
        application?.id ?? active?.applicationId ?? applicationId

      if (!application) {
        const job =
          jobFromSession ??
          (jobSnapshot
            ? {
                ...jobSnapshot,
                id: crypto.randomUUID(),
                detectedAt: new Date().toISOString(),
              }
            : null)

        if (!job) {
          throw new Error(
            'No job context for this page. Open the job, click Apply, then Autofill again.',
          )
        }

        application = {
          id: resolvedId,
          job,
          status: 'filling',
        }

        // Refresh tab session so later steps keep working
        if (sender.tab?.id != null) {
          await activeApplicationsStorage.set(sender.tab.id, {
            applicationId: resolvedId,
            frameId: sender.frameId ?? 0,
            job: application.job,
          })
        }

        if (settings.trackApplications) {
          await applicationsStorage.add(application)
        }
      } else if (settings.trackApplications) {
        await applicationsStorage.update(application.id, { status: 'filling' })
        if (sender.tab?.id != null) {
          await activeApplicationsStorage.set(sender.tab.id, {
            applicationId: application.id,
            frameId: sender.frameId ?? 0,
            job: application.job,
          })
        }
      }

      const trackId = application.id

      try {
        // 1. Resolve standard + years/numeric fields locally from profile
        const localAnswers = resolveFieldsLocally(profile, fields)

        // Find fields that still need AI answers
        const unresolvedFields = fields.filter(
          (f) => !String(localAnswers[f.id] ?? '').trim(),
        )
        let answers = { ...localAnswers }
        let coverLetter: string | undefined
        let aiErrorMessage: string | null = null

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
            aiErrorMessage =
              aiError instanceof Error ? aiError.message : String(aiError)
          }
        }

        // 3. Coerce years/notice/numeric + fill gaps from profile
        answers = finalizeFieldAnswers(
          profile,
          fields,
          answers,
          yearsAnswerForQuestion,
        )

        const stillMissing = unresolvedFields.filter(
          (f) => f.required && !String(answers[f.id] ?? '').trim(),
        )
        if (stillMissing.length > 0 && aiErrorMessage) {
          throw new Error(
            `AI could not answer: ${stillMissing.map((f) => f.label).join('; ')}. ${aiErrorMessage}`,
          )
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
          await applicationsStorage.update(trackId, {
            status: 'filled',
            aiGeneratedAnswers: answers,
            coverLetter,
          })
        }

        return { answers, coverLetter, applyMode: settings.applyMode ?? 'auto' }
      } catch (error) {
        if (settings.trackApplications) {
          const existing = await applicationsStorage.getById(trackId)
          if (existing) {
            await applicationsStorage.update(trackId, {
              status: 'failed',
              error: String(error),
            })
          } else if (jobFromSession || application.job) {
            await applicationsStorage.add({
              id: trackId,
              job: jobFromSession ?? application.job,
              status: 'failed',
              error: String(error),
            })
          }
        }
        throw error
      }
    },

    // ── Content script needs the stored resume PDF/DOC for Easy Apply upload ─
    GET_RESUME_FILE: async () => {
      try {
        return await profileStorage.getResumeFile()
      } catch (err) {
        console.warn('[OpenJobKit] GET_RESUME_FILE failed:', err)
        return null
      }
    },

    // ── User submitted the application ──────────────────────────────────────
    SUBMIT_JOB: async (msg, sender) => {
      const { applicationId } = msg.payload
      const active =
        sender.tab?.id != null
          ? await activeApplicationsStorage.get(sender.tab.id)
          : null
      const resolvedId = active?.applicationId ?? applicationId
      const jobUrl = active?.job?.url

      let existing = await applicationsStorage.getById(resolvedId)
      if (!existing && resolvedId !== applicationId) {
        existing = await applicationsStorage.getById(applicationId)
      }
      // ID drift: reuse the Filled/open row for this job instead of creating Applied twin
      if (!existing && jobUrl) {
        existing = await applicationsStorage.getByJobUrl(jobUrl)
      }

      const appliedAt = new Date().toISOString()

      if (existing) {
        await applicationsStorage.update(existing.id, {
          status: 'applied',
          appliedAt,
          error: undefined,
        })
        const removed = await applicationsStorage.removeDuplicatesForJobUrl(
          existing.job.url,
          existing.id,
        )
        console.log(
          '[OpenJobKit] Application marked applied:',
          existing.id,
          removed ? `(removed ${removed} duplicate)` : '',
        )
        return { ok: true, applicationId: existing.id }
      }

      // Ephemeral fill (tracking off or ID drift) — create applied record from session
      const job = active?.job
      if (job) {
        await applicationsStorage.add({
          id: resolvedId,
          job,
          status: 'applied',
          appliedAt,
        })
        await applicationsStorage.removeDuplicatesForJobUrl(job.url, resolvedId)
        console.log('[OpenJobKit] Application created as applied:', resolvedId)
        return { ok: true, applicationId: resolvedId }
      }

      console.warn(
        '[OpenJobKit] SUBMIT_JOB: no application found for',
        applicationId,
      )
      return { ok: false }
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
      if (!tab?.id) {
        throw new Error('No active tab found. Focus a job page and try again.')
      }

      if (!tab.url || /^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
        throw new Error(
          'Switch to a LinkedIn / Greenhouse job tab, then click Autofill.',
        )
      }

      let active = await activeApplicationsStorage.get(tab.id)

      // Ask the page to register / open Easy Apply even if mapping is missing
      const pingOrInject = async () => {
        try {
          await browser.tabs.sendMessage(tab.id!, { type: 'PING' })
        } catch {
          console.log('[OpenJobKit] Injecting content script on-demand...')
          await browser.scripting.executeScript({
            target: { tabId: tab.id! },
            files: ['/content-scripts/content.js'],
          })
          await new Promise((resolve) => setTimeout(resolve, 400))
          await browser.tabs.sendMessage(tab.id!, { type: 'PING' })
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
        return activeApplicationsStorage.get(tab.id!)
      }

      // Always ping so content script can DETECT_JOB / refresh mapping
      active = (await pingOrInject()) ?? active

      // Don't require a pre-existing session — content script opens Easy Apply
      if (!active) {
        const stubId = crypto.randomUUID()
        const platform = /linkedin\.com/i.test(tab.url ?? '')
          ? ('linkedin' as const)
          : /greenhouse/i.test(tab.url ?? '')
            ? ('greenhouse' as const)
            : ('unknown' as const)
        await activeApplicationsStorage.set(tab.id, {
          applicationId: stubId,
          frameId: 0,
          job: {
            id: crypto.randomUUID(),
            platform,
            url: (tab.url ?? '').split('?')[0],
            title: 'Job',
            company: 'Unknown company',
            location: '',
            description: '',
            detectedAt: new Date().toISOString(),
          },
        })
        active = await activeApplicationsStorage.get(tab.id)
      }

      if (!active) {
        throw new Error(
          'Could not reach this tab. Refresh the job page and try Autofill again.',
        )
      }

      const sendFill = async (frameId?: number) => {
        const response = (await browser.tabs.sendMessage(
          tab.id!,
          {
            type: 'TRIGGER_FILL',
            payload: { applicationId: active!.applicationId },
          },
          frameId != null ? { frameId } : undefined,
        )) as { error?: string; ok?: boolean } | undefined

        if (response && typeof response === 'object' && response.error) {
          throw new Error(response.error)
        }
        return response
      }

      // LinkedIn Easy Apply lives in the top frame; stale iframe frameIds break fill
      const preferMainFrame = /linkedin\.com/i.test(tab.url ?? '')
      const primaryFrame = preferMainFrame ? 0 : active.frameId

      try {
        await sendFill(primaryFrame)
      } catch (err) {
        console.warn('[OpenJobKit] Fill message failed, re-injecting…', err)
        active = (await pingOrInject()) ?? active
        if (!active) {
          throw new Error(
            'Could not reach the job page. Refresh LinkedIn and try again.',
          )
        }
        try {
          await sendFill(preferMainFrame ? 0 : active.frameId)
        } catch (retryErr) {
          try {
            await sendFill(undefined)
          } catch {
            throw new Error(
              retryErr instanceof Error
                ? retryErr.message
                : 'Autofill failed. Open Easy Apply on the job, then try again.',
            )
          }
        }
      }
    },
  })

  // Cleanup active mappings when tab is closed or navigates to a new URL.
  // Do NOT clear on status==='loading' — LinkedIn SPA / Easy Apply triggers that
  // and wiped job context mid-fill.
  browser.tabs.onRemoved.addListener((tabId) => {
    void activeApplicationsStorage.remove(tabId)
  })

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return
    // LinkedIn SPA tweaks query params constantly — only clear when the job path changes
    void (async () => {
      const prev = await activeApplicationsStorage.get(tabId)
      if (!prev?.job?.url) {
        await activeApplicationsStorage.remove(tabId)
        return
      }
      const sameJob =
        normalizeJobPath(prev.job.url) === normalizeJobPath(changeInfo.url!)
      if (!sameJob) {
        await activeApplicationsStorage.remove(tabId)
      }
    })()
  })

  // Cleanup listeners on extension unload (good practice)
  browser.runtime.onSuspend?.addListener(cleanup)
})

function normalizeJobPath(url: string): string {
  try {
    const u = new URL(url)
    const view = u.pathname.match(/\/jobs\/view\/(\d+)/i)?.[1]
    if (view) return `linkedin:${view}`
    const current = u.searchParams.get('currentJobId')
    if (current) return `linkedin:${current}`
    return `${u.origin}${u.pathname}`.replace(/\/$/, '')
  } catch {
    return url.split('?')[0] ?? url
  }
}

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

    // Cached preferred answers (fuzzy label match)
    const cached = matchCachedAnswer(profile, label)
    if (cached != null) {
      answers[field.id] = cached
      continue
    }

    // Years / how-many experience (must run before generic "location" etc.)
    if (isYearsExperienceQuestion(label)) {
      answers[field.id] = yearsAnswerForQuestion(profile, label)
      continue
    }

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
        !label.includes('employer') &&
        !label.includes('how many'))
    ) {
      answers[field.id] = `${profile.firstName} ${profile.lastName}`.trim()
    }
    // Email
    else if (label.includes('email') || label.includes('e-mail')) {
      answers[field.id] = profile.email
    }
    // Phone country code (must run before generic phone)
    else if (
      label.includes('country code') ||
      label.includes('phone country') ||
      label.includes('dialing code')
    ) {
      const code = profile.phoneCountryCode?.trim() || 'India (+91)'
      answers[field.id] = code
    }
    // Phone
    else if (
      (label.includes('phone') ||
        label.includes('mobile') ||
        label.includes('telephone') ||
        label.includes('contact number')) &&
      !label.includes('country')
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
    // Location / City (avoid matching "how many years…" custom questions)
    else if (
      !isYearsExperienceQuestion(label) &&
      (/\blocation\b/.test(label) ||
        /\bcity\b/.test(label) ||
        /\breside\b/.test(label) ||
        /\baddress\b/.test(label))
    ) {
      answers[field.id] = profile.location || ''
    }
    // Notice period — LinkedIn expects a number (days/weeks/months), not prose
    else if (isNoticePeriodQuestion(label)) {
      answers[field.id] = noticeAnswerForProfile(profile, label, field)
    }
    // Salary / CTC — digits only (e.g. 200000 INR annual)
    else if (isSalaryCtcQuestion(label)) {
      answers[field.id] = salaryAnswerForProfile(profile, label, field)
    }
    // Additional months of experience (dropdown)
    else if (isAdditionalMonthsQuestion(label)) {
      answers[field.id] = monthsExperienceAnswer(profile, field)
    }
    // Standard questions: Authorized to work
    else if (
      label.includes('authorized to work') ||
      label.includes('legal right to work') ||
      label.includes('legally authorized') ||
      label.includes('eligible to work')
    ) {
      answers[field.id] = pickYesNo(field, 'Yes')
    }
    // Standard questions: Sponsorship
    else if (label.includes('sponsor') || label.includes('visa')) {
      answers[field.id] = pickYesNo(field, 'No')
    }
    // Relocate
    else if (label.includes('relocat') || label.includes('willing to move')) {
      answers[field.id] = pickYesNo(field, 'Yes')
    }
    // Veteran status
    else if (label.includes('veteran') || label.includes('protected veteran')) {
      answers[field.id] = pickPreferNot(field, 'I am not a protected veteran')
    }
    // Disability
    else if (label.includes('disability') || label.includes('disabled')) {
      answers[field.id] = pickPreferNot(field, 'No, I do not have a disability')
    }
    // Gender (EEO) — prefer decline when present
    else if (
      (label.includes('gender') || label.includes('sex')) &&
      !label.includes('sexual')
    ) {
      answers[field.id] = pickPreferNot(field, 'Decline to self-identify')
    }
    // Race / ethnicity
    else if (
      label.includes('race') ||
      label.includes('ethnicity') ||
      label.includes('ethnic')
    ) {
      answers[field.id] = pickPreferNot(field, 'Decline to self-identify')
    }
    // Follow company checkbox — default opt-out
    else if (
      field.context === 'follow-company' ||
      (label.includes('follow') && label.includes('company'))
    ) {
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
      const year = endDate.split('-')[0]
      if (field.type === 'select' && field.options) {
        answers[field.id] = field.options.find((o) => o.includes(year)) || year
      } else {
        answers[field.id] = year
      }
    }
  }

  return answers
}

function matchCachedAnswer(profile: UserProfile, label: string): string | null {
  const entries = Object.entries(profile.cachedAnswers ?? {})
  if (entries.length === 0) return null

  let best: { key: string; value: string; score: number } | null = null
  for (const [key, value] of entries) {
    const k = key.toLowerCase()
    if (!value?.trim()) continue
    if (label.includes(k) || k.includes(label.slice(0, 40))) {
      const score = Math.min(label.length, k.length)
      if (!best || score > best.score) best = { key: k, value, score }
    }
  }

  // Skill-specific years / numeric CTC should not use prose cached answers
  if (best?.key === 'years of experience' && isSkillSpecificYears(label)) {
    return null
  }
  if (best && isSalaryCtcQuestion(label) && !/\d/.test(best.value)) {
    return null
  }

  return best?.value ?? null
}

function isSkillSpecificYears(label: string): boolean {
  return (
    isYearsExperienceQuestion(label) &&
    (/\bwith\b/.test(label) ||
      /\bin\b/.test(label) ||
      label.includes('(') ||
      /\b(aws|azure|gcp|linux|python|java|react|docker|kubernetes)\b/.test(
        label,
      ))
  )
}

function yearsAnswerForQuestion(profile: UserProfile, label: string): string {
  const total = estimateTotalYears(profile)
  const skill = extractSkillHint(label)
  if (skill) {
    const matched = findSkill(profile, skill)
    if (matched) {
      const fromLevel = skillLevelToYears(matched.level)
      return String(Math.max(1, Math.min(fromLevel, total)))
    }
    // Mentioned in resume/work → use total years; else modest default
    const blob = [
      profile.resumeText,
      profile.summary,
      ...profile.workExperience.map(
        (w) => `${w.title} ${w.company} ${w.description}`,
      ),
      ...profile.skills.map((s) => s.name),
    ]
      .join(' ')
      .toLowerCase()
    if (
      blob.includes(skill) ||
      skill.split(/\s+/).some((p) => p.length > 2 && blob.includes(p))
    ) {
      return String(Math.max(1, total))
    }
  }
  return String(Math.max(1, total))
}

function extractSkillHint(label: string): string | null {
  const withMatch = label.match(/\b(?:with|in|using|on)\s+(.+?)(?:\?|$)/i)
  let raw = withMatch?.[1]?.trim() ?? null
  if (!raw) return null
  // Prefer parenthetical acronym: Amazon Web Services (AWS) → aws
  const paren = raw.match(/\(([^)]+)\)/)
  if (paren) return paren[1].trim().toLowerCase()
  raw = raw.replace(/\*$/, '').replace(/\s+/g, ' ').trim()
  return raw.toLowerCase() || null
}

function findSkill(profile: UserProfile, hint: string) {
  const h = hint.toLowerCase()
  const aliases: Record<string, Array<string>> = {
    aws: ['aws', 'amazon web services', 'amazon aws'],
    linux: ['linux', 'unix', 'ubuntu', 'centos'],
    k8s: ['k8s', 'kubernetes'],
    gcp: ['gcp', 'google cloud'],
  }
  const expanded = new Set<string>([h])
  for (const [canon, list] of Object.entries(aliases)) {
    if (list.some((a) => h.includes(a) || a.includes(h))) {
      list.forEach((a) => expanded.add(a))
      expanded.add(canon)
    }
  }

  return profile.skills.find((s) => {
    const n = s.name.toLowerCase()
    return [...expanded].some((a) => n.includes(a) || a.includes(n))
  })
}

function skillLevelToYears(
  level: UserProfile['skills'][number]['level'],
): number {
  switch (level) {
    case 'beginner':
      return 1
    case 'intermediate':
      return 2
    case 'advanced':
      return 3
    case 'expert':
      return 5
    default:
      return 2
  }
}

function estimateTotalYears(profile: UserProfile): number {
  const cached = profile.cachedAnswers?.['years of experience']
  if (cached) {
    const m = String(cached).match(/\d+/)
    if (m) return Math.max(1, parseInt(m[0], 10))
  }

  let months = 0
  for (const w of profile.workExperience ?? []) {
    const start = parseYearMonth(w.startDate)
    if (!start) continue
    const end = w.endDate ? parseYearMonth(w.endDate) : new Date()
    if (!end) continue
    const diff =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth())
    if (diff > 0) months += diff
  }
  if (months > 0) return Math.max(1, Math.round(months / 12))

  // Fallback: "2+ years" in summary
  const summaryYears = profile.summary?.match(/(\d+)\+?\s*years?/i)
  if (summaryYears) return Math.max(1, parseInt(summaryYears[1], 10))

  return 2
}

function parseYearMonth(value: string): Date | null {
  if (!value) return null
  const m = value.match(/^(\d{4})-(\d{2})/)
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1)
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// ────────────────────────────────────────────────────────────────────────────
// Option Matching Helper Functions
// ────────────────────────────────────────────────────────────────────────────

function pickYesNo(field: FormField, prefer: 'Yes' | 'No'): string {
  if (field.options?.length) {
    const hit = fuzzyMatchOption(field.options, prefer)
    if (hit) return hit
  }
  return prefer
}

function pickPreferNot(field: FormField, preferredPhrase: string): string {
  if (!field.options?.length) return preferredPhrase
  const decline = field.options.find((o) =>
    /decline|prefer not|do not wish|don't wish|choose not/i.test(o),
  )
  if (decline) return decline
  const hit = fuzzyMatchOption(field.options, preferredPhrase)
  return hit || preferredPhrase
}

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
