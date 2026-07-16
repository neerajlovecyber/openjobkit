<a id="readme-top"></a>

<div align="center">
  <img src="public/icon/128.png" alt="OpenJobKit Logo" width="80" height="80" />
  <h1 align="center">OpenJobKit</h1>
  <p align="center">
    <strong>AI-powered browser extension that auto-fills and applies to jobs — faster than any human.</strong>
    <br />
    Cross-browser · No backend · Your AI key · Full control
    <br /><br />
    <a href="#quick-start">Quick Start</a> ·
    <a href="#features">Features</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#roadmap">Roadmap</a>
  </p>
</div>

---

## What is OpenJobKit?

OpenJobKit is a **Chrome & Firefox browser extension** that sits beside you while you browse job boards. It:

1. **Detects** application forms on LinkedIn, Indeed, Greenhouse, Lever, and more
2. **Reads** your saved resume/profile (stored 100% locally)
3. **Asks AI** to generate tailored answers for every question
4. **Auto-fills** the form — cover letters, work history, custom questions
5. **Lets you review** before hitting Apply — you're always in control

No backend. No data sent anywhere except your chosen AI provider. Open source.

---

## Features

| Feature                                   | Status         |
| ----------------------------------------- | -------------- |
| 🤖 AI-powered field autofill              | 🔨 In Progress |
| 📄 Resume / profile editor                | 🔨 In Progress |
| 🔗 LinkedIn Easy Apply support            | 🔨 In Progress |
| 🔗 Indeed Apply support                   | 📋 Planned     |
| 🔗 Greenhouse / Lever support             | 📋 Planned     |
| 📋 Job application tracker                | 📋 Planned     |
| ✍️ AI cover letter generation             | 📋 Planned     |
| 🧠 Multiple AI providers (OpenAI, Gemini) | 📋 Planned     |
| 🦊 Firefox support                        | 📋 Planned     |
| 🌙 Dark mode                              | ✅ Done        |

---

## Architecture

```
OpenJobKit (WXT Browser Extension)
│
├── 📦 Popup          Quick dashboard, apply button, recent jobs
├── ⚙️  Options Page   Full profile editor, AI settings, preferences
├── 📌 Side Panel     Per-job tracker and live fill status (Chrome)
├── 📜 Content Scripts  Injected per job board — detect forms & fill
└── 🔧 Background SW  Orchestration, AI calls, storage, messaging
```

### Message Flow

```
Job Page Load
  ↓
Content Script detects form → extracts job title + description
  ↓
Sends MESSAGE → Background Service Worker
  ↓
Background calls AI API (OpenAI / Gemini)
  ↓
AI returns structured field → answer map
  ↓
Background sends answers back → Content Script fills form
  ↓
Side Panel / Popup shows review UI → User confirms → Apply
```

---

## Project Structure

```
src/
├── assets/                   # Icons and static assets
├── components/               # Shared React UI components
│   ├── ui/                   # Base primitives (shadcn/base-ui)
│   ├── JobCard/
│   ├── ProfileForm/
│   ├── SettingsPanel/
│   └── StatusBadge/
├── entrypoints/
│   ├── background.ts         # Service worker
│   ├── popup/                # Popup UI
│   ├── options/              # Settings page
│   ├── sidepanel/            # Job tracker panel
│   └── content/              # Per-platform content scripts
│       ├── linkedin.ts
│       ├── indeed.ts
│       ├── greenhouse.ts
│       └── lever.ts
├── lib/
│   ├── utils.ts              # Utility helpers
│   ├── storage.ts            # Typed chrome.storage wrappers
│   ├── messaging.ts          # Type-safe message bus
│   └── ai/
│       ├── client.ts         # AI provider abstraction
│       ├── prompts.ts        # Prompt templates
│       └── providers/
│           ├── openai.ts
│           └── gemini.ts
├── modules/
│   ├── profile/              # Resume & profile management
│   ├── jobs/                 # Job listing & application tracking
│   └── autofill/             # DOM fill engine + per-platform strategies
└── types/                    # Shared TypeScript interfaces
    ├── profile.ts
    ├── job.ts
    ├── messages.ts
    └── settings.ts
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) `>= 1.x`
- A Chromium browser (Chrome, Edge, Brave) or Firefox
- An [OpenAI API key](https://platform.openai.com/api-keys) (or Gemini key)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/your-username/openjobkit.git
cd openjobkit

# Install dependencies
bun install

# Start dev server (Chrome)
bun run dev

# Start dev server (Firefox)
bun run dev:firefox
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3` folder

