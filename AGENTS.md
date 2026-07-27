# AGENTS.md

React 19 + TypeScript Vite frontend for the CLI Proxy API Management Center (this fork).

## Repository
- **Origin (this fork, push/release):** https://github.com/josephcy95/Cli-Proxy-API-Management-Center (`origin`)
- **Upstream:** https://github.com/router-for-me/Cli-Proxy-API-Management-Center (`upstream`)
- Tags / releases on **josephcy95** only. Use `gh -R josephcy95/Cli-Proxy-API-Management-Center` when default remote context is wrong.
- Workspace sibling API: `../cliproxyapi-forked` (CLIProxyAPI Go backend). Parent workspace notes: `../AGENTS.md`.

## Project structure
Main source lives in `src/`: routes in `src/router`, pages in `src/pages`, components in `src/components`, API clients in `src/services/api`, state in `src/stores`, hooks in `src/hooks`, styles in `src/styles`, and types in `src/types`. Assets live in `src/assets`, with provider icons under `src/assets/icons`. Localization files are in `src/i18n/locales`; update all supported locales when adding user-facing text. Production output is `dist/index.html`.

## Commands
- `bun install --frozen-lockfile`: install dependencies from `bun.lock`
- `bun run dev`: Vite dev server at `http://localhost:5173`
- `bun run build`: TypeScript compile + production build
- `bun run preview`: serve `dist/` locally
- `bun run test`: Bun test suite
- `bun run lint`: ESLint over TypeScript/TSX
- `bun run type-check`: `tsc --noEmit`
- `bun run format`: Prettier on `src/**/*.{ts,tsx,css,scss}`
- `bun run verify`: tests + lint + type-check + production build (run before handoff)

## Coding style
Use 2-space indentation, semicolons, single quotes, ES5 trailing commas, and 100-character line width. Prefer typed React components and avoid new `any` unless it marks a boundary. Use the `@/` alias for `src` imports. Component files use PascalCase, hooks use `useName`, API modules use domain names such as `oauth.ts`, and SCSS Modules sit beside their page or component as `Name.module.scss`.

## Testing
Tests use Bun's built-in test runner and are colocated under `tests/` as `*.test.ts`. Run `bun run test` for focused work and `bun run verify` before handoff. For UI changes, verify the affected route in the browser.

## Upstream sync
- Prefer a real merge of upstream so GitHub is not left N commits behind.
- On conflicts: **keep fork features**; take upstream when it is the more robust fix; combine when both matter.
- **Skip** promotional / ads / decorative splash / recommended-provider marketing chrome unless the user asks for it.
- After merge: `bun run verify` before any release.
- Backend contract changes (new management routes, provider keys, auth-file fields) usually land in `../cliproxyapi-forked` first — inspect that repo before renaming routes or provider ids here.

## Fork features / UI surfaces to preserve
- Monitoring page → `/v0/management/usage-*` endpoints (events, summary, filter-options, account-stats, api-key-stats)
- Model prices / aliases / sync controls
- Qoder CN and Qoder international OAuth entry points (`/qodercn-auth-url`, `/qoder-auth-url`) and provider cards
- Codex private-instructions / instructions config UI if present
- xAI / Codex failure-policy config surfaces
- Model context overrides management
- Do not reintroduce upstream promo/ads chrome

## Ship policy
See parent `../AGENTS.md`. In short:
- **Minor** → implement only; commit only if needed; no push/tag/release unless asked.
- **Medium** → commit when done; offer push/release.
- **Meaningful** (upstream merge, user-facing/deploy-blocking, multi-file feature) → push + tag + release.
- Conventional commits (e.g. `feat: …`, `fix(auth-files): …`, `ci: …`).

## Architecture notes
This UI is not the proxy; it talks to the backend Management API under `/v0/management`. Treat backend contracts as the source of truth. For OAuth/provider changes, inspect `../cliproxyapi-forked` before changing route names, provider keys, callback parameters, or auth-file semantics. Store no secrets in the repo; management keys are entered at runtime and persisted only in browser storage.

## Pull requests
Keep commits focused. PRs should include a change summary, linked issue when applicable, UI screenshots, backend version or reproduction details for integration work, and verification notes.
