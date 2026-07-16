// LinkedIn Easy Apply content script
// Detects job forms on LinkedIn and orchestrates the AI autofill flow.
// After Auto-Fill: fills each step, clicks Next/Review, then Submit application
// (unless Settings → applyMode is "review").
//
// Matches: linkedin.com/jobs/* and linkedin.com/jobs/view/*

import type { ContentScriptContext } from 'wxt/utils/content-script-context'

import { coerceAnswerForField } from '@/lib/autofill/normalize'
import { sendToBackground, onMessage } from '@/lib/messaging'

import type { FormField } from '@/types/messages'

const AUTOFILL_ACTIVE = 'data-ojk-autofill-active'
const DETECTED = 'data-ojk-detected'
const STEP_DEBOUNCE_MS = 300
const MODAL_WAIT_MS = 8000
const FIELD_WAIT_MS = 10000
const STEP_CHANGE_WAIT_MS = 8000
const MAX_AUTO_STEPS = 8

/** Per-modal step-watch cleanup + fill lock */
const modalSessions = new WeakMap<
  HTMLElement,
  {
    disconnectStepObserver: () => void
    lastFingerprint: string
    filling: boolean
    /** True while Autofill owns Next/Review navigation */
    autoAdvancing: boolean
    debounceTimer: ReturnType<typeof setTimeout> | null
  }
>()

let cachedApplicationId: string | null = null

export function initLinkedin(ctx: ContentScriptContext) {
  console.log('[OpenJobKit] LinkedIn content script loaded')

  // Register the job as soon as the details pane is ready (before Easy Apply)
  void registerJobIfPossible()

  const observer = new MutationObserver(() => {
    void registerJobIfPossible()

    const modal = findEasyApplyModal()
    if (modal && !modal.getAttribute(DETECTED)) {
      modal.setAttribute(DETECTED, 'true')
      void handleEasyApplyModal(modal)
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  const cleanup = onMessage({
    PING: async () => {
      await registerJobIfPossible()
      const modal = findEasyApplyModal()
      if (!modal) return { ok: true, hasModal: false }
      if (modal.getAttribute(DETECTED)) {
        if (!modal.querySelector('#ojk-fill-btn') && cachedApplicationId) {
          injectFillButton(modal, cachedApplicationId)
        }
        return { ok: true, hasModal: true }
      }
      await handleEasyApplyModal(modal)
      return { ok: true, hasModal: true }
    },
    TRIGGER_FILL: async (msg) => {
      try {
        // Always re-register so background has fresh tab session before FILL_JOB
        const freshId = await registerJobIfPossible()
        const applicationId =
          freshId || msg.payload.applicationId || cachedApplicationId

        if (!applicationId) {
          throw new Error(
            'Could not read this job. Open a job in the list, wait for details, then try again.',
          )
        }

        cachedApplicationId = applicationId
        const modal = await ensureEasyApplyModal()
        await handleEasyApplyModal(modal)
        await waitForApplyFormReady(modal)
        await runAutofillThroughSteps(modal, applicationId)
        return { ok: true }
      } catch (err) {
        console.error('[OpenJobKit] TRIGGER_FILL failed:', err)
        throw err instanceof Error ? err : new Error(String(err))
      }
    },
  })

  ctx.onInvalidated(() => {
    observer.disconnect()
    cleanup()
    const btn = document.getElementById(
      'ojk-fill-btn',
    ) as HTMLButtonElement | null
    if (btn) {
      btn.textContent = '⚠️ Extension updated. Please refresh page.'
      btn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)'
      btn.disabled = true
      btn.style.cursor = 'not-allowed'
      btn.style.opacity = '1'
    }
  })
}

// ────────────────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** LinkedIn safety interstitial: "Continue applying" (from classic Easy Apply bots). */
function dismissContinueApplyingReminder() {
  const btn = Array.from(document.querySelectorAll('button')).find((b) =>
    /continue applying/i.test(b.textContent ?? ''),
  )
  if (btn && isVisibleField(btn)) btn.click()
}

function findEasyApplyModal(): HTMLElement | null {
  // New LinkedIn SDUI Easy Apply (hashed classes + data-sdui-screen)
  const sdui = document.querySelector<HTMLElement>(
    '[data-sdui-screen*="EasyApply"], [data-sdui-screen*="easyapply"]',
  )
  if (sdui) {
    let el: HTMLElement | null = sdui
    for (let i = 0; i < 10 && el; i++) {
      if (
        el.querySelector('#dialog-header') ||
        el.querySelector('[data-testid="dialog-content"]')
      ) {
        return el
      }
      el = el.parentElement
    }
    return (
      (sdui.closest('[data-testid="dialog-content"]')
        ?.parentElement as HTMLElement | null) ?? sdui
    )
  }

  // Dialog marked with #dialog-header ("Apply to …")
  const header = document.querySelector('#dialog-header')
  if (header) {
    const title = header.textContent?.toLowerCase() ?? ''
    if (title.includes('apply')) {
      let el = header.parentElement
      for (let i = 0; i < 6 && el; i++) {
        if (
          el.querySelector(
            '[data-testid="dialog-content"], input, select, textarea',
          )
        ) {
          return el
        }
        el = el.parentElement
      }
      return header.parentElement
    }
  }

  // dialog-content with contact / resume / submit cues
  for (const content of document.querySelectorAll<HTMLElement>(
    '[data-testid="dialog-content"]',
  )) {
    const text = content.textContent?.toLowerCase() ?? ''
    if (
      text.includes('contact info') ||
      text.includes('submit application') ||
      text.includes('upload resume') ||
      text.includes('phone country code')
    ) {
      return content.parentElement ?? content
    }
  }

  // Classic Easy Apply / artdeco dialogs
  const selectors = [
    '.jobs-easy-apply-modal',
    '.jobs-easy-apply-content',
    '[data-test-modal].jobs-easy-apply-modal',
    '[data-test-modal]',
    'div.artdeco-modal[role="dialog"]',
    'div[role="dialog"]',
  ]
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel)
    for (const el of els) {
      const text = el.textContent?.toLowerCase() ?? ''
      const hasFields = !!el.querySelector(
        'form, input:not([type="hidden"]), textarea, select',
      )
      if (
        sel.includes('easy-apply') ||
        text.includes('easy apply') ||
        text.includes('contact info') ||
        text.includes('apply to') ||
        text.includes('resume') ||
        (hasFields && text.includes('phone'))
      ) {
        return el as HTMLElement
      }
    }
  }
  return null
}

