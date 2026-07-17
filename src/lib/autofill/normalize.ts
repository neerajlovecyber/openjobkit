// Normalize autofill answers for LinkedIn-style validation
// (ported patterns from linkedin-auto-job-applier-ai: numeric notice/years/salary)

import type { FormField } from '@/types/messages'
import type { UserProfile } from '@/types/profile'

export function isNoticePeriodQuestion(label: string): boolean {
  const l = label.toLowerCase()
  return (
    /\bnotice\b/.test(l) ||
    /\bcan you join\b/.test(l) ||
    /\bjoining\b/.test(l) ||
    /\bavailable to (start|join)\b/.test(l) ||
    /\bwhen can you (start|join)\b/.test(l)
  )
}

export function isYearsExperienceQuestion(label: string): boolean {
  const l = label.toLowerCase()
  if (
    /\b(authorized|sponsor|visa|relocat|gender|disability|veteran)\b/.test(l)
  ) {
    return false
  }
  if (isNoticePeriodQuestion(l)) return false
  return (
    /\bhow many\b/.test(l) ||
    (/\byears?\b/.test(l) &&
      (/\bexperience\b/.test(l) || /\bwith\b/.test(l) || /\bwork\b/.test(l))) ||
    (/\bexperience\b/.test(l) &&
      (/\bwith\b/.test(l) || /\bin\b/.test(l)) &&
      !/\b(describe|tell us|summary)\b/.test(l))
  )
}

/** Questions where LinkedIn usually expects digits only. */
export function isStrictNumericQuestion(label: string): boolean {
  const l = label.toLowerCase()
  if (isNoticePeriodQuestion(l)) return true
  if (isSalaryCtcQuestion(l)) return true
  if (isYearsExperienceQuestion(l)) return true
  return (
    /\bhow many\b/.test(l) ||
    /\bgpa\b/.test(l) ||
    /\bscale of\b/.test(l) ||
    /\brating\b/.test(l)
  )
}

export function isSalaryCtcQuestion(label: string): boolean {
  const l = label.toLowerCase()
  return (
    /\bctc\b/.test(l) ||
    (/\b(salary|compensation|pay)\b/.test(l) && !/\bpaypal\b/.test(l))
  )
}

export function isAdditionalMonthsQuestion(label: string): boolean {
  const l = label.toLowerCase()
  return (
    /\bmonths?\b/.test(l) &&
    /\b(experience|additional)\b/.test(l) &&
    !/\byears?\b/.test(l)
  )
}

/**
 * LinkedIn CTC fields want digits only, e.g. 200000 (INR annual).
 * Parses lakhs/LPA and strips currency prose.
 */
