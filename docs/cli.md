# CLI Reference

**`skillpm`** is the canonical command. **`spm`** is an identical alias.

```
skillpm <command> [options]
spm     <command> [options]
```

**Global options** (available on every command):

| Flag | Description |
|---|---|
| `--json` | Output raw JSON to stdout. Suppresses spinners and color. Useful for scripting. |
| `--no-color` | Disable chalk color output |
| `-V, --version` | Print the version this build was made at, and exit. From a git checkout whose `dist/` is older than `HEAD`, also warns on stderr |
| `-h, --help` | Show help |

---

## `skillpm install <source>`

Install a skill from the registry, a local directory, a GitHub repository, or a tree URL.

```bash
skillpm install <source> [--scope <level>] [--force] [--no-bridge] [--json]
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `-s, --scope <level>` | `project` | Installation scope: `global`, `shared`, or `project` |
| `-f, --force` | `false` | Overwrite if the skill is already installed at this scope |
| `--no-bridge` | — | Do not link the skill into agent directories (`.agents/skills`, `.claude/skills`) |
| `--json` | `false` | Output result as JSON |

The default scope can be changed with `skillpm config set defaultScope <level>`.

**Source formats:**

| Format | Example |
|---|---|
| Registry, qualified | `anthropics/pdf` |
| Registry, bare name | `pdf` — if several owners publish it, `skillpm` asks which one (or, without a terminal, lists the qualified names and exits 1) |
| Local path | `./my-skill` or `/absolute/path/to/skill` |
| GitHub repo | `git+https://github.com/user/repo` |
| GitHub repo with branch | `git+https://github.com/user/repo/tree/main` |
| GitHub subdirectory | `git+https://github.com/user/repo/tree/main/skills/forensics-agent` |

**Examples:**

```bash
# Install from the registry at project scope (default)
skillpm install anthropics/pdf

# Install from a local directory
skillpm install ./forensics-agent

# Install at global scope so it's available everywhere
skillpm install ./forensics-agent --scope global

# Install from GitHub
skillpm install git+https://github.com/acme/claude-skills --scope shared

# Force-reinstall if already present
skillpm install ./forensics-agent --force

# JSON output for scripting
skillpm install ./forensics-agent --json
```

**JSON output shape:**

```json
{
  "installed": true,
  "skillName": "forensics-agent",
  "scope": "project",
  "score": 91,
  "diagnostics": [
    { "severity": "pass", "message": "YAML frontmatter valid", "check": "yaml-frontmatter" }
  ]
}
```

**Install flow:**

1. For a registry name, looks up the skill's source URL (and resolves an ambiguous bare name)
2. Validates the skill folder (runs full format check)
3. Shows validation report if there are warnings or errors
4. Checks for conflicts at the same scope — throws if already installed (unless `--force`)
5. Copies the skill folder into the scope's `skills/` directory
6. Updates `skilldex.json` manifest with install metadata
7. Links the skill into the agent directories for the scope — `.agents/skills/` and `.claude/skills/`, plus Qwen Code, Cline and Antigravity directories when those agents are present — unless `--no-bridge`

A registry install prints the trust tier with the score:

```
✔ Installed "pdf" at project scope
✓ Score: 100/100 · Trust: verified
Linked into /path/to/project/.agents/skills/pdf
Linked into /path/to/project/.claude/skills/pdf
```

Warnings never block installation. The user always decides.

**GitHub installs:**

When installing from a `git+https://` URL (and for registry installs, which resolve to one), Skilldex:
1. Clones the repository into a temporary directory (shallow clone, `--depth 1`); `tree/HEAD` clones the default branch
2. Searches for skill folders (directories containing `SKILL.md`)
3. Validates and installs the skill — asking which one when the repository holds several
4. Cleans up the temporary clone

The source is recorded in the manifest as `git+https://…`, which is what `skillpm update` re-fetches.

---

## `skillpm uninstall <skill-name>`

Remove an installed skill from a scope.

```bash
skillpm uninstall <skill-name> [--scope <level>] [--json]
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `-s, --scope <level>` | `project` | Scope to remove from |
| `--json` | `false` | Output result as JSON |

**Examples:**

```bash
skillpm uninstall forensics-agent
skillpm uninstall forensics-agent --scope global
skillpm uninstall forensics-agent --json
```

**JSON output shape:**

```json
{
  "removed": true,
  "skillName": "forensics-agent",
  "scope": "project"
}
```

Exits with code 1 if the skill is not installed at the specified scope.

---

## `skillpm list`

List all installed skills. Defaults to showing all scopes.

```bash
skillpm list [--scope <level>] [--json]
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `-s, --scope <level>` | *(all)* | Filter to a single scope |
| `--json` | `false` | Output as JSON array |

**Examples:**

```bash
# Show all scopes
skillpm list

# Show only project-level skills
skillpm list --scope project

# Machine-readable
skillpm list --json
```

**Default output:**

```
global scope
  (no skills installed)

shared scope
  (no skills installed)

project scope
  forensics-agent                score: 91/100  source: community
  test-writer                    score: 84/100  source: local

3 skill(s) installed across 3 scope(s)
```

**JSON output shape:**

```json
[
  {
    "level": "global",
    "skills": []
  },
  {
    "level": "shared",
    "skills": []
  },
  {
    "level": "project",
    "skills": [
      {
        "name": "forensics-agent",
        "version": "1.0.0",
        "source": "community",
        "sourceUrl": "git+https://github.com/user/forensics-agent",
        "installedAt": "2026-03-26T00:00:00.000Z",
        "specVersion": "1.0",
        "score": 91,
        "path": "skills/forensics-agent"
      }
    ]
  }
]
```

---

## `skillpm validate [path]`

Validate a skill folder against Anthropic's skill format specification and print a compiler-style quality report.