/** LinkedIn renamed "Easy Apply" → "Apply" with aria-label "LinkedIn Apply to this job". */
function buttonApplyLabel(btn: HTMLElement): string {
  return (btn.getAttribute('aria-label') ?? btn.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isLinkedInInAppApplyButton(btn: HTMLButtonElement): boolean {
  if (!isVisibleField(btn)) return false
  const label = buttonApplyLabel(btn)
  if (!label) return false

  // Never treat Save / Share / Follow as Apply
  if (
    label.includes('save') ||
    label.includes('share') ||
    label.includes('follow') ||
    label.includes('more options')
  ) {
    return false
  }

  // New UI (2025+): "LinkedIn Apply to this job" — in-app apply (ex–Easy Apply)
  if (label.includes('linkedin apply') || label.includes('apply to this job')) {
    return true
  }

  // Classic Easy Apply
  if (label.includes('easy apply')) return true

  // Legacy class names
  if (btn.classList.contains('jobs-apply-button')) return true

  // Visible text "Apply" with LinkedIn bug icon inside the button
  const visible = (btn.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (
    visible === 'apply' &&
    btn.querySelector('svg[id*="linkedin"], [id*="linkedin-bug"]')
  ) {
    return true
  }

  return false
}

function findEasyApplyButton(): HTMLButtonElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button'),
  )

  // Prefer explicit LinkedIn Apply / Easy Apply labels first
  const ranked = candidates.filter(isLinkedInInAppApplyButton)
  const preferred = ranked.find((btn) => {
    const label = buttonApplyLabel(btn)
    return (
      label.includes('linkedin apply') ||
      label.includes('easy apply') ||
      label.includes('apply to this job')
    )
  })
  if (preferred) return preferred
  if (ranked[0]) return ranked[0]

  // Fallback: classic top-card selectors
  const top = document.querySelector<HTMLButtonElement>(
    '.jobs-apply-button--top-card button, .jobs-s-apply button, button.jobs-apply-button',
  )
  return top && isVisibleField(top) ? top : null
}

async function ensureEasyApplyModal(): Promise<HTMLElement> {
  let modal = findEasyApplyModal()
  if (!modal) {
    const applyBtn = findEasyApplyButton()
    if (!applyBtn) {
      throw new Error(
        'No LinkedIn Apply button found, and no Apply form is open. Click Apply on the job first, then Autofill.',
      )
    }

    console.log(
      '[OpenJobKit] Clicking Apply…',
      applyBtn.getAttribute('aria-label') ?? applyBtn.textContent?.trim(),
    )
    applyBtn.click()
    await sleep(400)
    dismissContinueApplyingReminder()

    const started = Date.now()
    while (Date.now() - started < MODAL_WAIT_MS) {
      await sleep(200)
      dismissContinueApplyingReminder()
      modal = findEasyApplyModal()
      if (modal) break
    }
  }

  if (!modal) {
    throw new Error(
      'Apply form did not open. Click Apply yourself, wait for the form, then Autofill again.',
    )
  }

  return modal
}

/** LinkedIn SDUI LazyColumn mounts fields after the dialog shell — wait for controls. */
async function waitForApplyFormReady(modal: HTMLElement): Promise<HTMLElement> {
  const started = Date.now()
  let root = resolveApplyFormRoot(modal)

  while (Date.now() - started < FIELD_WAIT_MS) {
    root = resolveApplyFormRoot(modal)
    const raw = countRawControls(root)
    const fields = detectFormFields(root)
    if (fields.length > 0) {
      console.log(
        `[OpenJobKit] Form ready: ${fields.length} fields (${raw} controls)`,
      )
      return root
    }
    if (raw > 0) {
      // Controls exist but detection filtered them — still return and let fill retry soft
      console.log(
        `[OpenJobKit] Controls present (${raw}) but labeled fields=0 — retrying detect…`,
      )
    }
    await sleep(300)
  }

  return resolveApplyFormRoot(modal)
}

function resolveApplyFormRoot(fallback: HTMLElement): HTMLElement {
  const sdui = document.querySelector<HTMLElement>(
    '[data-sdui-screen*="EasyApply"], [data-sdui-screen*="easyapply"]',
  )
  if (sdui) {
    const content = sdui.closest<HTMLElement>('[data-testid="dialog-content"]')
    if (content) {
      return content.parentElement ?? content
    }
    return sdui
  }
  return findEasyApplyModal() ?? fallback
}

function countRawControls(container: HTMLElement): number {
  return container.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), input[type="radio"], input[type="checkbox"], textarea, select',
  ).length
}

async function registerJobIfPossible(): Promise<string | null> {
  const job = scrapeJobDetails()
  if (!job) return cachedApplicationId

  try {
    const result = await sendToBackground<{ applicationId: string }>({
      type: 'DETECT_JOB',
      payload: { job, tabId: 0 },
    })
    if (result?.applicationId) {
      cachedApplicationId = result.applicationId
      return result.applicationId
    }
  } catch (err) {
    console.warn('[OpenJobKit] DETECT_JOB failed:', err)
  }
  return cachedApplicationId
}

