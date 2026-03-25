# Contributing to Skilldex

---

## Development Setup

```bash
git clone https://github.com/Pandemonium-Research/Skilldex.git
cd Skilldex
npm install
npm run build
npm test
```

**Requirements:** Node.js 20+, npm 9+

To use the CLI during development without installing globally:

```bash
npm run build
node dist/index.js --help
```

Or run directly from TypeScript source (slower, dev-only):

```bash
npm run dev -- --help
```

---

## Project Structure

```
src/
├── index.ts                    ← CLI entry point — shebang line, calls createCli()
├── cli/
│   ├── index.ts                ← Commander setup, registers all commands
│   ├── commands/               ← One file per command registration + one *-action.ts per command
│   └── ui/
│       ├── output.ts           ← chalk-based formatters, renderValidationReport()
│       └── prompts.ts          ← inquirer interactive prompts for suggest loop
├── core/
│   ├── validator.ts            ← Format validation + quality scoring engine
│   ├── manifest.ts             ← skilldex.json read/write (atomic writes via zod)
│   ├── resolver.ts             ← Scope path resolution, project root detection
│   ├── installer.ts            ← Install/uninstall orchestration
│   └── suggest-agent.ts        ← Context gathering + Anthropic API call
├── registry/
│   ├── index.ts                ← Re-exports for registry facade
│   └── sources/
│       └── github.ts           ← git+https:// install via simple-git
├── mcp/
│   └── server.ts               ← MCP server with all tool definitions
└── types/
    ├── skill.ts                ← SkillPackage, ValidationResult, ValidationDiagnostic
    ├── manifest.ts             ← SkillManifest, InstalledSkill
    ├── scope.ts                ← ScopeLevel, ScopeConfig
    └── registry.ts             ← RegistryEntry, SearchResult

tests/
├── unit/
│   ├── validator.test.ts
│   ├── manifest.test.ts
│   ├── resolver.test.ts
│   └── installer.test.ts
└── fixtures/
    ├── valid-skill/
    ├── no-frontmatter-skill/
    ├── short-description-skill/
    ├── bad-structure-skill/
    └── broken-ref-skill/
```

### Command registration pattern

Each CLI command is split into two files:

- `commands/install.ts` — registers the command with Commander, defines flags
- `commands/install-action.ts` — implements the actual logic

This split allows the registration files to stay thin (import the action lazily) and makes the action functions independently testable.

---

## Architecture Principles

### Core modules are framework-agnostic

`src/core/` has no CLI or MCP dependencies. Functions in `validator.ts`, `manifest.ts`, `resolver.ts`, and `installer.ts` are pure async functions that can be called from:
- CLI action handlers
- MCP tool handlers
- Tests
- Future web UI, VS Code extension, etc.

### MCP tools are thin wrappers

`src/mcp/server.ts` calls core module functions directly. It does not re-implement logic — it just marshals inputs/outputs between the MCP schema and core functions.

### Warnings never block

The validator emits errors and warnings, but neither ever prevents installation. This is enforced in `installer.ts` — validation runs, the score is recorded, but installation always proceeds unless there's an operational error (file not found, permission denied, etc.).

### ESM throughout

The project uses `"type": "module"` in `package.json`. All TypeScript imports must use `.js` file extensions (TypeScript + Node16 module resolution requires this). The compiled output is native ESM.

