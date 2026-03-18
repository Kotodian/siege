# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Siege

Siege is an AI-powered agent development tool that manages the full software development lifecycle: plan → scheme → schedule → execute → review → test. It uses Claude Code/Codex CLI as execution engines and supports multiple AI providers (Anthropic, OpenAI, GLM).

## Commands

```bash
npm run dev           # Start Next.js dev server (http://localhost:3000)
npm run build         # Production build
npm run lint          # ESLint
npm test              # Run all tests (vitest run)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report

# Run a single test file
npx vitest run __tests__/api/plans.test.ts

# Database migration after schema changes
npx drizzle-kit generate
```

## Architecture

**Next.js 16 App Router** with TypeScript, SQLite (better-sqlite3 + Drizzle ORM), Tailwind CSS 4.

### Data flow

Projects contain Plans. Each Plan progresses through statuses: `draft → reviewing → confirmed → scheduled → executing → code_review → testing → completed`. Plans contain Schemes (technical proposals), Schedules (task breakdowns with Gantt), Reviews (code quality findings), and Test Suites.

### Key directories

- `src/app/api/` — REST API routes organized by resource (projects, plans, schemes, schedules, reviews, test-suites, execute)
- `src/app/[locale]/` — i18n pages (default locale: `zh`, also `en`). Uses `next-intl`.
- `src/lib/ai/` — AI integration layer:
  - `provider.ts` — Multi-provider model creation (Anthropic, OpenAI, GLM via OpenAI-compatible API)
  - `session.ts` — Session ID reuse for faster subsequent AI calls
  - `queue.ts` — SQLite-based serial task queue with file lock (prevents concurrent AI calls)
  - `cli-fallback.ts` — Claude/Codex CLI with `--output-format stream-json` parsing
  - `scheme-generator.ts`, `schedule-generator.ts`, `review-generator.ts`, `test-generator.ts` — Domain-specific AI generators
- `src/lib/db/schema.ts` — Drizzle ORM schema (17 tables). Migrations in `src/lib/db/migrations/`.
- `src/lib/cli/runner.ts` — Task execution via CLI with EventEmitter + SSE streaming
- `src/lib/backup/` — Backup backends (local filesystem, Obsidian vault, Notion)
- `src/components/` — React components organized by domain (scheme/, schedule/, review/, test/, plan/, project/, gantt/, ui/)
- `src/messages/` — i18n translation files (en.json, zh.json)

### Database

SQLite stored at `./data/siege.db`. WAL mode + foreign keys enabled. Auto-migrates on startup. Drizzle config points schema to `src/lib/db/schema.ts`, migrations output to `src/lib/db/migrations/`.

### AI integration patterns

- **CLI-first**: Prefers spawning `claude`/`codex` CLI with `--output-format stream-json --verbose` and optional session resume (`--session-id`/`--resume`)
- **SDK fallback**: Uses Vercel AI SDK (`ai` package) with `@ai-sdk/anthropic` and `@ai-sdk/openai` when API keys are configured
- **Session reuse**: Session IDs stored in DB per project/plan for context continuity
- **Serial queue**: Only one AI task runs at a time, enforced by SQLite queue + file lock
- **Skills injection**: Reads markdown files from `~/.claude/skills/`, injects into task prompts

### Testing

Tests live in `__tests__/` (not colocated). Vitest with jsdom environment. Path alias `@` maps to `src/`. Setup file: `vitest.setup.ts`.

## Conventions

- All DB IDs are UUIDs (text type)
- All timestamps are SQLite datetime strings via `sql\`(datetime('now'))\``
- API routes use `parseJsonBody()` from `src/lib/utils.ts` for request parsing
- Streaming responses use `ReadableStream` with heartbeat packets
- Plan status transitions drive the UI workflow — changing status unlocks the next stage