async function handleEasyApplyModal(modal: HTMLElement) {
  const applicationId = cachedApplicationId ?? (await registerJobIfPossible())
  if (!applicationId) {
    console.warn('[OpenJobKit] Easy Apply open but job details missing')
    return
  }

  console.log('[OpenJobKit] Easy Apply ready')
  injectFillButton(modal, applicationId)
  ensureStepWatcher(modal, applicationId)
}

function scrapeJobDetails() {
  const jobIdMatch = location.pathname.match(/\/jobs\/view\/(\d+)/i)

  // ── Company (SDUI: aria-label="Company, SCG.") ────────────────────────────
  let company = ''
  const companyNode = document.querySelector<HTMLElement>(
    '[aria-label^="Company,"], [aria-label*="Company,"]',
  )
  if (companyNode) {
    const aria = companyNode.getAttribute('aria-label') ?? ''
    const m = aria.match(/Company,\s*(.+?)\.?$/i)
    company =
      m?.[1]?.trim() ||
      companyNode.querySelector('a')?.textContent?.trim() ||
      companyNode.textContent?.trim() ||
      ''
  }
  if (!company) {
    const classicCompany = document.querySelector(
      '.job-details-jobs-unified-top-card__company-name, .jobs-details-top-card__company-url',
    )
    company = classicCompany?.textContent?.trim() ?? ''
  }

  // ── Title (SDUI: paragraph containing Verified job near Apply) ─────────────
  let title = ''
  const verified = document.querySelector('[aria-label="Verified job"]')
  if (verified) {
    const titleP = verified.closest('p')
    if (titleP) {
      title = (titleP.textContent ?? '')
        .replace(/\s+/g, ' ')
        .replace(/Verified job/gi, '')
        .trim()
    }
  }

  if (!title) {
    const classicTitle = document.querySelector(
      '.job-details-jobs-unified-top-card__job-title, .jobs-details-top-card__job-title, h1.t-24',
    )
    title = classicTitle?.textContent?.trim() ?? ''
  }

  // SDUI without Verified badge: title sits above Apply in the same card
  if (!title) {
    const applyBtn = document.querySelector<HTMLElement>(
      '[aria-label*="LinkedIn Apply" i], [aria-label*="Easy Apply" i], button[aria-label*="Apply to this job" i]',
    )
    const card =
      applyBtn?.closest('[componentkey*="JobDetails"]') ??
      applyBtn?.closest('div')?.parentElement?.parentElement?.parentElement
    if (card) {
      const candidates = Array.from(card.querySelectorAll('p')).filter((p) => {
        const t = (p.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (t.length < 3 || t.length > 160) return false
        if (
          /^New\b|Reposted|applicants|Promoted by|·/i.test(t) &&
          t.includes('·')
        )
          return false
        if (/^(On-site|Remote|Hybrid|Full-time|Part-time)$/i.test(t))
          return false
        return true
      })
      // Prefer the longest non-meta paragraph near the top of the card
      title =
        candidates
          .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
          .sort((a, b) => b.length - a.length)[0] ?? ''
    }
  }

  // Document title: "SCG hiring Cloud Engineer – SCG India in New Delhi… | LinkedIn"
  if (!title && document.title) {
    title = document.title
      .replace(/\s*\|\s*LinkedIn.*$/i, '')
      .replace(/^.+?\s+hiring\s+/i, '')
      .replace(/\s+in\s+[A-Za-z].*$/i, '')
      .trim()
  }

  // Last resort for /jobs/view/: never return null (breaks FILL_JOB context)
  if (!title && jobIdMatch) {
    title = `LinkedIn Job ${jobIdMatch[1]}`
  }

  // ── Location ──────────────────────────────────────────────────────────────
  let locationText = ''
  const classicLoc = document.querySelector(
    '.job-details-jobs-unified-top-card__bullet, .jobs-details-top-card__bullet, .job-details-jobs-unified-top-card__tertiary-description-container',
  )
  locationText = classicLoc?.textContent?.trim() ?? ''

  if (!locationText) {
    // SDUI meta line: "New Delhi, Delhi, India · Reposted … · Over 100 applicants"
    const meta = Array.from(document.querySelectorAll('p')).find((p) => {
      const t = p.textContent ?? ''
      return (
        t.includes('·') &&
        /\b(India|United States|Remote|Hybrid|On-site)\b/i.test(t) &&
        t.length < 200
      )
    })
    if (meta) {
      locationText =
        meta.querySelector('span')?.textContent?.trim() ||
        (meta.textContent ?? '').split('·')[0]?.trim() ||
        ''
    }
  }

  // ── Description (About the job) ───────────────────────────────────────────
  const aboutRoot =
    document.querySelector<HTMLElement>('[id^="JobDetails_AboutTheJob_"]') ??
    document.querySelector<HTMLElement>('[data-sdui-component*="aboutTheJob"]')
  const descEl =
    aboutRoot?.querySelector('[data-testid="expandable-text-box"]') ??
    aboutRoot ??
    document.querySelector(
      '.jobs-description__content, .jobs-box__html-content, #job-details',
    )
  const description = (descEl?.textContent ?? '').replace(/\s+/g, ' ').trim()

  if (!title) return null

  return {
    platform: 'linkedin' as const,
    url: window.location.href.split('?')[0] || window.location.href,
    title,
    company: company || 'Unknown company',
    location: locationText,
    description,
  }
}

function injectFillButton(modal: HTMLElement, applicationId: string) {
  if (modal.querySelector('#ojk-fill-btn')) return

  const btn = document.createElement('button')
  btn.id = 'ojk-fill-btn'
  btn.textContent = '✨ Auto-Fill with AI'
  btn.type = 'button'
  btn.style.cssText = `
    position: absolute;
    top: 12px;
    right: 60px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    z-index: 9999;
    font-family: inherit;
  `

  btn.addEventListener('click', () => {
    void runAutofillThroughSteps(modal, applicationId)
  })

  const header =
    modal.querySelector('#dialog-header') ??
    modal.querySelector('.artdeco-modal__header') ??
    modal.querySelector('header') ??
    modal
  if (header) {
    ;(header as HTMLElement).style.position = 'relative'
    header.appendChild(btn)
  }
}

/** Watch modal body for Easy Apply step changes; auto-refill when session is active. */
function ensureStepWatcher(modal: HTMLElement, applicationId: string) {
  const existing = modalSessions.get(modal)
  if (existing) return

  const session = {
    disconnectStepObserver: () => {},
    lastFingerprint: fieldFingerprint(modal),
    filling: false,
    autoAdvancing: false,
    debounceTimer: null as ReturnType<typeof setTimeout> | null,
  }

  const stepObserver = new MutationObserver(() => {
    if (!document.body.contains(modal)) {
      if (session.debounceTimer) clearTimeout(session.debounceTimer)
      stepObserver.disconnect()
      modalSessions.delete(modal)
      return
    }

    if (session.debounceTimer) clearTimeout(session.debounceTimer)
    session.debounceTimer = setTimeout(() => {
      void onStepMaybeChanged(modal, applicationId)
    }, STEP_DEBOUNCE_MS)
  })

  const body =
    modal.querySelector('.artdeco-modal__content, .jobs-easy-apply-content') ??
    modal
  stepObserver.observe(body, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  session.disconnectStepObserver = () => stepObserver.disconnect()
  modalSessions.set(modal, session)
}

async function onStepMaybeChanged(modal: HTMLElement, applicationId: string) {
  const session = modalSessions.get(modal)
  if (!session) return
  if (modal.getAttribute(AUTOFILL_ACTIVE) !== 'true') return
  if (session.filling || session.autoAdvancing) return

  const nextFp = fieldFingerprint(modal)
  if (nextFp === session.lastFingerprint) return
  if (nextFp === '') {
    session.lastFingerprint = nextFp
    return
  }

  console.log('[OpenJobKit] Easy Apply step changed — auto-refilling')
  await fillCurrentPage(modal, applicationId, {
    activateSession: false,
    advance: false,
  })
}

function fieldFingerprint(modal: HTMLElement): string {
  const root = resolveApplyFormRoot(modal)
  return detectFormFields(root)
    .map((f) => `${f.label}|${f.type}|${f.selector}`)
    .join(';;')
}

type AdvanceKind = 'next' | 'review' | 'submit'

function findAdvanceButton(
  modal: HTMLElement,
): { kind: AdvanceKind; button: HTMLButtonElement } | null {
  const scope =
    resolveApplyFormRoot(modal).closest('[role="dialog"]') ??
    modal.closest('[role="dialog"]') ??
    modal

  const buttons = Array.from(
    scope.querySelectorAll<HTMLButtonElement>('button'),
  ).filter((b) => isVisibleField(b) && !b.disabled)

  const textOf = (b: HTMLButtonElement) =>
    (b.getAttribute('aria-label') ?? b.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()

  const submit = buttons.find((b) => {
    const t = textOf(b)
    return (
      t === 'submit application' ||
      t === 'submit' ||
      t.startsWith('submit applic') ||
      (t.includes('submit') && t.includes('application'))
    )
  })
  if (submit) return { kind: 'submit', button: submit }

  const review = buttons.find((b) => {
    const t = textOf(b)
    return t === 'review' || t.startsWith('review ')
  })
  if (review) return { kind: 'review', button: review }

  const next = buttons.find((b) => {
    const t = textOf(b)
    return (
      t === 'next' ||
      t.startsWith('next ') ||
      t === 'continue' ||
      t.includes('continue to next') ||
      t.includes('continue applying')
    )
  })
  if (next) return { kind: 'next', button: next }

  return null
}

async function waitForStepChange(
  modal: HTMLElement,
  previousFp: string,
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < STEP_CHANGE_WAIT_MS) {
    await sleep(250)
    dismissContinueApplyingReminder()
    const fp = fieldFingerprint(modal)
    if (fp && fp !== previousFp) return true
    // Progress text like "2/4" can change before fields remount
    const progress = (
      modal.textContent?.match(/\b(\d+)\s*\/\s*(\d+)\b/) ?? null
    )?.join('')
    if (progress && fp !== previousFp) return true
  }
  return fieldFingerprint(modal) !== previousFp
}

/** Fill every Easy Apply step; click Next/Review; Submit on the final page. */
async function runAutofillThroughSteps(
  modal: HTMLElement,
  applicationId: string,
) {
  ensureStepWatcher(modal, applicationId)
  modal.setAttribute(AUTOFILL_ACTIVE, 'true')

  const session = modalSessions.get(modal)
  if (session) session.autoAdvancing = true

  const btn =
    (modal.querySelector('#ojk-fill-btn') as HTMLButtonElement | null) ??
    (document.querySelector('#ojk-fill-btn') as HTMLButtonElement | null)

  try {
    for (let step = 0; step < MAX_AUTO_STEPS; step++) {
      await waitForApplyFormReady(modal)

      const advanceBefore = findAdvanceButton(modal)
      const onSubmitScreen = advanceBefore?.kind === 'submit'

      try {
        await fillCurrentPage(modal, applicationId, {
          activateSession: true,
          advance: false,
          allowEmpty: onSubmitScreen,
        })
      } catch (err) {
        // Review screen may have no text fields — still allow Submit
        if (!onSubmitScreen) throw err
        console.warn('[OpenJobKit] Fill skipped on submit screen:', err)
      }

      const advance = findAdvanceButton(modal)
      if (!advance) {
        if (btn) {
          btn.textContent = '✅ Done'
          btn.disabled = false
        }
        return
      }

      if (advance.kind === 'submit') {
        await submitEasyApply(modal, btn, applicationId)
        return
      }

      const beforeFp = fieldFingerprint(modal)
      console.log(
        `[OpenJobKit] Advancing Easy Apply (${advance.kind})… step ${step + 1}`,
      )
      if (btn) {
        btn.textContent =
          advance.kind === 'review'
            ? '⏳ Opening review…'
            : `⏳ Next page (${step + 1})…`
        btn.disabled = true
      }

      advance.button.click()
      await sleep(400)
      dismissContinueApplyingReminder()

      const changed = await waitForStepChange(modal, beforeFp)
      if (!changed) {
        // Maybe we are already on submit (fingerprint same) — try submit
        const again = findAdvanceButton(modal)
        if (again?.kind === 'submit') {
          await submitEasyApply(modal, btn, applicationId)
          return
        }
        if (btn) {
          btn.textContent = '✅ Filled — check required fields, then Next'
          btn.disabled = false
        }
        return
      }

      // After Review, continue loop → fill follow checkbox → Submit
    }

    // Max steps — try submit if available
    const last = findAdvanceButton(modal)
    if (last?.kind === 'submit') {
      await submitEasyApply(modal, btn, applicationId)
      return
    }

    if (btn) {
      btn.textContent = '✅ Filled! Review remaining steps.'
      btn.disabled = false
    }
  } catch (err) {
    if (btn) {
      btn.textContent = '❌ Error — retry'
      btn.disabled = false
    }
    throw err
  } finally {
    if (session) session.autoAdvancing = false
  }
}

function uncheckFollowCompany(modal: HTMLElement) {
  const root = resolveApplyFormRoot(modal)
  const follow =
    root.querySelector<HTMLInputElement>('#follow-company-checkbox') ??
    root.querySelector<HTMLInputElement>(
      'input[type="checkbox"][id*="follow" i]',
    ) ??
    Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((el) => {
      const label = labelTextForControl(el, root)?.toLowerCase() ?? ''
      return label.includes('follow') && el.checked
    })

  if (follow?.checked) {
    clickRadioOrCheckbox(follow, root, false)
  }
}

async function submitEasyApply(
  modal: HTMLElement,
  btn: HTMLButtonElement | null,
  applicationId: string,
) {
  uncheckFollowCompany(modal)
  await sleep(200)

  const advance = findAdvanceButton(modal)
  if (!advance || advance.kind !== 'submit') {
    if (btn) {
      btn.textContent = '✅ Filled! Click Submit application'
      btn.disabled = false
    }
    return
  }

  if (btn) {
    btn.textContent = '⏳ Submitting…'
    btn.disabled = true
  }
  console.log('[OpenJobKit] Clicking Submit application')
  advance.button.click()
  await sleep(800)
  dismissContinueApplyingReminder()

  // Wait for dialog close or LinkedIn "Application sent" confirmation
  let submitted = false
  const started = Date.now()
  while (Date.now() - started < 8000) {
    await sleep(300)
    if (isApplicationSentConfirmation()) {
      submitted = true
      break
    }
    if (!document.body.contains(modal) || !findEasyApplyModal()) {
      submitted = true
      break
    }
    const stillSubmit = findAdvanceButton(modal)
    if (!stillSubmit || stillSubmit.kind !== 'submit') {
      submitted = true
      break
    }
  }

  if (submitted) {
    try {
      await sendToBackground({
        type: 'SUBMIT_JOB',
        payload: { applicationId },
      })
    } catch (err) {
      console.warn('[OpenJobKit] Failed to mark application as applied:', err)
    }
    if (btn) {
      btn.textContent = '✅ Submitted!'
      btn.disabled = false
    }
  } else if (btn) {
    btn.textContent = '⚠️ Submit may have failed — check LinkedIn'
    btn.disabled = false
  }
}

function isApplicationSentConfirmation(): boolean {
  const text = (document.body.innerText ?? '').toLowerCase()
  return (
    text.includes('application sent') ||
    text.includes('your application was sent') ||
    text.includes('application was submitted') ||
    !!document
      .querySelector(
        '[data-test-modal-id="application-sent"], .artdeco-modal__header h2, .jpac-modal-header',
      )
      ?.textContent?.toLowerCase()
      .includes('application')
  )
}

async function fillCurrentPage(
  modal: HTMLElement,
  applicationId: string,
  opts: {
    activateSession: boolean
    advance?: boolean
    allowEmpty?: boolean
  },
): Promise<{ applyMode?: 'review' | 'semi-auto' | 'auto' } | void> {
  const session = modalSessions.get(modal)
  if (session?.filling) return

  let root = resolveApplyFormRoot(modal)
  let fields = detectFormFields(root)

  // If the shell opened but LazyColumn has not painted yet, wait
  if (fields.length === 0) {
    root = await waitForApplyFormReady(modal)
    fields = detectFormFields(root)
  }

  if (fields.length === 0) {
    if (opts.allowEmpty) return
    const raw = countRawControls(root)
    throw new Error(
      raw > 0
        ? `Found ${raw} form controls but could not read their labels. Refresh the Apply dialog and try again.`
        : 'No fillable fields on this Easy Apply step yet. Wait for Email/Phone to appear, then Autofill again.',
    )
  }

  if (session) {
    session.filling = true
    session.lastFingerprint = fieldFingerprint(modal)
  }

  const btn =
    (modal.querySelector('#ojk-fill-btn') as HTMLButtonElement | null) ??
    (document.querySelector('#ojk-fill-btn') as HTMLButtonElement | null)
  if (btn) {
    btn.textContent = '⏳ Filling...'
    btn.disabled = true
  }

  try {
    const job = scrapeJobDetails() ?? undefined
    const result = await sendToBackground<{
      answers: Record<string, string>
      coverLetter?: string
      applyMode?: 'review' | 'semi-auto' | 'auto'
    }>({
      type: 'FILL_JOB',
      payload: { applicationId, fields, job },
    })

    if (result?.answers) {
      applyAnswers(root, fields, result.answers, result.coverLetter)
      if (opts.activateSession) {
        modal.setAttribute(AUTOFILL_ACTIVE, 'true')
        root.setAttribute(AUTOFILL_ACTIVE, 'true')
      }
      if (session) {
        session.lastFingerprint = fieldFingerprint(modal)
      }
      if (btn && !opts.advance) {
        btn.textContent = '✅ Filled!'
        btn.disabled = false
      }

      if (opts.advance) {
        const advance = findAdvanceButton(modal)
        if (advance && advance.kind !== 'submit') {
          const beforeFp = fieldFingerprint(modal)
          advance.button.click()
          await sleep(300)
          await waitForStepChange(modal, beforeFp)
        }
      }
    } else if (btn) {
      btn.textContent = '✨ Auto-Fill with AI'
      btn.disabled = false
    }

    return { applyMode: result?.applyMode }
  } catch (err) {
    console.error('[OpenJobKit] Fill error:', err)
    if (btn) {
      btn.textContent = '❌ Error — retry'
      btn.disabled = false
    }
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    if (session) session.filling = false
  }
}

function detectFormFields(container: HTMLElement): Array<FormField> {
  const fields: Array<FormField> = []
  const seen = new Set<Element>()

  collectRadioFields(container, fields, seen)
  collectCheckboxFields(container, fields, seen)

  const controls = container.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea, select',
  )

  controls.forEach((el) => {
    if (seen.has(el)) return
    seen.add(el)

    if (el.disabled) return
    if (el instanceof HTMLInputElement) {
      if (
        el.type === 'hidden' ||
        el.type === 'radio' ||
        el.type === 'checkbox' ||
        el.type === 'file' ||
        el.type === 'submit' ||
        el.type === 'button'
      ) {
        return
      }
    }

    const questionRoot =
      el.closest('[data-test-form-element]') ??
      el.closest('fieldset') ??
      el.closest('[class*="form-element"]')

    const label =
      (questionRoot
        ? preferVisuallyHiddenText(questionRoot.querySelector('label, legend'))
        : null) ??
      findLabel(el, container) ??
      inferLabelFallback(el) ??
      `Field ${fields.length + 1}`

    const fieldId = `field_${fields.length}`
    el.setAttribute('data-ojk-field', fieldId)

    const maxLength = inferMaxLength(el, questionRoot)

    fields.push({
      id: fieldId,
      label,
      type:
        el instanceof HTMLSelectElement
          ? 'select'
          : el.tagName === 'TEXTAREA'
            ? 'textarea'
            : el instanceof HTMLInputElement && el.type === 'number'
              ? 'number'
              : 'text',
      required: el.required || label.endsWith('*') || label.endsWith('*'),
      placeholder:
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.placeholder
          : undefined,
      options:
        el instanceof HTMLSelectElement
          ? Array.from(el.options)
              .map((o) => o.text.trim())
              .filter(Boolean)
          : undefined,
      selector: `[data-ojk-field="${fieldId}"]`,
      maxLength,
      min: el instanceof HTMLInputElement ? el.min || undefined : undefined,
      max: el instanceof HTMLInputElement ? el.max || undefined : undefined,
    })
  })

  // Detect resume upload step (informational; file path inject is not possible in extensions)
  const fileInput =
    container.querySelector<HTMLInputElement>('input[type="file"]')
  if (fileInput && !seen.has(fileInput)) {
    const hasAttachment =
      !!container.querySelector(
        'button[aria-label*="Remove" i], .ui-attachment, [class*="ui-attachment"]',
      ) || !!container.querySelector('input[type="radio"][checked]')
    if (!hasAttachment) {
      console.log(
        '[OpenJobKit] Resume upload step detected — select a LinkedIn saved resume or upload manually',
      )
    }
  }

  if (fields.length === 0) {
    const sdui = document.querySelector<HTMLElement>(
      '[data-sdui-screen*="EasyApply"], [data-sdui-screen*="easyapply"]',
    )
    if (sdui && !container.contains(sdui) && container !== sdui) {
      return detectFormFields(sdui)
    }
  }

  return fields
}

function preferVisuallyHiddenText(el: Element | null): string | null {
  if (!el) return null
  const hidden = el.querySelector('.visually-hidden')
  return cleanLabelText(hidden?.textContent) ?? cleanLabelText(el.textContent)
}

/** Read maxlength from the input or LinkedIn's "of N characters" hint. */
function inferMaxLength(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  questionRoot: Element | null,
): number | undefined {
  if (el instanceof HTMLSelectElement) return undefined
  if (el.maxLength > 0 && el.maxLength < 500_000) return el.maxLength

  const scope = questionRoot ?? el.parentElement
  const hint = scope?.textContent ?? ''
  const m = hint.match(/of\s+(\d+)\s+characters?/i)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n > 0 && n < 500_000) return n
  }
  return undefined
}

