import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { reactCompilerPreset } from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { defineConfig, type WxtViteConfig } from 'wxt'

// Automatically create .wxt/chrome-data directory to prevent
// chrome-launcher ENOENT chrome-out.log crashes on Windows.
try {
  fs.mkdirSync(path.resolve(__dirname, '.wxt/chrome-data'), { recursive: true })
} catch (e) {
  // Ignored
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  webExt: {
    // Persists profile changes, tabs, and extensions across dev restarts.
    // This stops Chrome from clearing the extension profile on Vite rebuild.
    keepProfileChanges: true,
  },

  manifest: {
    name: 'OpenJobKit — AI Job Application Assistant',
    description:
      'Auto-fill and apply to jobs on LinkedIn, Indeed, Greenhouse & more using AI. Your profile, your AI key, zero backend.',
    version: '0.1.0',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel', 'tabs'],
    host_permissions: [
      '*://*.linkedin.com/*',
      '*://*.indeed.com/*',
      '*://job-boards.greenhouse.io/*',
      '*://boards.greenhouse.io/*',
      '*://*.greenhouse.io/*',
      '*://*.lever.co/*',
      '*://api.openai.com/*',
      '*://generativelanguage.googleapis.com/*',
    ],
    action: {
      default_title: 'OpenJobKit',
    },
    web_accessible_resources: [
      {
        resources: ['autofill-modal.html'],
        matches: ['<all_urls>'],
      },
    ],
  },

  vite: () =>
    ({
      plugins: [babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        },
      },
    }) satisfies WxtViteConfig,
})