export function parseSalaryToNumber(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const t = raw.trim().toLowerCase().replace(/,/g, '')
  if (/open to discussion|negotiable|not applicable|n\/a/.test(t)) return null

  const lakh = t.match(/([\d.]+)\s*(lakh|lac|lpa)/)
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100_000)

  const crore = t.match(/([\d.]+)\s*crore/)
  if (crore) return Math.round(parseFloat(crore[1]) * 10_000_000)

  const digits = t.replace(/[^\d]/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

export function salaryAnswerForProfile(
  profile: UserProfile,
  label: string,
  field?: FormField,
): string {
  const l = label.toLowerCase()
  const isCurrent = /\bcurrent\b|\bpresent\b|\bexisting\b/.test(l)
  const isMonthly = /\bmonth(ly)?\b/.test(l)

  let raw: string | undefined
  if (isCurrent) {
    raw =
      profile.cachedAnswers?.['current ctc'] ||
      profile.cachedAnswers?.['current salary'] ||
      profile.cachedAnswers?.['current compensation']
  } else {
    raw =
      profile.desiredSalary ||
      profile.cachedAnswers?.['expected ctc'] ||
      profile.cachedAnswers?.['expected salary'] ||
      profile.cachedAnswers?.['desired salary']
  }

  let amount = parseSalaryToNumber(raw)
  // Sensible INR annual defaults when profile has no number
  if (amount == null) {
    amount = isCurrent ? 600_000 : 900_000
  }
  if (isMonthly) amount = Math.round(amount / 12)

  const asStr = String(amount)
  if (field?.options?.length) {
    return fuzzyPickNumericOption(field.options, amount) ?? asStr
  }
  if (field?.maxLength && asStr.length > field.maxLength) {
    return asStr.slice(0, field.maxLength)
  }
  return asStr
}

export function monthsExperienceAnswer(
  profile: UserProfile,
  field?: FormField,
): string {
  const cached =
    profile.cachedAnswers?.['additional months'] ||
    profile.cachedAnswers?.['months of experience']
  const n = parseSalaryToNumber(cached) ?? 0
  if (field?.options?.length) {
    return fuzzyPickNumericOption(field.options, n) ?? String(n)
  }
  return String(Math.max(0, Math.min(12, n)))
}

export type NoticeUnit = 'days' | 'weeks' | 'months'

export function noticeUnitFromLabel(label: string): NoticeUnit {
  const l = label.toLowerCase()
  if (/\bmonths?\b/.test(l)) return 'months'
  if (/\bweeks?\b/.test(l)) return 'weeks'
  return 'days'
}

/**
 * Parse profile notice text into days.
 * Examples: "Immediately available" → 0, "30 days" → 30, "2 weeks" → 14, "1 month" → 30
 */
export function parseNoticePeriodToDays(raw: string | undefined): number {
  if (!raw?.trim()) return 0
  const t = raw.trim().toLowerCase()

  if (/immediate|asap|available now|serving none|no notice|0\s*day/.test(t)) {
    return 0
  }

  const months = t.match(/(\d+(?:\.\d+)?)\s*months?/)
  if (months) return Math.round(parseFloat(months[1]) * 30)

  const weeks = t.match(/(\d+(?:\.\d+)?)\s*weeks?/)
  if (weeks) return Math.round(parseFloat(weeks[1]) * 7)

  const days = t.match(/(\d+(?:\.\d+)?)\s*days?/)
  if (days) return Math.round(parseFloat(days[1]))

  const alone = t.match(/^(\d+(?:\.\d+)?)$/)
  if (alone) return Math.round(parseFloat(alone[1]))

  const anyNum = t.match(/(\d+(?:\.\d+)?)/)
  if (anyNum) return Math.round(parseFloat(anyNum[1]))

  return 0
}

export function formatNoticeForQuestion(
  days: number,
  label: string,
  field?: FormField,
): string {
  const unit = noticeUnitFromLabel(label)
  const n =
    unit === 'months'
      ? Math.round(days / 30)
      : unit === 'weeks'
        ? Math.round(days / 7)
        : days

  if (field?.options?.length) {
    const asStr = String(n)
    const exact = field.options.find(
      (o) => o.trim() === asStr || o.toLowerCase().includes(asStr),
    )
    if (exact) return exact
    // Prefer "Immediate" / "0" style options
    if (n === 0) {
      const imm = field.options.find((o) =>
        /immediate|asap|none|0\b|available/i.test(o),
      )
      if (imm) return imm
    }
    return fuzzyPickNumericOption(field.options, n) ?? asStr
  }

  return String(Math.max(0, n))
}

export function noticeAnswerForProfile(
  profile: UserProfile,
  label: string,
  field?: FormField,
): string {
  const cached = profile.cachedAnswers?.['notice period']
  const raw = cached || profile.noticePeriod || '0'
  const days = parseNoticePeriodToDays(raw)
  return formatNoticeForQuestion(days, label, field)
}

function fuzzyPickNumericOption(
  options: Array<string>,
  n: number,
): string | null {
  const target = String(n)
  for (const opt of options) {
    const m = opt.match(/\d+/)
    if (m && m[0] === target) return opt
  }
  // Closest numeric option
  let best: { opt: string; diff: number } | null = null
  for (const opt of options) {
    const m = opt.match(/\d+/)
    if (!m) continue
    const diff = Math.abs(parseInt(m[0], 10) - n)
    if (!best || diff < best.diff) best = { opt, diff }
  }
  return best?.opt ?? null
}

/** Coerce a single answer to LinkedIn-safe format for the field. */
export function coerceAnswerForField(
  field: FormField,
  value: string,
  profile?: UserProfile,
): string {
  let v = value.trim()
  const label = field.label

  if (isNoticePeriodQuestion(label)) {
    if (!/\d/.test(v) && profile) {
      return noticeAnswerForProfile(profile, label, field)
    }
    const days = parseNoticePeriodToDays(v)
    return formatNoticeForQuestion(days, label, field)
  }

  if (isSalaryCtcQuestion(label)) {
    const parsed = parseSalaryToNumber(v)
    if (parsed != null) {
      v = String(parsed)
    } else if (profile) {
      return salaryAnswerForProfile(profile, label, field)
    } else {
      v = ''
    }
    if (field.options?.length && v) {
      const n = parseInt(v, 10)
      return fuzzyPickNumericOption(field.options, n) ?? v
    }
    if (field.maxLength && field.maxLength > 0 && v.length > field.maxLength) {
      return v.slice(0, field.maxLength)
    }
    return v
  }

  if (isAdditionalMonthsQuestion(label)) {
    const n = parseSalaryToNumber(v) ?? 0
    if (field.options?.length) {
      return fuzzyPickNumericOption(field.options, n) ?? String(n)
    }
    return String(n)
  }

  if (isYearsExperienceQuestion(label) || isStrictNumericQuestion(label)) {
    const m = v.match(/-?\d+(?:\.\d+)?/)
    v = m ? m[0] : v.replace(/[^\d.]/g, '')
    if (field.options?.length && v) {
      const n = parseInt(v, 10)
      if (Number.isFinite(n)) {
        return fuzzyPickNumericOption(field.options, n) ?? v
      }
    }
  }

  if (field.maxLength && field.maxLength > 0 && v.length > field.maxLength) {
    v = v.slice(0, field.maxLength)
  }

  return v
}

export function finalizeFieldAnswers(
  profile: UserProfile,
  fields: Array<FormField>,
  answers: Record<string, string>,
  yearsFallback?: (profile: UserProfile, label: string) => string,
): Record<string, string> {
  const out: Record<string, string> = { ...answers }

  for (const field of fields) {
    let value = out[field.id]
    const label = field.label

    if (
      !String(value ?? '').trim() ||
      (isSalaryCtcQuestion(label) && !/\d/.test(String(value)))
    ) {
      if (isSalaryCtcQuestion(label)) {
        value = salaryAnswerForProfile(profile, label, field)
      } else if (isNoticePeriodQuestion(label)) {
        value = noticeAnswerForProfile(profile, label, field)
      } else if (isAdditionalMonthsQuestion(label)) {
        value = monthsExperienceAnswer(profile, field)
      } else if (isYearsExperienceQuestion(label) && yearsFallback) {
        value = yearsFallback(profile, label.toLowerCase())
        if (field.options?.length) {
          const n = parseInt(String(value).replace(/\D/g, ''), 10)
          if (Number.isFinite(n)) {
            value = fuzzyPickNumericOption(field.options, n) ?? value
          }
        }
      }
    }

    if (value == null || value === '') continue
    out[field.id] = coerceAnswerForField(field, String(value), profile)
  }

  return out
}
