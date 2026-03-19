<p align="center">
  <h1 align="center">Siege</h1>
  <p align="center">
    AI-Powered Agent Development Tool
    <br />
    <a href="README_CN.md">中文文档</a>
    <br />
    <em>From design to implementation, all in one place.</em>
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue" />
  <img src="https://img.shields.io/badge/SQLite-local-green" />
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20GPT%20%7C%20GLM-purple" />
  <img src="https://img.shields.io/badge/i18n-中文%20%7C%20English-orange" />
</p>

---

## Why Siege?

### The Pain Points of Using Claude Code / Codex Directly

If you've been using Claude Code or Codex CLI for real-world projects, you've probably run into these frustrations:

| Pain Point | Description |
|------------|-------------|
| **No project continuity** | Every conversation starts from scratch. You lose context between sessions — no memory of what was planned, what was built, what was reviewed. |
| **No structured workflow** | You go from "idea" to "write code" with nothing in between. No technical design, no task breakdown, no review process. Just raw prompting. |
| **Invisible progress** | There's no dashboard, no timeline, no way to see what's done vs. what's pending. You're managing everything in your head. |
| **No code review** | AI writes code, you merge it. There's no diff viewer, no inline findings, no structured quality gate before code hits your repo. |
| **One-shot execution** | Large tasks fail or produce incomplete results because there's no way to break them into smaller, sequential steps with context passing. |
| **No test generation** | After implementation, testing is manual. There's no AI-driven test case generation tied to what was actually built. |
| **Terminal-only UX** | Everything happens in a terminal. No visual schedule, no Gantt chart, no clickable UI to manage the development lifecycle. |

### How Siege Solves This

Siege wraps Claude Code / Codex into a **full development lifecycle manager** with a visual UI:

```
 Plan  →  Scheme  →  Schedule  →  Execute  →  Review  →  Test
  │         │          │            │           │          │
Describe   AI Gen    Gantt       Claude      Diff View   AI Gen
+ Tags    + Edit    Timeline   Code/Codex   + Findings  + Run
```

- **Persistent context** — Projects, plans, schemes, and execution logs are all stored in SQLite. Pick up where you left off.
- **Structured design** — AI generates technical schemes before writing any code. Review and refine via chat before committing to implementation.
- **Visual task scheduling** — AI breaks work into ordered tasks displayed on a Gantt chart. Each task executes with context from previous tasks.
- **GitHub PR-style code review** — See actual `git diff` with syntax highlighting, file tree navigation, inline AI findings, and one-click AI fix.
- **AI-powered testing** — Auto-generate and run test cases based on what was implemented.
- **Multi-provider AI** — Use Anthropic (Claude), OpenAI (GPT), or GLM (ZhiPu). Works with API keys, proxy relays, or Claude subscription login.

---

## Screenshots

<table>
  <tr>
    <td><img src="docs/screenshots/en/03-project-list.png" alt="Projects" /><br /><em>Project List</em></td>
    <td><img src="docs/screenshots/en/05-scheme-detail.png" alt="Schemes" /><br /><em>AI-Generated Technical Schemes</em></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/09-schedule-gantt.png" alt="Schedule" /><br /><em>Task Schedule with Gantt Chart</em></td>
    <td><img src="docs/screenshots/07-code-review-diff.png" alt="Code Review" /><br /><em>Code Review — File Tree & Diff Viewer</em></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/08-code-review-file.png" alt="Diff Viewer" /><br /><em>Syntax-Highlighted Diff with Inline Findings</em></td>
    <td><img src="docs/screenshots/en/06-settings.png" alt="Settings" /><br /><em>AI Provider & Import Source Configuration</em></td>
  </tr>
</table>

## Core Workflow

**1. Create Project** — Select a local repo or clone from GitHub. AI auto-detects `CLAUDE.md` for project context.

**2. Create Plan** — Describe what you want to build. AI generates a title. Organize in folders, tag as feature/bug/refactor.

**3. Generate Scheme** — AI searches the web and analyzes local code to produce technical proposals. Edit, review, or modify via chat.

**4. Generate Schedule** — AI breaks confirmed schemes into executable tasks with a Gantt chart timeline.

**5. Execute** — Run tasks via Claude Code or Codex CLI with real-time SSE progress streaming. Each task inherits context from previously completed tasks.

**6. Code Review** — View `git diff` with syntax highlighting and file tree navigation. AI reviews for quality, security, and correctness. Findings are pinned to specific lines. Click "AI Fix" for one-click remediation.

**7. Test** — AI generates and runs test cases to verify the implementation.

## Features

### AI Integration
- **Multi-provider**: Anthropic (Claude), OpenAI (GPT), GLM (ZhiPu)
- **Proxy support**: Custom base URL for API relays
- **Claude Code login**: Works with your subscription, no API key needed
- **Session reuse**: Subsequent AI calls in the same plan resume the session (~10x faster)
- **Serial queue**: One AI task at a time, no process pile-up