---

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run build:watch` | Watch mode compilation |
| `npm test` | Run all tests once with vitest |
| `npm run test:watch` | Watch mode tests |
| `npm run test:coverage` | Run tests and emit coverage report |
| `npm run dev` | Run CLI directly from TS source via tsx |
| `npm run lint` | ESLint check on `src/` and `tests/` |
| `npm run format` | Prettier format `src/` and `tests/` |
| `npm run mcp` | Start the MCP server (calls `node dist/mcp/server.js`) |

---

## Testing

### Running tests

```bash
npm test                   # run all tests
npm run test:watch         # re-run on file changes
npm run test:coverage      # generate coverage report
```

### Test structure

Tests live in `tests/unit/`. Each core module has a corresponding test file.

Tests use **real file system operations** against `tests/fixtures/` — no mocking of `fs`. This catches path-handling bugs and makes tests more realistic.

The one exception is `installer.test.ts`, which mocks `resolver.ts` to redirect scope directories to a temporary directory. This prevents tests from writing to `~/.skilldex/` or the repo's own `.skilldex/`.

### Fixtures

Pre-crafted skill folders for each validation scenario:

| Fixture | Purpose |
|---|---|
| `valid-skill/` | All checks pass — score 100 |
| `no-frontmatter-skill/` | Missing `---` — fatal, score 0 |
| `short-description-skill/` | description < 30 words |
| `bad-structure-skill/` | Has a `bin/` directory (not allowed) |
| `broken-ref-skill/` | References `assets/template.docx` which doesn't exist |

To add a new fixture:

1. Create a directory under `tests/fixtures/`
2. Add the appropriate `SKILL.md` (and any supporting files)
3. Add a test case in `tests/unit/validator.test.ts`

### Coverage targets

- `src/core/validator.ts` — 90%+ line coverage (this is the most critical module)
- `src/core/manifest.ts` — 90%+ line coverage
- Other modules — best effort

---

## Adding a New CLI Command

1. Create `src/cli/commands/<name>.ts` — registers the command with Commander
2. Create `src/cli/commands/<name>-action.ts` — implements the logic
3. Register it in `src/cli/index.ts` by calling `register<Name>(program)`
4. Add the corresponding MCP tool in `src/mcp/server.ts` if needed

Follow the existing pattern in `install.ts` / `install-action.ts`.

---

## Adding a New Core Module

1. Add your module to `src/core/`
2. Export only the public interface — keep helper functions unexported or private
3. Add types to `src/types/` if the module introduces new shared data shapes
4. Add unit tests in `tests/unit/`
5. Import and call it from the relevant CLI action and MCP tool

---

## Type System

All shared data shapes live in `src/types/`. Never inline complex types inside `src/core/` or `src/cli/`.

Key types:

| Type | File | Description |
|---|---|---|
| `ValidationResult` | `types/skill.ts` | Full result from `validateSkill()` |
| `ValidationDiagnostic` | `types/skill.ts` | Single diagnostic line (severity, line, message, check) |
| `SkillManifest` | `types/manifest.ts` | Full `skilldex.json` shape |
| `InstalledSkill` | `types/manifest.ts` | One entry in the manifest's skills map |
| `ScopeConfig` | `types/scope.ts` | Resolved scope: level + paths |
| `ScopeLevel` | `types/scope.ts` | `"global" \| "shared" \| "project"` |

---

## Code Style

- **Prettier** for formatting (`.prettierrc` — single quotes, no semicolons, 100 char width)
- **ESLint** for linting
- **Strict TypeScript** — no `any`, no `@ts-ignore`
- No comments on obvious code — only on non-obvious logic
- Prefer `async/await` over `.then()` chains

---

## Dependency Philosophy

Add a new dependency only when:
1. The functionality is non-trivial to implement correctly (e.g., YAML parsing, git operations)
2. The dependency is actively maintained
3. It doesn't significantly increase bundle size for something rarely used

Avoid adding new dependencies for things Node 20 already provides (`fetch`, `fs/promises`, `path`, `crypto`).

---

## Deferred / Future Work

These areas are explicitly out of scope for the current MVP and will be addressed in future phases:

| Feature | Status |
|---|---|
| Registry search | Phase 5 — `skilldex_search` is a stub |
| `skillpm publish` | Phase 5 — exits with error |
| Official Anthropic registry source | Phase 5 |
| Registry cache (`~/.skilldex/cache/`) | Phase 5 |
| Multiple skills from one GitHub repo (interactive picker) | Future |
| `skillpm update` (update installed skills) | Future |
| Spec version tracking automation | Future |
| Team shared-scope governance | Future |

When implementing any of these, start with the core module, then wire up the CLI action, then add the MCP tool.
