<a id="readme-top"></a>

<br />
<div align="center">
  <h3 align="center">WXT4Me</h3>

  <p align="center">
    An opinionated WXT browser extension template with React 19, TypeScript, TailwindCSS, and React Compiler.
    <br />
    <a href="https://github.com/Jemeni11/wxt4me"><strong>Explore the repo »</strong></a>
    <br />
  </p>
</div>

<br />

## Table of Contents

- [Table of Contents](#table-of-contents)
- [Introduction](#introduction)
- [Features](#features)
- [Installation](#installation)
- [Scripts](#scripts)
- [Contributing](#contributing)
- [Wait a minute, who are you?](#wait-a-minute-who-are-you)
- [License](#license)
- [CHANGELOG](#changelog)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Introduction

Hey! This is a WXT browser extension template with the following installed:

- [WXT](https://wxt.dev/) - Next-gen web extension framework
- [React v19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [TailwindCSS v4](https://tailwindcss.com/)
- [React Compiler](https://react.dev/learn/react-compiler) - Automatic memoization
- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) - Rust-powered formatter
- [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) - Rust-powered linter
- [Husky](https://typicode.github.io/husky/) - Git hooks
- [clsx](https://github.com/lukeed/clsx) + [Tailwind Merge](https://github.com/dcastil/tailwind-merge) - Utility class merging

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Features

- 🌐 **Cross-browser support** targeting Chrome and Firefox from a single codebase
- 📂 **File-based entrypoints** with WXT for zero-config manifest generation
- ⚛️ **React 19** with React Compiler for automatic optimization
- 🎨 **TailwindCSS v4** for styling with Vite integration
- 🪛 **Rust-powered tooling** with Oxfmt and Oxlint for fast formatting and linting
- 🪝 **Husky + Lint-staged** for automated pre-commit hooks
- 📝 **TypeScript** with full type safety

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/Jemeni11/wxt4me.git && cd wxt4me && pnpm install
```

Or use the `Use this template` button on GitHub.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Scripts

Available scripts for development and production:

```bash
# Start development server (Chrome)
pnpm dev

# Start development server (Firefox)
pnpm dev:firefox

# Build for production (Chrome)
pnpm build

# Build for production (Firefox)
pnpm build:firefox

# Package extension as zip (Chrome)
pnpm zip

# Package extension as zip (Firefox)
pnpm zip:firefox

# Type-check without emitting
pnpm compile

# Format code
pnpm format

# Format and fix code
pnpm format:fix

# Lint code
pnpm lint

# Lint and fix code
pnpm lint:fix

# Check formatting and linting
pnpm check

# Fix formatting and linting
pnpm fix
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are welcome! If you'd like to improve WXT4Me, please feel free to submit a pull request.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Wait a minute, who are you?

Hello there! I'm Emmanuel Jemeni, and I am a Frontend Developer.

You can find me on various platforms:

- [LinkedIn](https://www.linkedin.com/in/emmanuel-jemeni)
- [GitHub](https://github.com/Jemeni11)
- [Bluesky](https://bsky.app/profile/jemeni11.bsky.social)
- [Twitter/X](https://twitter.com/Jemeni11_)

If you'd like, you can support me on [GitHub Sponsors](https://github.com/sponsors/Jemeni11/) or [Buy Me A Coffee](https://www.buymeacoffee.com/jemeni11).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

[MIT](LICENSE)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## CHANGELOG

[CHANGELOG](CHANGELOG.md)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
