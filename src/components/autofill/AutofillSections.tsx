import React from 'react'

import {
  AUTOFILL_SECTIONS,
  sectionNeedsAttention,
} from '@/components/autofill/sections'

import type { AutofillSection } from '@/components/autofill/sections'
import type {
  Education,
  Skill,
  UserProfile,
  WorkExperience,
} from '@/types/profile'
import type { UserSettings } from '@/types/settings'

const fieldClass =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-violet-500 focus:bg-white/8'
const labelClass = 'mb-1 block text-xs font-medium text-white/60'
const requiredMark = <span className="text-red-400"> *</span>

function Field({
  label,
  required,
  children,
  className = '',
}: {
  label: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      <label className={labelClass}>
        {label}
        {required ? requiredMark : null}
      </label>
      {children}
    </div>
  )
}

export function AutofillSectionNav({
  section,
  onChange,
  profile,
  settings,
}: {
  section: AutofillSection
  onChange: (s: AutofillSection) => void
  profile: UserProfile
  settings: UserSettings
}) {
  return (
    <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-white/10 bg-[#121218] p-2">
      {AUTOFILL_SECTIONS.map((item) => {
        const active = section === item.id
        const alert = sectionNeedsAttention(item.id, profile, settings)
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
              active
                ? 'bg-white/10 font-semibold text-white shadow-inner'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span>{item.label}</span>
            {alert && (
              <span className="size-1.5 shrink-0 rounded-full bg-red-500" />
            )}
          </button>
        )
      })}
    </nav>
  )
}

