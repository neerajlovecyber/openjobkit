// Shared TypeScript types for user profile and resume

export interface WorkExperience {
  id: string
  company: string
  title: string
  location: string
  startDate: string // ISO date string "YYYY-MM"
  endDate: string | null // null = current
  description: string
  achievements: Array<string>
}

export interface Education {
  id: string
  institution: string
  degree: string
  field: string
  startDate: string
  endDate: string | null
  gpa?: string
}

export interface Skill {
  name: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert'
}

export interface UserProfile {
  // Personal Info
  firstName: string
  middleName?: string
  lastName: string
  preferredFirstName?: string
  preferredMiddleName?: string
  preferredLastName?: string
  email: string
  phone: string
  phoneCountryCode?: string
  location: string
  address?: string
  linkedinUrl?: string
  githubUrl?: string
  portfolioUrl?: string
  website?: string

  // Professional Summary
  headline: string
  summary: string

  // Experience & Education
  workExperience: Array<WorkExperience>
  education: Array<Education>
  skills: Array<Skill>

  // Documents
  resumeText: string // raw text of resume, used as AI context
  defaultCoverLetter?: string

  // Preferences
  targetRoles: Array<string>
  targetLocations: Array<string>
  desiredSalary?: string
  remotePreference: 'remote' | 'hybrid' | 'onsite' | 'any'
  noticePeriod?: string

  // Common answers cache (reusable answers to frequent questions)
  cachedAnswers: Record<string, string>
}

export type PartialProfile = Partial<UserProfile>
