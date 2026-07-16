// Prompt templates for AI-powered job application filling
// Each template takes structured data and returns a formatted prompt string.

import type { JobListing } from '@/types/job'
import type { FormField } from '@/types/messages'
import type { UserProfile } from '@/types/profile'

// ────────────────────────────────────────────────────────────────────────────
// System Prompt
// ────────────────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an expert job application assistant. Your job is to help users fill out job application forms accurately, concisely, and in a way that maximizes their chances of getting an interview.

Guidelines:
- Always respond in valid JSON format
- Be honest — only claim experience or skills that exist in the user's profile
- Be concise for short-answer fields (1-2 sentences max)
- Be thorough for long-answer/essay fields
- Match the tone of the job posting (startup = casual, enterprise = formal)
- Tailor answers specifically to this job — avoid generic responses`

// ────────────────────────────────────────────────────────────────────────────
// Fill Fields Prompt
// ────────────────────────────────────────────────────────────────────────────

/**
 * Ask the AI to fill all form fields in one request.
 * Returns a JSON object mapping fieldId → answer string.
 */
export function buildFillPrompt(
  profile: UserProfile,
  job: JobListing,
  fields: Array<FormField>,
): string {
  const fieldList = fields
    .map(
      (f, i) =>
        `${i + 1}. ID: "${f.id}" | Label: "${f.label}" | Type: ${f.type}${f.required ? ' (required)' : ''}${f.options ? ` | Options: [${f.options.join(', ')}]` : ''}${f.context ? ` | Context: "${f.context}"` : ''}`,
    )
    .join('\n')

  return `
## Candidate Profile

**Name:** ${profile.firstName} ${profile.lastName}
**Email:** ${profile.email}
**Phone:** ${profile.phone}
**Location:** ${profile.location}
**LinkedIn:** ${profile.linkedinUrl ?? 'N/A'}
**Portfolio:** ${profile.portfolioUrl ?? 'N/A'}

**Headline:** ${profile.headline}

**Summary:**
${profile.summary}

**Work Experience:**
${profile.workExperience
  .map(
    (w) =>
      `- ${w.title} at ${w.company} (${w.startDate} – ${w.endDate ?? 'Present'})\n  ${w.description}`,
  )
  .join('\n')}

**Education:**
${profile.education
  .map(
    (e) =>
      `- ${e.degree} in ${e.field} from ${e.institution} (${e.startDate} – ${e.endDate ?? 'Present'})`,
  )
  .join('\n')}

**Skills:** ${profile.skills.map((s) => s.name).join(', ')}

**Resume Text:**
${profile.resumeText}

---

## Job Details

**Title:** ${job.title}
**Company:** ${job.company}
**Location:** ${job.location}
**Platform:** ${job.platform}

**Job Description:**
${job.description}

---

## Form Fields to Fill

${fieldList}

---

## Instructions

Return a JSON object where each key is a field ID and each value is the answer string.
For select/radio fields, return one of the provided options exactly as written.
For checkbox fields, return "true" or "false".
For file fields, return an empty string (cannot fill files automatically).

Respond ONLY with the JSON object, no markdown, no explanation.
`
}

// ────────────────────────────────────────────────────────────────────────────
// Cover Letter Prompt
// ────────────────────────────────────────────────────────────────────────────

export function buildCoverLetterPrompt(
  profile: UserProfile,
  job: JobListing,
): string {
  return `
Write a compelling, personalized cover letter for the following job application.

**Candidate:** ${profile.firstName} ${profile.lastName}
**Target Role:** ${job.title} at ${job.company}

**Candidate Summary:**
${profile.summary}

**Key Experience:**
${profile.workExperience
  .slice(0, 3)
  .map((w) => `- ${w.title} at ${w.company}: ${w.description}`)
  .join('\n')}

**Job Description:**
${job.description}

Guidelines:
- 3-4 paragraphs maximum
- Opening: Hook with genuine enthusiasm for this specific company/role
- Middle: 2 concrete examples that match the job requirements
- Closing: Clear call to action
- Tone: Professional but personable
- Do NOT start with "I am writing to apply for..."
- Do NOT use clichés like "team player", "hard worker", "passion for..."

Return ONLY the cover letter text, no subject line, no date, no address headers.
`
}
