// Greenhouse content script
//
// Covers both embed and standalone Greenhouse boards:
//   - job-boards.greenhouse.io/embed/job_app?...  ← iframe embed (allFrames!)
//   - boards.greenhouse.io/<company>/jobs/<id>    ← standalone page
//   - <company>.greenhouse.io/...                 ← custom domains
//
// Per inject-all-frames skill: allFrames: true required — the /embed/ URL
// is loaded inside an <iframe> on the employer's careers page. Without this
// the content script only runs in the top frame and misses the form entirely.
//
// Per inject-run-at-timing skill: document_end — DOM must be parsed so we
// can query form elements, but we don't need to wait for full page load.

import type { ContentScriptContext } from 'wxt/utils/content-script-context'

import { sendToBackground, onMessage } from '@/lib/messaging'

import type { FormField } from '@/types/messages'

export function initGreenhouse(ctx: ContentScriptContext) {
  console.log(
    '[OpenJobKit] Greenhouse content script loaded',
    window.location.href,
  )

  // Wait for the form to appear (Greenhouse renders async)
  void waitForForm(ctx).then((form) => {
    if (!form) return
    void handleGreenhouseForm(form)
  })

  // Listen for triggering fill from the popup/background
  const cleanup = onMessage({
    PING: () => {
      const form = document.querySelector<HTMLFormElement>(
        '#application_form, form[data-qa="application-form"], form',
      )
      if (form) {
        form.removeAttribute('data-ojk-detected')
        delete form.dataset.ojkDetected
        void handleGreenhouseForm(form)
      }
    },
    TRIGGER_FILL: async (msg) => {
      const { applicationId } = msg.payload
      const form = document.querySelector<HTMLFormElement>(
        '#application_form, form[data-qa="application-form"], form',
      )
      if (form) {
        const btn =
          (document.getElementById('ojk-fill-btn') as HTMLButtonElement) ||
          document.createElement('button')
        await fillForm(form, applicationId, btn)
      }
    },
  })

  ctx.onInvalidated(() => {
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

// ─── Wait for form ────────────────────────────────────────────────────────────

function waitForForm(
  ctx: ContentScriptContext,
): Promise<HTMLFormElement | null> {
  return new Promise((resolve) => {
    // Check immediately first
    const existing = document.querySelector<HTMLFormElement>(
      '#application_form, form[data-qa="application-form"], form',
    )
    if (existing) {
      resolve(existing)
      return
    }

    // Watch for it to appear
    const observer = new MutationObserver(() => {
      const form = document.querySelector<HTMLFormElement>(
        '#application_form, form[data-qa="application-form"], form',
      )
      if (form) {
        observer.disconnect()
        resolve(form)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // Clean up if content script context is invalidated (inject-use-ctx-invalidated)
    ctx.onInvalidated(() => {
      observer.disconnect()
      resolve(null)
    })

    // Timeout after 10s
    setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, 10000)
  })
}

// ─── Main form handler ────────────────────────────────────────────────────────

async function handleGreenhouseForm(form: HTMLFormElement) {
  if (form.dataset.ojkDetected) return
  form.dataset.ojkDetected = 'true'

  const job = scrapeJobDetails()
  console.log('[OpenJobKit] Greenhouse form detected:', job)

  const result = await sendToBackground<{ applicationId: string }>({
    type: 'DETECT_JOB',
    payload: { job, tabId: 0 },
  })

  if (result?.applicationId) {
    injectFillButton(form, result.applicationId)
  }
}

// ─── Scrape job details ───────────────────────────────────────────────────────

function scrapeJobDetails() {
  // Job title — Greenhouse embeds it in the page title or a heading
  const titleEl =
    document.querySelector<HTMLElement>('[data-qa="job-title"]') ??
    document.querySelector<HTMLElement>('.job-title') ??
    document.querySelector<HTMLElement>('h1')

  // Company name — from meta or heading
  const companyEl =
    document.querySelector<HTMLElement>('[data-qa="company-name"]') ??
    document.querySelector<HTMLElement>('.company-name')

  // Location
  const locationEl =
    document.querySelector<HTMLElement>('[data-qa="job-location"]') ??
    document.querySelector<HTMLElement>('.location')

  // Job description
  const descEl = document.querySelector<HTMLElement>(
    '#content, .job-description, [data-qa="job-description"]',
  )

  // Parse company from URL if not in DOM (e.g. for=trace3 query param)
  const urlParams = new URLSearchParams(window.location.search)
  const companyFromUrl = urlParams.get('for') ?? urlParams.get('company') ?? ''

  return {
    platform: 'greenhouse' as const,
    url: window.location.href,
    title: titleEl?.textContent?.trim() ?? document.title,
    company: companyEl?.textContent?.trim() ?? companyFromUrl,
    location: locationEl?.textContent?.trim() ?? '',
    description: descEl?.textContent?.trim() ?? '',
  }
}

// ─── Inject fill button ───────────────────────────────────────────────────────

function injectFillButton(form: HTMLFormElement, applicationId: string) {
  if (document.getElementById('ojk-fill-btn')) return

  const btn = document.createElement('button')
  btn.id = 'ojk-fill-btn'
  btn.type = 'button'
  btn.textContent = '✨ Auto-Fill with AI'
  btn.style.cssText = `
    display: block;
    width: 100%;
    margin-bottom: 16px;
    padding: 10px 16px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.2s;
  `

  btn.addEventListener('click', () => void fillForm(form, applicationId, btn))

  // Insert at the top of the form
  form.insertBefore(btn, form.firstChild)
}

// ─── Fill form ────────────────────────────────────────────────────────────────

async function fillForm(
  form: HTMLFormElement,
  applicationId: string,
  btn: HTMLButtonElement,
) {
  const fields = detectFields(form)
  if (fields.length === 0) {
    btn.textContent = '⚠️ No fillable fields found'
    return
  }

  btn.textContent = '⏳ AI is filling...'
  btn.style.opacity = '0.7'
  btn.disabled = true

  try {
    const result = await sendToBackground<{
      answers: Record<string, string>
      coverLetter?: string
    }>({
      type: 'FILL_JOB',
      payload: { applicationId, fields },
    })

    if (result?.answers) {
      applyAnswers(form, fields, result.answers)
      btn.textContent = '✅ Filled! Review and submit.'
      btn.style.background = 'linear-gradient(135deg, #059669, #10b981)'
    }
  } catch (err) {
    console.error('[OpenJobKit] Fill error:', err)
    btn.textContent = `❌ Error: ${String(err).slice(0, 60)}`
    btn.style.background = 'linear-gradient(135deg, #dc2626, #ef4444)'
    btn.disabled = false
    btn.style.opacity = '1'
  }
}

// ─── Field detection ──────────────────────────────────────────────────────────

function detectFields(form: HTMLFormElement): Array<FormField> {
  const fields: Array<FormField> = []

  form
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], textarea',
    )
    .forEach((el) => {
      const label = findLabel(form, el)
      if (!label) return

      fields.push({
        id: `gh_field_${fields.length}`,
        label,
        type: el.tagName === 'TEXTAREA' ? 'textarea' : 'text',
        required: el.required,
        placeholder: el.placeholder || undefined,
        selector: buildSelector(el),
      })
    })

  form.querySelectorAll<HTMLSelectElement>('select').forEach((el) => {
    const label = findLabel(form, el)
    if (!label) return

    fields.push({
      id: `gh_field_${fields.length}`,
      label,
      type: 'select',
      required: el.required,
      options: Array.from(el.options)
        .filter((o) => o.value)
        .map((o) => o.text),
      selector: buildSelector(el),
    })
  })

  return fields
}

function findLabel(form: HTMLFormElement, el: HTMLElement): string | null {
  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return ariaLabel

  if (el.id) {
    const label = form.querySelector(`label[for="${el.id}"]`)
    if (label) return label.textContent?.trim() ?? null
  }

  const parent = el.closest(
    '.field, [class*="field"], [class*="input"], fieldset, li',
  )
  if (parent) {
    const label = parent.querySelector('label, legend, span[class*="label"]')
    if (label) return label.textContent?.trim() ?? null
  }

  return null
}

function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`
  const input = el as HTMLInputElement
  if (input.name) return `[name="${input.name}"]`
  return el.tagName.toLowerCase()
}

// ─── Apply answers ────────────────────────────────────────────────────────────

function applyAnswers(
  form: HTMLFormElement,
  fields: Array<FormField>,
  answers: Record<string, string>,
) {
  fields.forEach((field) => {
    const value = answers[field.id]
    if (!value) return

    const el = form.querySelector<
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
      // Native setter ensures React/Angular state is updated
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
      descriptor?.set?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
}