function collectRadioFields(
  container: HTMLElement,
  fields: Array<FormField>,
  seen: Set<Element>,
) {
  const radios = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((r) => !r.disabled)

  const groups = new Map<string, Array<HTMLInputElement>>()
  for (const radio of radios) {
    if (seen.has(radio)) continue
    const key =
      radio.name || radio.closest('fieldset')?.id || `anon_radio_${groups.size}`
    const list = groups.get(key) ?? []
    list.push(radio)
    groups.set(key, list)
  }

  for (const [, inputs] of groups) {
    if (inputs.length === 0) continue
    inputs.forEach((r) => seen.add(r))

    const fieldset =
      inputs[0].closest(
        'fieldset[data-test-form-builder-radio-button-form-component="true"]',
      ) ?? inputs[0].closest('fieldset')

    const titleEl =
      fieldset?.querySelector(
        '[data-test-form-builder-radio-button-form-component__title]',
      ) ??
      fieldset?.querySelector('legend') ??
      inputs[0]
        .closest('[data-test-form-element]')
        ?.querySelector('label, legend, span')

    const label =
      preferVisuallyHiddenText(titleEl ?? null) ??
      findLabel(inputs[0], container) ??
      `Choice ${fields.length + 1}`

    const options = inputs.map((inp) => {
      const forLabel = labelTextForControl(inp, container)
      return forLabel || inp.value || 'Option'
    })

    const fieldId = `field_${fields.length}`
    const anchor = (fieldset as HTMLElement | null) ?? inputs[0]
    anchor.setAttribute('data-ojk-field', fieldId)
    inputs.forEach((inp) => {
      inp.setAttribute('data-ojk-radio-group', fieldId)
    })

    fields.push({
      id: fieldId,
      label,
      type: 'radio',
      required: inputs.some((i) => i.required),
      options,
      selector: `[data-ojk-field="${fieldId}"]`,
    })
  }
}

