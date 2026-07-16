import { initGreenhouse } from './content/greenhouse'
import { initIndeed } from './content/indeed'
import { initLinkedin } from './content/linkedin'

export default defineContentScript({
  matches: [
    // Bare linkedin.com AND *.linkedin.com — Chrome's `*.` pattern requires a subdomain
    '*://linkedin.com/jobs/*',
    '*://*.linkedin.com/jobs/*',
    '*://job-boards.greenhouse.io/*',
    '*://boards.greenhouse.io/*',
    '*://*.greenhouse.io/*',
    '*://indeed.com/*',
    '*://*.indeed.com/*',
  ],
  allFrames: true,
  runAt: 'document_end',
  main(ctx) {
    const hostname = window.location.hostname

    if (hostname.includes('greenhouse.io')) {
      initGreenhouse(ctx)
    } else if (hostname.includes('linkedin.com')) {
      initLinkedin(ctx)
    } else if (hostname.includes('indeed.com')) {
      initIndeed(ctx)
    }
  },
})
