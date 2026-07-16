import type { UserProfile } from '@/types/profile'
import type { UserSettings } from '@/types/settings'

export type AutofillSection =
  | 'personal'
  | 'education'
  | 'experience'
  | 'skills'
  | 'preferences'
  | 'resume'
  | 'ai'

export const AUTOFILL_SECTIONS: Array<{
  id: AutofillSection
  label: string
}> = [
  { id: 'personal', label: 'Personal' },
  { id: 'education', label: 'Education' },
  { id: 'experience', label: 'Work Experience' },
  { id: 'skills', label: 'Skills' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'resume', label: 'Resume' },
  { id: 'ai', label: 'AI Settings' },
]

export function sectionNeedsAttention(
  section: AutofillSection,
  profile: UserProfile,
  settings: UserSettings,
): boolean {
  switch (section) {
    case 'personal':
      return (
        !profile.firstName ||
        !profile.lastName ||
        !profile.email ||
        !profile.phone
      )
    case 'education':
      return profile.education.length === 0
    case 'experience':
      return profile.workExperience.length === 0
    case 'skills':
      return profile.skills.length === 0
    case 'preferences':
      return profile.targetRoles.length === 0
    case 'resume':
      return !profile.resumeText?.trim()
    case 'ai':
      return !settings.ai.apiKey?.trim()
    default:
      return false
  }
}