function collectCheckboxFields(
  container: HTMLElement,
  fields: Array<FormField>,
  seen: Set<Element>,
) {
  const boxes = container.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  )

  boxes.forEach((el) => {
    if (seen.has(el) || el.disabled) return
    seen.add(el)

    // Job-details page alert toggles — skip
    if (el.getAttribute('role') === 'switch') return
    if (el.closest('[id*="JobAlert"], [id*="JobDetails_JobAlert"]')) return

    const optionText = labelTextForControl(el, container) ?? 'Checkbox'
    const questionRoot =
      el.closest('[data-test-form-element]') ?? el.closest('fieldset')
    const questionLabel = preferVisuallyHiddenText(
      questionRoot?.querySelector(
        'legend, [data-test-form-builder-checkbox-form-component__title], .visually-hidden',
      ) ?? null,
    )

    const label =
      questionLabel && questionLabel !== optionText
        ? `${questionLabel} [${optionText}]`
        : optionText

    const fieldId = `field_${fields.length}`
    el.setAttribute('data-ojk-field', fieldId)

    fields.push({
      id: fieldId,
      label,
      type: 'checkbox',
      required: el.required,
      options: ['Yes', 'No'],
      selector: `[data-ojk-field="${fieldId}"]`,
      context:
        el.id === 'follow-company-checkbox' ? 'follow-company' : undefined,
    })
  })
}