```bash
skillpm validate [path] [--json]
```

**Arguments:**

| Argument | Default | Description |
|---|---|---|
| `path` | `cwd` | Path to the skill folder to validate |

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--json` | `false` | Output full validation result as JSON |

**Examples:**

```bash
# Validate current directory
skillpm validate

# Validate a specific path
skillpm validate ./forensics-agent

# JSON output
skillpm validate ./forensics-agent --json
```

**Default output:**

```
  pass    YAML frontmatter valid
  pass    name field present
  pass    description meets length requirement (34 words)
  pass    SKILL.md line count OK (42 lines)
  error   line 12: references assets/template.docx but assets/template.docx not found
  warn    Unknown subdirectory "bin" — only scripts/, references/, assets/ are allowed
  pass    Bundled resources in correct subdirectories

Format conformance score: 70/100
Validated against: skill-format v1.0
```

Exit codes: `0` if no errors, `1` if any errors are found.

**JSON output shape:**

```json
{
  "skill": "forensics-agent",
  "score": 70,
  "diagnostics": [
    { "severity": "pass", "message": "YAML frontmatter valid", "check": "yaml-frontmatter" },
    { "severity": "error", "line": 12, "message": "references assets/template.docx but assets/template.docx not found", "check": "referenced-resources" }
  ],
  "specVersion": "1.0",
  "passCount": 5,
  "warnCount": 1,
  "errorCount": 1
}
```

See [docs/validation.md](validation.md) for the full scoring breakdown.

---

## `skillpm suggest`

AI-powered skill suggestion loop. Reads your project context and proposes relevant skills to install.

```bash
skillpm suggest [--project-path <path>] [--yes] [--json]
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `-p, --project-path <path>` | `cwd` | Path to the project to analyze |
| `-y, --yes` | `false` | Auto-approve all suggestions without prompting |
| `--json` | `false` | Output proposals as JSON without interactive prompts |

Proposals come only from registry search results — the model chooses among real skills, identified by `owner/name` — and approved ones install like `skillpm install <owner>/<name>`. Needs the registry cannot meet are listed separately, with an offer to draft them.

**Requirements:** `ANTHROPIC_API_KEY` environment variable (or `skillpm config set anthropicApiKey`) must be set.

**Examples:**

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Interactive suggestion loop
skillpm suggest

# Suggest for a different project
skillpm suggest --project-path /path/to/other/project

# Get proposals as JSON (no interaction)
skillpm suggest --json
```

**Interactive flow:**

```
Gathering project context...

Proposed skills for this project:
  1. anthropics/pdf                         [project]  100/100
     The README describes generating PDF reports from test results

anthropics/pdf: Install? (Yes project / Yes shared / Yes global / Skip)
```

**JSON output:** `{ proposals, gaps, queries, search }`, with each proposal identified by `qualifiedName`.

See [docs/suggest.md](suggest.md) for the full suggestion loop documentation.

---

## `skillpm publish`

Register a skill with the Skilldex registry. Run it from the skill's folder; the name comes from `SKILL.md`. The registry does not take an upload: it records the skill's GitHub URL, fetches `SKILL.md` from there, and scores it. The skill is published under your GitHub handle, as `<handle>/<name>`.

```bash
skillpm publish [--source-url <url>] [--tags <tags>] [--update] [--json]
```

| Flag | Description |
|---|---|
| `--source-url <url>` | GitHub URL of the skill. Detected from the folder's git remote if omitted |
| `--tags <tags>` | Comma-separated tags |
| `--update` | Re-fetch and re-score a skill you already published (from 1.5.5) |
| `--json` | Output as JSON |

Needs a publisher token: sign in at the registry's `/auth/github` (the command prints the URL when no token is set), then `skillpm config set token <token>` or set `SKILLDEX_TOKEN`.

---

## `skillpm search <query>`

Search the registry. Results are addressed as `owner/name`; a count past the registry's cap prints as `1,000+`.

| Flag | Default | Description |
|---|---|---|
| `--tier <tier>` | all | `verified` or `community` |
| `--sort <sort>` | relevance | `relevance`, `installs`, `score`, `recent`, `name` |
| `--limit <n>` | `10` | Up to 50 |
| `--json` | `false` | Raw registry response |

---

## `skillpm update [skill-name]`

Re-fetch an installed skill from its recorded source, re-validate, and reinstall it. `--all` updates every skill in the scope; `--scope` defaults to `project`. Skills installed from a local path have no source and are skipped.

---

## `skillpm init [name]`

Scaffold a skill: `./<name>/SKILL.md`, or `SKILL.md` in the current directory when no name is given. The name is checked against the validator's rules first, and the template validates clean as written.

---

## `skillpm skillset <subcommand>`

`search`, `install`, `list`, `update`, `uninstall`, `init`, `validate` (`--strict` fails on a contradicted shared convention), and `publish`. Skillset names are not owner-qualified. See the README's Skillsets section.

---

## `skillpm config <subcommand>`

`get [key]`, `set <key> <value>`, `unset <key>`, `list`. Keys: `registryUrl`, `token`, `anthropicApiKey`, `defaultScope`, stored in `~/.skilldex/config.json`; the matching environment variables (`SKILLDEX_REGISTRY_URL`, `SKILLDEX_TOKEN`, `ANTHROPIC_API_KEY`, `SKILLDEX_DEFAULT_SCOPE`) win over the file.

---

## `skillpm mcp`

Start the Skilldex MCP server (hidden command — used for Claude Code integration).

```bash
skillpm mcp
# or
node dist/mcp/server.js
```

This is intended to be invoked by Claude Code, not directly by users. See [docs/mcp.md](mcp.md) for configuration instructions.

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (validation errors found, skill not installed, missing argument, etc.) |
