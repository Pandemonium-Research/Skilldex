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
| `-v, --version` | Print version and exit |
| `-h, --help` | Show help |

---

## `skillpm install <source>`

Install a skill from a local directory, a GitHub repository, or a tree URL.

```bash
skillpm install <source> [--scope <level>] [--force] [--json]
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `-s, --scope <level>` | `project` | Installation scope: `global`, `shared`, or `project` |
| `-f, --force` | `false` | Overwrite if the skill is already installed at this scope |
| `--json` | `false` | Output result as JSON |

**Source formats:**

| Format | Example |
|---|---|
| Local path | `./my-skill` or `/absolute/path/to/skill` |
| GitHub repo | `git+https://github.com/user/repo` |
| GitHub repo with branch | `git+https://github.com/user/repo/tree/main` |
| GitHub subdirectory | `git+https://github.com/user/repo/tree/main/skills/forensics-agent` |

**Examples:**

```bash
# Install from a local directory at project scope (default)
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

1. Validates the skill folder (runs full format check)
2. Shows validation report if there are warnings or errors
3. Checks for conflicts at the same scope — throws if already installed (unless `--force`)
4. Copies the skill folder into the scope's `skills/` directory
5. Updates `skilldex.json` manifest with install metadata

Warnings never block installation. The user always decides.

**GitHub installs:**

When installing from a `git+https://` URL, Skilldex:
1. Clones the repository into a temporary directory (shallow clone, `--depth 1`)
2. Searches for skill folders (directories containing `SKILL.md`)
3. Validates and installs the first matching skill
4. Cleans up the temporary clone

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

**Requirements:** `ANTHROPIC_API_KEY` environment variable must be set.

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
  1. forensics-agent             [project]
     Needed for log analysis tasks described in your README
  2. test-writer                 [project]
     package.json has test scripts suggesting testing is important
  3. code-reviewer               [shared]
     Common for TypeScript projects

forensics-agent: Install? (Y/n/skip/scope)
test-writer: Install? (Y/n/skip/scope)
code-reviewer: Install? (Y/n/skip/scope)
```

**JSON output shape:**

```json
{
  "proposals": [
    {
      "skillName": "forensics-agent",
      "reason": "Needed for log analysis tasks described in your README",
      "suggestedScope": "project",
      "available": true
    }
  ]
}
```

See [docs/suggest.md](suggest.md) for the full suggestion loop documentation.

---

## `skillpm publish`

Publish a skill to the Skilldex registry.

> **Status:** Not yet implemented. Running this command exits with an error.

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