function labelTextForControl(
  el: HTMLInputElement,
  container: HTMLElement,
): string | null {
  if (el.id) {
    for (const label of [
      ...container.querySelectorAll('label'),
      ...document.querySelectorAll('label'),
    ]) {
      if (label.htmlFor === el.id || label.getAttribute('for') === el.id) {
        return (
          preferVisuallyHiddenText(label) ?? cleanLabelText(label.textContent)
        )
      }
    }
  }
  const parentLabel = el.closest('label')
  if (parentLabel) return preferVisuallyHiddenText(parentLabel)
  return null
}

function isVisibleField(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).hidden) return false
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 || style.opacity !== '0'
}

function cleanLabelText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw.replace(/\s+/g, ' ').replace(/\*$/, '').trim()
  return text || null
}

function findLabel(el: HTMLElement, container: HTMLElement): string | null {
  const aria = el.getAttribute('aria-label')
  if (aria) return cleanLabelText(aria)

  const id = el.id
  if (id) {
    // Match by htmlFor — LinkedIn uses Unicode ids like «rj» where CSS.escape breaks [for=…]
    for (const label of container.querySelectorAll('label')) {
      if (label.htmlFor === id || label.getAttribute('for') === id) {
        return (
          preferVisuallyHiddenText(label) ?? cleanLabelText(label.textContent)
        )
      }
    }
    for (const label of document.querySelectorAll('label')) {
      if (label.htmlFor === id || label.getAttribute('for') === id) {
        return (
          preferVisuallyHiddenText(label) ?? cleanLabelText(label.textContent)
        )
      }
    }
  }

  // SDUI: label is often a sibling block above the control wrapper
  const block = el.closest('div')
  const parent = block?.parentElement
  if (parent) {
    const siblingLabel = parent.querySelector(':scope > label')
    if (siblingLabel) {
      return (
        preferVisuallyHiddenText(siblingLabel) ??
        cleanLabelText(siblingLabel.textContent)
      )
    }
    const anyLabel = parent.querySelector('label')
    if (anyLabel && parent.contains(el)) {
      return (
        preferVisuallyHiddenText(anyLabel) ??
        cleanLabelText(anyLabel.textContent)
      )
    }
  }

  const classic = el.closest(
    'fieldset, .artdeco-text-input--container, [class*="form-field"], [data-test-form-element]',
  )
  if (classic) {
    const label = classic.querySelector('label, legend')
    if (label) {
      return (
        preferVisuallyHiddenText(label) ?? cleanLabelText(label.textContent)
      )
    }
  }

  return null
}

