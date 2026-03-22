# Repository Guidelines

## Project Structure & Module Organization
`src/app` contains the Next.js App Router UI and all API routes under `src/app/api`. Keep reusable UI in `src/components`, grouped by feature (`project`, `plan`, `scheme`, `review`, `schedule`, `ui`). Shared runtime code lives in `src/lib` (`ai`, `db`, `import`, `backup`, `cli`, `lsp`). Localized messages are in `src/messages`, static assets in `public`, design notes and screenshots in `docs`, browser smoke coverage in `e2e`, and Vitest suites in `__tests__` (`api`, `components`, `lib`).

## Build, Test, and Development Commands
Use `npm install` to sync dependencies. Main scripts:

- `npm run dev`: start the local Next.js dev server on `localhost:3000`.
- `npm run build`: produce the production build and catch type or route issues.
- `npm run start`: run the built app for a production-style check.
- `npm run lint`: run ESLint with the Next.js core-web-vitals and TypeScript rules.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: rerun Vitest in watch mode during development.
- `npm run test:coverage`: collect coverage before larger merges.

## Coding Style & Naming Conventions
Write TypeScript with `strict`-safe types and prefer the `@/` import alias over deep relative paths. Follow the existing style: 2-space indentation, double quotes, semicolons, and small focused modules. Use `PascalCase` for React components, `camelCase` for functions and variables, and kebab-case file names for components and feature modules (for example, `create-project-dialog.tsx`). Keep route handlers in `route.ts` files and place shared UI primitives in `src/components/ui`.

## Testing Guidelines
Vitest runs in `jsdom` with Testing Library matchers from `vitest.setup.ts`. Put tests in `__tests__/**/*.test.ts` or `__tests__/**/*.test.tsx`; mirror the source area in the path, such as `__tests__/api/plans.test.ts`. Add or update tests for API behavior, rendering logic, and database schema changes. Use `npm run test:coverage` for changes that touch scheduling, AI orchestration, or persistence paths.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits: `feat:`, `fix:`, then a short imperative summary (`feat: model dropdown selection on all provider pickers`). Keep commits scoped to one change. PRs should explain user impact, list verification commands, call out schema or config changes, and include screenshots for UI updates. Link the related issue or plan when one exists.
