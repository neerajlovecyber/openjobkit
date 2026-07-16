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

export function initLinkedin(ctx: ContentScriptContext) {
  console.log('[OpenJobKit] LinkedIn content script loaded')

  // Watch for Easy Apply modal to open / reappear
  const observer = new MutationObserver(() => {
    const modal = document.querySelector(
      '[data-test-modal]',
    ) as HTMLElement | null
    if (modal && !modal.getAttribute(DETECTED)) {
      modal.setAttribute(DETECTED, 'true')
      void handleEasyApplyModal(modal)
    }

    // Modal closed: clear any orphaned session (WeakMap drops with GC; nothing else needed)
    if (!modal) {
      // no-op — sessions are keyed by modal element
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  const cleanup = onMessage({
    PING: () => {
      const modal = document.querySelector('[data-test-modal]')
      if (!modal) return
      if (modal.getAttribute(DETECTED)) {
        if (!modal.querySelector('#ojk-fill-btn')) {
          modal.removeAttribute(DETECTED)
          void handleEasyApplyModal(modal as HTMLElement)
        }
        return
      }
      void handleEasyApplyModal(modal as HTMLElement)
    },
    TRIGGER_FILL: async (msg) => {
      const { applicationId } = msg.payload
      const modal = document.querySelector('[data-test-modal]') as HTMLElement
      if (modal) {
        await fillCurrentPage(modal, applicationId, { activateSession: true })
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

async function handleEasyApplyModal(modal: HTMLElement) {
  const job = scrapeJobDetails()
  if (!job) return

  console.log('[OpenJobKit] Easy Apply detected:', job.title)

  const result = await sendToBackground<{ applicationId: string }>({
    type: 'DETECT_JOB',
    payload: { job, tabId: 0 },
  })

  if (!result?.applicationId) return

  injectFillButton(modal, result.applicationId)
  ensureStepWatcher(modal, result.applicationId)
}

function scrapeJobDetails() {
  const titleEl = document.querySelector(
    '.job-details-jobs-unified-top-card__job-title',
  )
  const companyEl = document.querySelector(
    '.job-details-jobs-unified-top-card__company-name',
  )
  const locationEl = document.querySelector(
    '.job-details-jobs-unified-top-card__bullet',
  )
  const descEl = document.querySelector('.jobs-description__content')

  if (!titleEl || !companyEl) return null

  return {
    platform: 'linkedin' as const,
    url: window.location.href,
    title: titleEl.textContent?.trim() ?? '',
    company: companyEl.textContent?.trim() ?? '',
    location: locationEl?.textContent?.trim() ?? '',
    description: descEl?.textContent?.trim() ?? '',
  }
}

function injectFillButton(modal: HTMLElement, applicationId: string) {
  if (modal.querySelector('#ojk-fill-btn')) return

  const btn = document.createElement('button')
  btn.id = 'ojk-fill-btn'
  btn.textContent = '✨ Auto-Fill with AI'
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

  const header = modal.querySelector('.artdeco-modal__header')
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
    // Modal removed from DOM — stop watching
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
    // Review / empty step — update fingerprint so we don't thrash
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

  const fields = detectFormFields(modal)
  if (fields.length === 0) {
    console.log('[OpenJobKit] No fillable fields found on this page')
    return
  }

  if (session) {
    session.filling = true
    session.lastFingerprint = fieldFingerprint(modal)
  }

  const btn = modal.querySelector('#ojk-fill-btn') as HTMLButtonElement | null
  if (btn) {
    btn.textContent = '⏳ Filling...'
    btn.disabled = true
  }

  try {
    const result = await sendToBackground<{
      answers: Record<string, string>
      coverLetter?: string
    }>({
      type: 'FILL_JOB',
      payload: { applicationId, fields },
    })

    if (result?.answers) {
      applyAnswers(modal, fields, result.answers, result.coverLetter)
      if (opts.activateSession) {
        modal.setAttribute(AUTOFILL_ACTIVE, 'true')
      }
      // Fingerprint after fill (values changed but labels/selectors same)
      if (session) {
        session.lastFingerprint = fieldFingerprint(modal)
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
  } finally {
    if (session) session.filling = false
  }
}

function detectFormFields(container: HTMLElement): Array<FormField> {
  const fields: Array<FormField> = []

  container
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], textarea',
    )
    .forEach((el) => {
      // Skip disabled / non-visible controls (avoid offsetParent — fixed modals break it)
      if (el.disabled || !isVisibleField(el)) return

      const label = findLabel(el, container)
      if (!label) return

      fields.push({
        id: `field_${fields.length}`,
        label,
        type: el.tagName === 'TEXTAREA' ? 'textarea' : 'text',
        required: el.required,
        placeholder: el.placeholder,
        selector: getSelector(el),
      })
    })

  container.querySelectorAll<HTMLSelectElement>('select').forEach((el) => {
    if (el.disabled || !isVisibleField(el)) return

    const label = findLabel(el, container)
    if (!label) return

    fields.push({
      id: `field_${fields.length}`,
      label,
      type: 'select',
      required: el.required,
      options: Array.from(el.options).map((o) => o.text),
      selector: getSelector(el),
    })
  })

  return fields
}

function isVisibleField(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  }
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function findLabel(el: HTMLElement, container: HTMLElement): string | null {
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')

  const id = el.id
  if (id) {
    const label = container.querySelector(`label[for="${CSS.escape(id)}"]`)
    if (label) return label.textContent?.trim() ?? null
  }

  const parent = el.closest(
    'fieldset, .artdeco-text-input--container, [class*="form-field"]',
  )
  if (parent) {
    const label = parent.querySelector('label, legend')
    if (label) return label.textContent?.trim() ?? null
  }

  return null
}

function getSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const inputEl = el as HTMLInputElement
  if (inputEl.name) return `[name="${CSS.escape(inputEl.name)}"]`
  return el.tagName.toLowerCase()
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

    // Prefer generated cover letter for matching fields when available
    if (coverLetter && isCoverLetterLabel(field.label)) {
      value = coverLetter
    }

    if (value === undefined) return

    const el = modal.querySelector<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(field.selector)
    if (!el) return

    if (el instanceof HTMLSelectElement) {
      const option = Array.from(el.options).find(
        (o) => o.text === value || o.value === value,
      )
      if (option) {
        el.value = option.value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    } else {
      setNativeValue(el, value)
    }
  })

  // If cover letter was returned but no field matched via answers ids, still try labels
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
