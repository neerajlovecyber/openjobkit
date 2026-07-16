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
    // Dedicated persistent Chrome profile for `bun dev` (not your daily Chrome).
    // Login to LinkedIn once here — cookies survive restarts. Do NOT point this
    // at your real Chrome User Data while Chrome is open (profile lock).
    // Windows: path must be absolute (see WXT browser-startup docs).
    chromiumProfile: path.resolve(__dirname, '.wxt/chrome-data'),
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