### Code Review
- **Git diff viewer** with syntax highlighting (highlight.js)
- **File tree sidebar** with collapsible directories, +/- stats, and finding count badges
- **Inline findings** pinned to specific lines with severity badges
- **Inline comments** with AI-generated fix suggestions
- **One-click "AI Fix"** — apply AI suggestions directly to files
- **View mode toggle** — switch between diff view and findings list

### Project Management
- **Folder hierarchy** for organizing plans
- **Tags**: feature, bug, enhancement, refactor, docs, test, chore, perf
- **Recently opened** projects on homepage
- **Custom icons** per project

### Scheme Management
- **AI generation** with provider and skill selection
- **Conversational modification** — chat to refine schemes
- **Version history** with line-by-line diff
- **Scheme review** with severity-tagged findings

### Execution
- **Claude Code** and **Codex CLI** as execution engines
- **Skills integration** from `~/.claude/skills/`
- **SSE real-time progress** streaming
- **Gantt chart** schedule visualization

### Multi-Source Import
- **Markdown** — import plans from local `.md` files
- **Notion** — search pages/databases, import with blocks-to-markdown conversion
- **Jira** — search Epics/Stories via JQL, sub-tasks become schemes
- **Confluence** — search pages via CQL, H2 sections become schemes
- **Feishu** — search wiki docs, import with block-level conversion
- **GitHub Issues** — search issues by repo or globally, labels auto-map to plan tags
- **GitLab Issues** — works with self-hosted instances, search by project or globally
- **MCP Server** — connect any MCP server, import resources as plans
- **Inline setup** — configure new import sources directly in the import dialog, no need to leave

### Data Management
- **Auto-archive** completed plans after configurable days
- **Backup** to Local filesystem, Obsidian vault, or Notion
- **SQLite** — zero-ops, single file database

### i18n
- Full Chinese and English support
- All UI labels, status badges, and messages translated

## Quick Start

```bash
# Clone
git clone https://github.com/Kotodian/siege.git
cd siege

# Install
npm install

# Start
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — the onboarding guide will walk you through GitHub connection, AI configuration, and creating your first project.

### Prerequisites

- **Node.js** 20+
- **Claude Code** (`claude` CLI) — for AI features without API key
- **GitHub CLI** (`gh`) — optional, for GitHub repo integration

### AI Configuration

Siege supports three modes for AI access:

| Mode | Speed | Setup |
|------|-------|-------|
| **API Key** | Fast (streaming) | Get key from provider console |
| **Proxy/Relay** | Fast | Custom base URL + key |
| **Claude Login** | ~1-2 min/call | Just `claude login`, no key needed |

Configure in **Settings** or during onboarding.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | SQLite (Drizzle ORM + better-sqlite3) |
| Styling | Tailwind CSS 4 |
| AI SDK | Vercel AI SDK + Claude/Codex CLI fallback |
| i18n | next-intl |
| Syntax Highlighting | highlight.js |
| Markdown | react-markdown + rehype-highlight |
| Charts | frappe-gantt |
| Testing | Vitest |

## Project Structure

```
src/
├── app/
│   ├── [locale]/          # i18n pages
│   │   ├── page.tsx       # Project list / Onboarding
│   │   ├── projects/      # Project detail, Plan detail
│   │   └── settings/      # AI config, Skills, Archive
│   └── api/               # REST API routes
│       ├── projects/      # CRUD + analyze
│       ├── plans/         # CRUD + confirm + suggest-title
│       ├── schemes/       # CRUD + generate + chat + versions
│       ├── schedules/     # CRUD + generate
│       ├── reviews/       # CRUD + generate
│       ├── review-comments/  # Inline comments + AI fix
│       ├── snapshots/     # Git diff data
│       ├── test-suites/   # CRUD + generate + run
│       └── execute/       # Task execution via AI SDK
├── lib/
│   ├── ai/                # Provider, generators, CLI fallback, session, queue
│   ├── db/                # Drizzle schema + migrations
│   ├── diff.ts            # Shared diff computation with line numbers
│   ├── backup/            # Local, Obsidian, Notion backends
│   └── ...
├── components/
│   ├── scheme/            # Scheme cards, editor, versions, generate dialog
│   ├── review/            # Diff viewer, file tree, inline comments, review panel
│   ├── schedule/          # Schedule view + Gantt
│   ├── gantt/             # Gantt chart wrapper
│   ├── onboarding/        # First-time setup guide
│   └── ui/                # Button, Dialog, Input, Tabs, StatusBadge, ...
└── messages/              # en.json, zh.json
```

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Build
npm run build

# Generate DB migration after schema change
npx drizzle-kit generate
```

## License

MIT
