// Shared InstantDB client for all extension contexts:
// - UI pages (popup, options, sidepanel): use db.useQuery() for reactive data
// - Background service worker: use db.queryOnce() + db.transact()
//
// All extension pages share the same chrome-extension:// origin, so they
// share the same IndexedDB (InstantDB's local cache). Writes from the
// background SW propagate to UI pages in real-time via db.useQuery() hooks.

import { init } from '@instantdb/react'

import schema from '../../instant.schema'

const APP_ID =
  (import.meta.env.VITE_INSTANT_APP_ID as string) ||
  '1e6712fa-9b64-4e28-8145-4c883bd308b7'

// Namespace for all user data. Use a unique value (e.g. email) for
// multi-device sync. Changing this in options will isolate data to a new
// namespace — useful for separating work/personal profiles.
export const USER_ID = 'default'

export const db = init({ appId: APP_ID, schema })
