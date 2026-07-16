import { i } from '@instantdb/react'

// InstantDB schema for OpenJobKit
const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    profiles: i.entity({
      userId: i.string().unique().indexed(),
      data: i.json(), // full UserProfile JSON blob
      updatedAt: i.date().indexed(),
    }),
    applications: i.entity({
      userId: i.string().indexed(),
      appId: i.string().unique().indexed(), // JobApplication.id
      job: i.json(),
      status: i.string().indexed(),
      appliedAt: i.string().optional(),
      notes: i.string().optional(),
      coverLetter: i.string().optional(),
      aiGeneratedAnswers: i.json().optional(),
      error: i.string().optional(),
      updatedAt: i.date().indexed(),
    }),
    settings: i.entity({
      userId: i.string().unique().indexed(),
      data: i.json(), // full UserSettings JSON blob
      updatedAt: i.date().indexed(),
    }),
  },
  links: {},
  rooms: {},
})

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema

export type { AppSchema }
export default schema
