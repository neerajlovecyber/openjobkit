// InstantDB permissions for OpenJobKit
// Restricts reading/writing to owner of the records, securing profile details
// and AI keys (settings) in the database.

export default {
  $files: {
    allow: {
      read: 'true',
      create: 'auth.id != null',
      delete: 'auth.id != null',
    },
  },
  profiles: {
    allow: {
      read: 'auth.id != null && auth.id == data.userId',
      create: 'auth.id != null',
      update: 'auth.id != null && auth.id == data.userId',
      delete: 'auth.id != null && auth.id == data.userId',
    },
  },
  settings: {
    allow: {
      read: 'auth.id != null && auth.id == data.userId',
      create: 'auth.id != null',
      update: 'auth.id != null && auth.id == data.userId',
      delete: 'auth.id != null && auth.id == data.userId',
    },
  },
  applications: {
    allow: {
      read: 'auth.id != null && auth.id == data.userId',
      create: 'auth.id != null',
      update: 'auth.id != null && auth.id == data.userId',
      delete: 'auth.id != null && auth.id == data.userId',
    },
  },
}
