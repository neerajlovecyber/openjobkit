// InstantDB permissions for OpenJobKit
// Restricts reading/writing to owner of the records, securing profile details
// and AI keys (settings) in the database.
// Instant uses `view` (not `read`). Linking a file requires view on $files
// and update on the forward entity (profiles).

import type { InstantRules } from '@instantdb/react'

const rules = {
  $files: {
    allow: {
      view: 'isOwner',
      create: 'isOwner',
      update: 'isOwner',
      delete: 'isOwner',
    },
    bind: [
      'isOwner',
      "auth.id != null && data.path.startsWith('resumes/' + auth.id + '/')",
    ],
  },
  profiles: {
    allow: {
      view: 'auth.id != null && auth.id == data.userId',
      create: 'auth.id != null && auth.id == newData.userId',
      update: 'auth.id != null && auth.id == data.userId',
      delete: 'auth.id != null && auth.id == data.userId',
    },
  },
  settings: {
    allow: {
      view: 'auth.id != null && auth.id == data.userId',
      create: 'auth.id != null && auth.id == newData.userId',
      update: 'auth.id != null && auth.id == data.userId',
      delete: 'auth.id != null && auth.id == data.userId',
    },
  },
  applications: {
    allow: {
      view: 'auth.id != null && auth.id == data.userId',
      create: 'auth.id != null && auth.id == newData.userId',
      update: 'auth.id != null && auth.id == data.userId',
      delete: 'auth.id != null && auth.id == data.userId',
    },
  },
} satisfies InstantRules

export default rules