export function PersonalSection({
  profile,
  onChange,
}: {
  profile: UserProfile
  onChange: (key: keyof UserProfile, val: unknown) => void
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Field label="First Name" required>
          <input
            className={fieldClass}
            value={profile.firstName}
            onChange={(e) => onChange('firstName', e.target.value)}
            required
          />
        </Field>
        <Field label="Middle Name">
          <input
            className={fieldClass}
            value={profile.middleName || ''}
            onChange={(e) => onChange('middleName', e.target.value)}
          />
        </Field>
        <Field label="Last Name" required>
          <input
            className={fieldClass}
            value={profile.lastName}
            onChange={(e) => onChange('lastName', e.target.value)}
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Preferred First Name">
          <input
            className={fieldClass}
            value={profile.preferredFirstName || ''}
            onChange={(e) => onChange('preferredFirstName', e.target.value)}
          />
        </Field>
        <Field label="Preferred Middle Name">
          <input
            className={fieldClass}
            value={profile.preferredMiddleName || ''}
            onChange={(e) => onChange('preferredMiddleName', e.target.value)}
          />
        </Field>
        <Field label="Preferred Last Name">
          <input
            className={fieldClass}
            value={profile.preferredLastName || ''}
            onChange={(e) => onChange('preferredLastName', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Email Address" required>
        <input
          type="email"
          className={fieldClass}
          value={profile.email}
          onChange={(e) => onChange('email', e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Country Code">
          <input
            className={fieldClass}
            value={profile.phoneCountryCode || ''}
            onChange={(e) => onChange('phoneCountryCode', e.target.value)}
            placeholder="+91"
          />
        </Field>
        <Field label="Phone" required className="col-span-2">
          <input
            className={fieldClass}
            value={profile.phone}
            onChange={(e) => onChange('phone', e.target.value)}
            required
          />
        </Field>
      </div>

      <Field label="Address Line">
        <input
          className={fieldClass}
          value={profile.address || profile.location}
          onChange={(e) => {
            onChange('address', e.target.value)
            onChange('location', e.target.value)
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="LinkedIn URL">
          <input
            type="url"
            className={fieldClass}
            value={profile.linkedinUrl || ''}
            onChange={(e) => onChange('linkedinUrl', e.target.value)}
          />
        </Field>
        <Field label="GitHub URL">
          <input
            type="url"
            className={fieldClass}
            value={profile.githubUrl || ''}
            onChange={(e) => onChange('githubUrl', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Headline">
        <input
          className={fieldClass}
          value={profile.headline}
          onChange={(e) => onChange('headline', e.target.value)}
        />
      </Field>
    </div>
  )
}

export function EducationSection({
  profile,
  onChange,
}: {
  profile: UserProfile
  onChange: (key: keyof UserProfile, val: unknown) => void
}) {
  const items = profile.education

  function update(index: number, patch: Partial<Education>) {
    const next = items.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    )
    onChange('education', next)
  }

  function add() {
    const item: Education = {
      id: crypto.randomUUID(),
      institution: '',
      degree: '',
      field: '',
      startDate: '',
      endDate: null,
    }
    onChange('education', [...items, item])
  }

  function remove(index: number) {
    onChange(
      'education',
      items.filter((_, i) => i !== index),
    )
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-sm text-white/40">No education entries yet.</p>
      )}
      {items.map((edu, index) => (
        <div
          key={edu.id}
          className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">
              Education {index + 1}
            </p>
            <button
              type="button"
              onClick={() => remove(index)}
              className="text-xs text-red-400 hover:underline"
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="School / University" required>
              <input
                className={fieldClass}
                value={edu.institution}
                onChange={(e) => update(index, { institution: e.target.value })}
              />
            </Field>
            <Field label="Degree" required>
              <input
                className={fieldClass}
                value={edu.degree}
                onChange={(e) => update(index, { degree: e.target.value })}
              />
            </Field>
            <Field label="Field of Study" required>
              <input
                className={fieldClass}
                value={edu.field}
                onChange={(e) => update(index, { field: e.target.value })}
              />
            </Field>
            <Field label="GPA">
              <input
                className={fieldClass}
                value={edu.gpa || ''}
                onChange={(e) => update(index, { gpa: e.target.value })}
              />
            </Field>
            <Field label="Start (YYYY-MM)">
              <input
                className={fieldClass}
                value={edu.startDate}
                onChange={(e) => update(index, { startDate: e.target.value })}
                placeholder="2020-08"
              />
            </Field>
            <Field label="End (YYYY-MM)">
              <input
                className={fieldClass}
                value={edu.endDate || ''}
                onChange={(e) =>
                  update(index, { endDate: e.target.value || null })
                }
                placeholder="2024-10"
              />
            </Field>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded-lg border border-dashed border-white/20 px-3 py-2 text-sm font-medium text-white/60 hover:border-violet-400 hover:text-violet-300"
      >
        + Add education
      </button>
    </div>
  )
}

export function ExperienceSection({
  profile,
  onChange,
}: {
  profile: UserProfile
  onChange: (key: keyof UserProfile, val: unknown) => void
}) {
  const items = profile.workExperience

  function update(index: number, patch: Partial<WorkExperience>) {
    const next = items.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    )
    onChange('workExperience', next)
  }

  function add() {
    const item: WorkExperience = {
      id: crypto.randomUUID(),
      company: '',
      title: '',
      location: '',
      startDate: '',
      endDate: null,
      description: '',
      achievements: [],
    }
    onChange('workExperience', [...items, item])
  }

  function remove(index: number) {
    onChange(
      'workExperience',
      items.filter((_, i) => i !== index),
    )
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-sm text-white/40">No work experience yet.</p>
      )}
      {items.map((exp, index) => (
        <div
          key={exp.id}
          className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Role {index + 1}</p>
            <button
              type="button"
              onClick={() => remove(index)}
              className="text-xs text-red-400 hover:underline"
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Job Title" required>
              <input
                className={fieldClass}
                value={exp.title}
                onChange={(e) => update(index, { title: e.target.value })}
              />
            </Field>
            <Field label="Company" required>
              <input
                className={fieldClass}
                value={exp.company}
                onChange={(e) => update(index, { company: e.target.value })}
              />
            </Field>
            <Field label="Location">
              <input
                className={fieldClass}
                value={exp.location}
                onChange={(e) => update(index, { location: e.target.value })}
              />
            </Field>
            <Field label="Start (YYYY-MM)">
              <input
                className={fieldClass}
                value={exp.startDate}
                onChange={(e) => update(index, { startDate: e.target.value })}
              />
            </Field>
            <Field label="End (YYYY-MM or blank if current)">
              <input
                className={fieldClass}
                value={exp.endDate || ''}
                onChange={(e) =>
                  update(index, { endDate: e.target.value || null })
                }
              />
            </Field>
          </div>
          <Field label="Description">
            <textarea
              rows={3}
              className={fieldClass}
              value={exp.description}
              onChange={(e) => update(index, { description: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded-lg border border-dashed border-white/20 px-3 py-2 text-sm font-medium text-white/60 hover:border-violet-400 hover:text-violet-300"
      >
        + Add experience
      </button>
    </div>
  )
}

export function SkillsSection({
  profile,
  onChange,
}: {
  profile: UserProfile
  onChange: (key: keyof UserProfile, val: unknown) => void
}) {
  const [draft, setDraft] = React.useState('')
  const skills = profile.skills

  function addSkill() {
    const name = draft.trim()
    if (!name) return
    if (skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      setDraft('')
      return
    }
    const skill: Skill = { name, level: 'intermediate' }
    onChange('skills', [...skills, skill])
    setDraft('')
  }

  function remove(index: number) {
    onChange(
      'skills',
      skills.filter((_, i) => i !== index),
    )
  }

  function setLevel(index: number, level: Skill['level']) {
    onChange(
      'skills',
      skills.map((s, i) => (i === index ? { ...s, level } : s)),
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className={fieldClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addSkill()
            }
          }}
          placeholder="Add a skill (e.g. Docker)"
        />
        <button
          type="button"
          onClick={addSkill}
          className="shrink-0 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-500"
        >
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {skills.map((skill, index) => (
          <div
            key={`${skill.name}-${index}`}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
          >
            <span>{skill.name}</span>
            <select
              value={skill.level}
              onChange={(e) =>
                setLevel(index, e.target.value as Skill['level'])
              }
              className="rounded border-0 bg-white/10 px-1 py-0.5 text-[11px] text-white/70"
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
              <option value="expert">Expert</option>
            </select>
            <button
              type="button"
              onClick={() => remove(index)}
              className="text-white/40 hover:text-red-400"
              aria-label={`Remove ${skill.name}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {skills.length === 0 && (
        <p className="text-sm text-white/40">No skills added yet.</p>
      )}
    </div>
  )
}

export function PreferencesSection({
  profile,
  onChange,
}: {
  profile: UserProfile
  onChange: (key: keyof UserProfile, val: unknown) => void
}) {
  return (
    <div className="space-y-4">
      <Field label="Target Roles (comma-separated)">
        <input
          className={fieldClass}
          value={profile.targetRoles.join(', ')}
          onChange={(e) =>
            onChange(
              'targetRoles',
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </Field>
      <Field label="Target Locations (comma-separated)">
        <input
          className={fieldClass}
          value={profile.targetLocations.join(', ')}
          onChange={(e) =>
            onChange(
              'targetLocations',
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Remote Preference">
          <select
            className={fieldClass}
            value={profile.remotePreference}
            onChange={(e) =>
              onChange(
                'remotePreference',
                e.target.value as UserProfile['remotePreference'],
              )
            }
          >
            <option value="any">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
          </select>
        </Field>
        <Field label="Notice Period (days)">
          <input
            className={fieldClass}
            placeholder="0 = immediate, 30 = 30 days"
            value={profile.noticePeriod || ''}
            onChange={(e) => onChange('noticePeriod', e.target.value)}
          />
        </Field>
      </div>
      <Field label="Desired salary">
        <input
          className={fieldClass}
          placeholder="Digits only for CTC forms, e.g. 900000"
          value={profile.desiredSalary || ''}
          onChange={(e) => onChange('desiredSalary', e.target.value)}
        />
      </Field>
      <Field label="Current salary (optional)">
        <input
          className={fieldClass}
          placeholder="Digits only, e.g. 600000"
          value={profile.cachedAnswers?.['current ctc'] || ''}
          onChange={(e) =>
            onChange('cachedAnswers', {
              ...profile.cachedAnswers,
              'current ctc': e.target.value,
            })
          }
        />
      </Field>
      <Field label="Summary">
        <textarea
          rows={5}
          className={fieldClass}
          value={profile.summary}
          onChange={(e) => onChange('summary', e.target.value)}
        />
      </Field>
    </div>
  )
}
