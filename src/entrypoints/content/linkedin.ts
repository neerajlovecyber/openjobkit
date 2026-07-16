// LinkedIn Easy Apply content script
// Detects job forms on LinkedIn and orchestrates the AI autofill flow.
// After the first successful Auto-Fill, re-fills each Easy Apply step when
// the user advances (does not auto-click Next/Submit).
//
// Matches: linkedin.com/jobs/* and linkedin.com/jobs/view/*

import type { ContentScriptContext } from 'wxt/utils/content-script-context'

import { sendToBackground, onMessage } from '@/lib/messaging'

import type { FormField } from '@/types/messages'

const AUTOFILL_ACTIVE = 'data-ojk-autofill-active'
const DETECTED = 'data-ojk-detected'
const STEP_DEBOUNCE_MS = 300
const MODAL_WAIT_MS = 8000
const FIELD_WAIT_MS = 10000

/** Per-modal step-watch cleanup + fill lock */
const modalSessions = new WeakMap<
  HTMLElement,
  {
    disconnectStepObserver: () => void
    lastFingerprint: string
    filling: boolean
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
        const formRoot = await waitForApplyFormReady(modal)
        await fillCurrentPage(formRoot, applicationId, {
          activateSession: true,
        })
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

    const started = Date.now()
    while (Date.now() - started < MODAL_WAIT_MS) {
      await sleep(200)
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
    'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea, select',
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
    void fillCurrentPage(modal, applicationId, { activateSession: true })
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
  if (session.filling) return

  const nextFp = fieldFingerprint(modal)
  if (nextFp === session.lastFingerprint) return
  if (nextFp === '') {
    session.lastFingerprint = nextFp
    return
  }

  console.log('[OpenJobKit] Easy Apply step changed — auto-refilling')
  await fillCurrentPage(modal, applicationId, { activateSession: false })
}

function fieldFingerprint(modal: HTMLElement): string {
  return detectFormFields(modal)
    .map((f) => `${f.label}|${f.type}|${f.selector}`)
    .join(';;')
}

async function fillCurrentPage(
  modal: HTMLElement,
  applicationId: string,
  opts: { activateSession: boolean },
) {
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
    const raw = countRawControls(root)
    throw new Error(
      raw > 0
        ? `Found ${raw} form controls but could not read their labels. Refresh the Apply dialog and try again.`
        : 'No fillable fields on this Easy Apply step yet. Wait for Email/Phone to appear, then Autofill again.',
    )
  }

  if (session) {
    session.filling = true
    session.lastFingerprint = fieldFingerprint(root)
  }

  const btn =
    (root.querySelector('#ojk-fill-btn') as HTMLButtonElement | null) ??
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
    }>({
      type: 'FILL_JOB',
      payload: { applicationId, fields, job },
    })

    if (result?.answers) {
      applyAnswers(root, fields, result.answers, result.coverLetter)
      if (opts.activateSession) {
        root.setAttribute(AUTOFILL_ACTIVE, 'true')
        modal.setAttribute(AUTOFILL_ACTIVE, 'true')
      }
      if (session) {
        session.lastFingerprint = fieldFingerprint(root)
      }
      if (btn) {
        btn.textContent = '✅ Filled!'
        btn.disabled = false
      }
    } else if (btn) {
      btn.textContent = '✨ Auto-Fill with AI'
      btn.disabled = false
    }
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
        el.type === 'checkbox'
      ) {
        return
      }
    }
    // Skip strict visibility — SDUI LazyColumn often reports 0x0 briefly

    const label =
      findLabel(el, container) ??
      inferLabelFallback(el) ??
      `Field ${fields.length + 1}`

    const fieldId = `field_${fields.length}`
    el.setAttribute('data-ojk-field', fieldId)

    fields.push({
      id: fieldId,
      label,
      type:
        el instanceof HTMLSelectElement
          ? 'select'
          : el.tagName === 'TEXTAREA'
            ? 'textarea'
            : 'text',
      required: el.required,
      placeholder:
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.placeholder
          : undefined,
      options:
        el instanceof HTMLSelectElement
          ? Array.from(el.options).map((o) => o.text)
          : undefined,
      selector: `[data-ojk-field="${fieldId}"]`,
    })
  })

  // If this root is a shell without controls, search the SDUI EasyApply subtree
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
        return cleanLabelText(label.textContent)
      }
    }
    for (const label of document.querySelectorAll('label')) {
      if (label.htmlFor === id || label.getAttribute('for') === id) {
        return cleanLabelText(label.textContent)
      }
    }
  }

  // SDUI: label is often a sibling block above the control wrapper
  const block = el.closest('div')
  const parent = block?.parentElement
  if (parent) {
    const siblingLabel = parent.querySelector(':scope > label')
    if (siblingLabel) return cleanLabelText(siblingLabel.textContent)
    const anyLabel = parent.querySelector('label')
    if (anyLabel && parent.contains(el)) {
      return cleanLabelText(anyLabel.textContent)
    }
  }

  const classic = el.closest(
    'fieldset, .artdeco-text-input--container, [class*="form-field"]',
  )
  if (classic) {
    const label = classic.querySelector('label, legend')
    if (label) return cleanLabelText(label.textContent)
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

function matchSelectOption(
  el: HTMLSelectElement,
  value: string,
): HTMLOptionElement | undefined {
  const v = value.trim().toLowerCase()
  const options = Array.from(el.options)
  return (
    options.find((o) => o.text === value || o.value === value) ??
    options.find(
      (o) => o.text.toLowerCase() === v || o.value.toLowerCase() === v,
    ) ??
    options.find(
      (o) =>
        o.text.toLowerCase().includes(v) ||
        v.includes(o.text.toLowerCase()) ||
        (v.length >= 2 && o.value.toLowerCase() === v),
    )
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
  const proto =
    el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  descriptor?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
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

    if (value === undefined) return

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
