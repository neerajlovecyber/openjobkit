// Greenhouse content script — stub (Phase 2)
// TODO: Implement Greenhouse board detection and form filling
// Greenhouse boards typically live at: boards.greenhouse.io/<company>/jobs/<id>

export default defineContentScript({
  matches: ['*://boards.greenhouse.io/*', '*://*.greenhouse.io/*'],
  main() {
    console.log('[OpenJobKit] Greenhouse content script loaded — coming soon!')
  },
})
