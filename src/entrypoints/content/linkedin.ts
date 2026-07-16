// LinkedIn Easy Apply content script
// Detects job forms on LinkedIn and orchestrates the AI autofill flow.
//
// Matches: linkedin.com/jobs/* and linkedin.com/jobs/view/*

import { sendToBackground, onMessage } from '@/lib/messaging'

import type { FormField } from '@/types/messages'

export default defineContentScript({
  matches: ['*://*.linkedin.com/jobs/*'],
  main(ctx) {
    console.log('[OpenJobKit] LinkedIn content script loaded')

    // Watch for Easy Apply modal to open
    const observer = new MutationObserver(() => {
      const modal = document.querySelector('[data-test-modal]')
      if (modal && !modal.getAttribute('data-ojk-detected')) {
        modal.setAttribute('data-ojk-detected', 'true')
        void handleEasyApplyModal(modal as HTMLElement)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // Listen for triggering fill from the popup
    const cleanup = onMessage({
      TRIGGER_FILL: async (msg) => {
        const { applicationId } = msg.payload
        const modal = document.querySelector('[data-test-modal]') as HTMLElement
        if (modal) {
          await fillCurrentPage(modal, applicationId)
        }
      },
    })

    ctx.onInvalidated(() => {
      observer.disconnect()
      cleanup()
    })
  },
})

// ────────────────────────────────────────────────────────────────────────────

async function handleEasyApplyModal(modal: HTMLElement) {
  const job = scrapeJobDetails()
  if (!job) return

  console.log('[OpenJobKit] Easy Apply detected:', job.title)

  // Notify background and get applicationId
  const result = await sendToBackground<{ applicationId: string }>({
    type: 'DETECT_JOB',
    payload: { job, tabId: 0 },
  })

  if (!result?.applicationId) return

  // Inject fill button into the modal
  injectFillButton(modal, result.applicationId)
}

function scrapeJobDetails() {
  // Job title
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

  btn.addEventListener(
    'click',
    () => void fillCurrentPage(modal, applicationId),
  )

  const header = modal.querySelector('.artdeco-modal__header')
  if (header) {
    ;(header as HTMLElement).style.position = 'relative'
    header.appendChild(btn)
  }
}

async function fillCurrentPage(modal: HTMLElement, applicationId: string) {
  const fields = detectFormFields(modal)
  if (fields.length === 0) {
    console.log('[OpenJobKit] No fillable fields found on this page')
    return
  }

  const btn = modal.querySelector('#ojk-fill-btn') as HTMLButtonElement
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
      applyAnswers(fields, result.answers)
      if (btn) btn.textContent = '✅ Filled!'
    }
  } catch (err) {
    console.error('[OpenJobKit] Fill error:', err)
    if (btn) {
      btn.textContent = '❌ Error'
      btn.disabled = false
    }
  }
}

function detectFormFields(container: HTMLElement): Array<FormField> {
  const fields: Array<FormField> = []

  // Text inputs and textareas
  container
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], textarea',
    )
    .forEach((el) => {
      const label = findLabel(el)
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

  // Select dropdowns
  container.querySelectorAll<HTMLSelectElement>('select').forEach((el) => {
    const label = findLabel(el)
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

function findLabel(el: HTMLElement): string | null {
  // Try aria-label
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')

  // Try associated <label>
  const id = el.id
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`)
    if (label) return label.textContent?.trim() ?? null
  }

  // Try closest label or legend
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
  if (el.id) return `#${el.id}`
  const inputEl = el as HTMLInputElement
  if (inputEl.name) return `[name="${inputEl.name}"]`
  return el.tagName.toLowerCase()
}

function applyAnswers(
  fields: Array<FormField>,
  answers: Record<string, string>,
) {
  fields.forEach((field) => {
    const value = answers[field.id]
    if (value === undefined) return

    const el = document.querySelector<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(field.selector)
    if (!el) return

    if (el instanceof HTMLSelectElement) {
      const option = Array.from(el.options).find(
        (o) => o.text === value || o.value === value,
      )
      if (option) el.value = option.value
    } else {
      // Use native input value setter so React/Vue state updates properly
      // Extracted to avoid unbound-method lint error
      const proto =
        el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
      descriptor?.set?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
}