function inferLabelFallback(el: HTMLElement): string | null {
  const described = el.getAttribute('aria-describedby')
  if (described) {
    const tip = document.getElementById(described)
    const t = cleanLabelText(tip?.textContent)
    if (t) return t
  }
  if (el instanceof HTMLInputElement && el.type === 'tel') return 'Phone'
  if (el instanceof HTMLInputElement && el.type === 'email') return 'Email'
  if (el instanceof HTMLSelectElement) {
    const sample = el.options[0]?.text?.toLowerCase() ?? ''
    if (sample.includes('+') || sample.includes('united')) {
      return 'Phone country code'
    }
    if (sample.includes('@')) return 'Email'
  }
  return null
}

function getSelector(el: HTMLElement): string {
  const tagged = el.getAttribute('data-ojk-field')
  if (tagged) return `[data-ojk-field="${tagged}"]`
  if (el.id) {
    try {
      return `#${CSS.escape(el.id)}`
    } catch {
      return `[id="${el.id.replace(/"/g, '\\"')}"]`
    }
  }
  const inputEl = el as HTMLInputElement
  if (inputEl.name) return `[name="${inputEl.name.replace(/"/g, '\\"')}"]`
  return el.tagName.toLowerCase()
}

const YES_PHRASES = [
  'yes',
  'y',
  'true',
  'agree',
  'accept',
  'i agree',
  'i accept',
]
const NO_PHRASES = [
  'no',
  'n',
  'false',
  'decline',
  'disagree',
  'prefer not',
  'prefer not to say',
  'do not',
  "don't",
]

function normalizeMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isAffirmativeAnswer(value: string): boolean {
  const v = normalizeMatchText(value)
  if (NO_PHRASES.some((p) => v === p || v.startsWith(p + ' '))) return false
  return YES_PHRASES.some((p) => v === p || v.startsWith(p + ' '))
}

function matchSelectOption(
  el: HTMLSelectElement,
  value: string,
): HTMLOptionElement | undefined {
  const options = Array.from(el.options)
  const v = value.trim()
  const vn = normalizeMatchText(v)

  const exact =
    options.find((o) => o.text === v || o.value === v) ??
    options.find(
      (o) =>
        normalizeMatchText(o.text) === vn || normalizeMatchText(o.value) === vn,
    )
  if (exact) return exact

  if (YES_PHRASES.includes(vn)) {
    const yes = options.find((o) =>
      YES_PHRASES.includes(normalizeMatchText(o.text)),
    )
    if (yes) return yes
  }
  if (NO_PHRASES.some((p) => vn === p || vn.includes(p))) {
    const no = options.find((o) => {
      const t = normalizeMatchText(o.text)
      return NO_PHRASES.some((p) => t === p || t.includes(p))
    })
    if (no) return no
  }

  return options.find(
    (o) =>
      normalizeMatchText(o.text).includes(vn) ||
      vn.includes(normalizeMatchText(o.text)) ||
      (vn.length >= 2 && normalizeMatchText(o.value) === vn),
  )
}

function matchRadioInput(
  inputs: Array<HTMLInputElement>,
  value: string,
  container: HTMLElement,
): HTMLInputElement | undefined {
  const vn = normalizeMatchText(value)
  const labeled = inputs.map((inp) => ({
    inp,
    text: normalizeMatchText(
      labelTextForControl(inp, container) ?? inp.value ?? '',
    ),
  }))

  return (
    labeled.find((o) => o.text === vn)?.inp ??
    labeled.find((o) => o.text.includes(vn) || vn.includes(o.text))?.inp ??
    (YES_PHRASES.includes(vn)
      ? labeled.find((o) => YES_PHRASES.includes(o.text))?.inp
      : undefined) ??
    (NO_PHRASES.some((p) => vn === p || vn.includes(p))
      ? labeled.find((o) => NO_PHRASES.some((p) => o.text.includes(p)))?.inp
      : undefined)
  )
}

function isCoverLetterLabel(label: string): boolean {
  const lower = label.toLowerCase()
  return lower.includes('cover letter') || lower.includes('cover-letter')
}

function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  el.focus()
  const proto =
    el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  descriptor?.set?.call(el, '')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  descriptor?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

/** LinkedIn numeric/years/notice fields reject prose — normalize before typing. */
function coerceForDom(field: FormField, value: string): string {
  return coerceAnswerForField(field, value)
}

function clickRadioOrCheckbox(
  input: HTMLInputElement,
  container: HTMLElement,
  checked: boolean,
) {
  if (input.type === 'checkbox') {
    if (input.checked === checked) return
  } else if (input.type === 'radio') {
    if (input.checked && checked) return
  }

  let label: HTMLElement | null | undefined = null
  if (input.id) {
    try {
      label = container.querySelector(
        `label[for="${CSS.escape(input.id)}"]`,
      ) as HTMLLabelElement | null
    } catch {
      label = null
    }
    if (!label) {
      label = Array.from(document.querySelectorAll('label')).find(
        (l) => l.htmlFor === input.id || l.getAttribute('for') === input.id,
      )
    }
  }
  if (!label) label = input.closest('label')

  if (label) {
    label.click()
  } else {
    input.click()
  }

  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function applyAnswers(
  modal: HTMLElement,
  fields: Array<FormField>,
  answers: Record<string, string>,
  coverLetter?: string,
) {
  fields.forEach((field) => {
    let value = answers[field.id]

    if (coverLetter && isCoverLetterLabel(field.label)) {
      value = coverLetter
    }

    if (value === undefined || value === null) return
    value = coerceForDom(field, String(value))
    if (!value && field.type !== 'checkbox') return

    if (field.type === 'radio') {
      const inputs = Array.from(
        modal.querySelectorAll<HTMLInputElement>(
          `input[type="radio"][data-ojk-radio-group="${field.id}"]`,
        ),
      )
      const matched = matchRadioInput(inputs, value, modal)
      if (matched) clickRadioOrCheckbox(matched, modal, true)
      return
    }

    if (field.type === 'checkbox') {
      const el = modal.querySelector<HTMLInputElement>(field.selector)
      if (!el) return
      // Never auto-check "follow company" unless answer is explicitly affirmative
      const want = isAffirmativeAnswer(value)
      if (field.context === 'follow-company' && !want) {
        if (el.checked) clickRadioOrCheckbox(el, modal, false)
        return
      }
      clickRadioOrCheckbox(el, modal, want)
      return
    }

    const el = modal.querySelector<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(field.selector)
    if (!el) return

    if (el instanceof HTMLSelectElement) {
      const option = matchSelectOption(el, value)
      if (option) {
        el.value = option.value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    } else {
      setNativeValue(el, value)
    }
  })

  if (coverLetter) {
    fields.forEach((field) => {
      if (!isCoverLetterLabel(field.label)) return
      const el = modal.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        field.selector,
      )
      if (!el || el instanceof HTMLSelectElement) return
      if (el.value?.trim()) return
      setNativeValue(el, coverLetter)
    })
  }
}
