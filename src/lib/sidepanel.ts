// Helpers for opening the extension side panel (Chrome Side Panel API)

export type SidepanelView = 'home' | 'settings'

const VIEW_KEY = 'ojkSidepanelView'

/** Persist which view the side panel should show when it opens. */
export async function setSidepanelView(view: SidepanelView): Promise<void> {
  await browser.storage.session.set({ [VIEW_KEY]: view })
}

/** Read + clear the pending view (defaults to home). */
export async function takeSidepanelView(): Promise<SidepanelView> {
  const stored = await browser.storage.session.get(VIEW_KEY)
  const view = stored[VIEW_KEY]
  await browser.storage.session.remove(VIEW_KEY)
  return view === 'settings' ? 'settings' : 'home'
}

/**
 * Open the side panel for the current window.
 * Optionally jump straight to settings (profile / AI).
 */
export async function openSidePanel(
  view: SidepanelView = 'home',
): Promise<void> {
  await setSidepanelView(view)

  if (!browser.sidePanel?.open) {
    // Fallback for browsers without Side Panel API
    await browser.runtime.openOptionsPage()
    return
  }

  const currentWindow = await browser.windows.getCurrent()
  if (currentWindow.id == null) {
    throw new Error('No active window to open side panel in.')
  }

  await browser.sidePanel.open({ windowId: currentWindow.id })
}