### Load in Firefox

1. Open `about:debugging`
2. Click **This Firefox** → **Load Temporary Add-on**
3. Select any file in `.output/firefox-mv2`

---

## Configuration

On first install, open the **Options page** (right-click extension icon → Options):

1. **Profile tab** — Paste your resume or fill in work experience, skills, education
2. **AI tab** — Enter your OpenAI / Gemini API key (stored locally, never sent to our servers)
3. **Preferences tab** — Choose apply mode (auto vs review-first), toggle platforms

---

## Scripts

```bash
bun run dev              # Dev server (Chrome)
bun run dev:firefox      # Dev server (Firefox)
bun run build            # Production build (Chrome)
bun run build:firefox    # Production build (Firefox)
bun run zip              # Package for Chrome Web Store
bun run zip:firefox      # Package for Firefox Add-ons
bun run compile          # TypeScript type check
bun run lint             # Lint with Oxlint
bun run lint:fix         # Lint + auto-fix
bun run format           # Check formatting (Oxfmt)
bun run format:fix       # Format files
bun run check            # Lint + format check
bun run fix              # Lint fix + format fix
```

---

## Roadmap

### v0.1 — Foundation

- [x] Project scaffold (WXT + React 19 + TS + Tailwind v4)
- [ ] TypeScript type system (profile, job, messages, settings)
- [ ] Typed storage & messaging layer
- [ ] Popup dashboard UI skeleton
- [ ] Options page skeleton

### v0.2 — LinkedIn Support

- [ ] LinkedIn Easy Apply content script
- [ ] Form field detection engine
- [ ] Background ↔ content message protocol

### v0.3 — AI Integration

- [ ] OpenAI provider integration
- [ ] Prompt templates (field fill, cover letter)
- [ ] AI answer → DOM fill pipeline

### v0.4 — Tracker & Polish

- [ ] Side panel job tracker
- [ ] Application status management
- [ ] Gemini provider support
- [ ] Firefox compatibility pass

### v1.0 — Multi-platform

- [ ] Indeed, Greenhouse, Lever support
- [ ] One-click "Apply All" mode
- [ ] Export application history (CSV/JSON)

---

## Tech Stack

|                     | Tool                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| Extension Framework | [WXT](https://wxt.dev/)                                               |
| UI Library          | [React 19](https://react.dev/)                                        |
| Styling             | [TailwindCSS v4](https://tailwindcss.com/)                            |
| Components          | [shadcn/ui](https://ui.shadcn.com/) + [Base UI](https://base-ui.com/) |
| Language            | [TypeScript 5.9](https://www.typescriptlang.org/)                     |
| AI                  | OpenAI / Gemini (pluggable)                                           |
| Runtime             | [Bun](https://bun.sh/)                                                |
| Linting             | [Oxlint](https://oxc.rs/)                                             |
| Formatting          | [Oxfmt](https://oxc.rs/)                                              |

---

## Contributing

Contributions are very welcome! Please open an issue or PR.

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/linkedin-autofill`
3. Commit your changes: `git commit -m 'feat: add linkedin autofill'`
4. Push and open a PR

---

## License

[MIT](LICENSE)

---

## CHANGELOG

See [CHANGELOG.md](CHANGELOG.md)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
