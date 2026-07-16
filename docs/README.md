# docs/

This directory contains reference documentation for AI-assisted development.

## wxt-guide.md

**Source:** https://wxt.dev/guide  
**Fetched via:** https://context7.com/websites/wxt_dev_guide/llms.txt?tokens=20000  
**Context7 library ID:** `/wxt-dev/wxt` (681 snippets, official repo)  
**Alt ID:** `/llmstxt/wxt_dev_llms_txt` (1036 snippets)

Contains 3,900+ lines of WXT documentation including:

- Entrypoint patterns (background, content scripts, popup, options, side panel)
- Manifest configuration
- Content script UI (shadow DOM, React integration)
- Storage API (`wxt/storage`)
- Message passing patterns
- Browser compatibility & targeting
- Publishing guides
- Auto-imports & TypeScript config
- WXT modules system

### Querying live docs

Use Context7 MCP for up-to-date snippets during development:

```
Library: /wxt-dev/wxt
Tool: query-docs
Topic: "content script shadow root react"
```
