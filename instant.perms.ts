// InstantDB permissions for OpenJobKit
// Open read/write for now (anonymous sync, user-controlled data).
// Can be tightened later with auth rules.
export default {
  profiles: {
    allow: {
      read: 'true',
      create: 'true',
      update: 'true',
      delete: 'true',
    },
  },
  applications: {
    allow: {
      read: 'true',
      create: 'true',
      update: 'true',
      delete: 'true',
    },
  },
}
