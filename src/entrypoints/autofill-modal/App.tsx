import React, { useMemo } from 'react'

import SettingsApp from '@/components/SettingsApp'
import { sendToBackground } from '@/lib/messaging'

export default function App() {
  const initialTab = useMemo(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    return tab === 'ai' ? 'ai' : 'profile'
  }, [])

  const handleClose = () => {
    void sendToBackground({ type: 'CLOSE_AUTOFILL_MODAL' }).finally(() => {
      try {
        window.close()
      } catch {
        // Ignored
      }
    })
  }

  return (
    <div className="h-full w-full bg-[#0f0f13]">
      <SettingsApp modal initialTab={initialTab} onClose={handleClose} />
    </div>
  )
}
