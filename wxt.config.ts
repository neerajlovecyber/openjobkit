import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { reactCompilerPreset } from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig, type WxtViteConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],

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
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
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
