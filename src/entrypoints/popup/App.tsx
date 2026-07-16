import React, { useEffect, useState } from 'react'

import { openSidePanel } from '@/lib/sidepanel'

/**
 * Fallback UI when the side panel API is unavailable.
 * On Chrome, toolbar clicks open the side panel directly via
 * sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).
 */
export default function App() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void openSidePanel('home')
      .then(() => {
        // Popup can close itself after handing off to the side panel
        window.close()
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  return (
    <div className="w-72 bg-[#0f0f13] px-4 py-5 font-[Inter,sans-serif] text-white">
      {error ? (
        <div className="space-y-3">
          <p className="text-xs text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void openSidePanel('settings')}
            className="w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold"
          >
            Open Settings
          </button>
        </div>
      ) : (
        <p className="text-center text-xs text-white/50">Opening OpenJobKit…</p>
      )}
    </div>
  )
}
