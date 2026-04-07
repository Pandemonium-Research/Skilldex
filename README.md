# Skilldex

**npm, but for Claude skills.**

Skilldex is a package manager and registry for Claude `.skill` packages. It handles installation at the right scope, format validation with compiler-style feedback, quality scoring, and AI-powered skill suggestions — all while integrating natively with Claude Code via MCP.

```bash
skillpm install forensics-agent --scope project
skillpm validate ./my-skill
skillpm list
```

> **Note:** Skilldex is strictly a distribution and tooling layer. It does not define the skill format — that is Anthropic's responsibility. Skilldex follows and validates against Anthropic's published skill specification.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Skill Package Format](#skill-package-format)
- [Scope System](#scope-system)
- [Format Validation & Scoring](#format-validation--scoring)
- [Agent Suggestion Loop](#agent-suggestion-loop)
- [Skillsets](#skillsets)
- [Configuration](#configuration)
- [Claude Code Integration (MCP)](#claude-code-integration-mcp)
- [Documentation](#documentation)
- [Contributing](#contributing)

---

## Installation

**Requirements:** Node.js 20+

**npm** (all platforms)
```bash
npm install -g skilldex-cli
```

**Homebrew** (macOS/Linux)
```bash
brew tap pandemonium-research/skilldex
brew install skilldex-cli
```

**curl** (macOS/Linux)
```bash
curl -fsSL https://skilldex-web.vercel.app/install.sh | sh
```

**Scoop** (Windows)
```bash
scoop bucket add skilldex https://github.com/Pandemonium-Research/scoop-skilldex
scoop install skilldex-cli
```

**From source**
```bash
git clone https://github.com/Pandemonium-Research/Skilldex.git
cd Skilldex
npm install
npm run build
npm link           # makes skillpm / spm available globally
```

Both `skillpm` and `spm` are identical — `spm` is a convenience alias:

```bash
skillpm install forensics-agent   # canonical
spm install forensics-agent       # identical alias
```

---

## Quick Start

### Validate a skill

```bash
skillpm validate ./my-skill
```

```
  pass    YAML frontmatter valid
  pass    name field present
  pass    description meets length requirement (34 words)
  pass    SKILL.md line count OK (42 lines)
  error   line 12: references assets/template.docx but assets/template.docx not found
  pass    Bundled resources in correct subdirectories

Format conformance score: 85/100
Validated against: skill-format v1.0
```

### Install a skill

```bash
# From a local path
skillpm install ./forensics-agent --scope project

# From a GitHub repo
skillpm install git+https://github.com/user/forensics-agent --scope project

# From a subdirectory of a repo
skillpm install git+https://github.com/user/skills-collection/tree/main/forensics-agent
```

### List installed skills

```bash
skillpm list

# global scope
#   (no skills installed)
#
# shared scope
#   (no skills installed)
#
# project scope
#   forensics-agent                score: 91/100  source: community
```

### Uninstall a skill

```bash
skillpm uninstall forensics-agent --scope project
```

### Update an installed skill

```bash
skillpm update forensics-agent --scope project

# Update all skills in a scope
skillpm update --all --scope project
```

Skills must have been installed from a `git+https://` URL or the registry to be updatable. Local-path installs are skipped.

### Search the registry

```bash
skillpm search forensics

# Filter by trust tier or sort order
skillpm search ctf --tier verified --sort score --limit 20
```

```
Found 3 skills for "forensics" (showing 3)

forensics-agent [verified]
  Full forensic investigation workflow for CTF and incident response
  Score: 91/100  ·  Installs: 412  ·  Spec: v1.0
  Tags: forensics, ctf, analysis
  skillpm install forensics-agent
```

### Publish a skill

```bash
# Run from inside your skill directory — source URL is auto-detected from git remote
skillpm publish --tags forensics,analysis

# Re-score an already-published skill after changes
skillpm publish --update
```

Requires an auth token: get one at `https://registry.skilldex.dev/auth/github`, then `skillpm config set token <token>`.

### AI-powered skill suggestions

```bash
export ANTHROPIC_API_KEY=sk-ant-...
skillpm suggest
```

Skilldex reads your project context (README, package.json, `.claude/` directory) and proposes relevant skills. You approve, reject, or change the scope of each before installation.

---

## CLI Reference

Full reference: [docs/cli.md](docs/cli.md)

| Command | Description |
|---|---|
| `skillpm install <source>` | Install from local path or `git+https://` URL |
| `skillpm uninstall <name>` | Remove a skill from a scope |
| `skillpm update [name]` | Re-fetch and reinstall a skill from its source |
| `skillpm list` | Show all installed skills across scopes |
| `skillpm validate [path]` | Validate format + show score |
| `skillpm search <query>` | Search the Skilldex registry |
| `skillpm suggest` | AI-powered suggestion loop |
| `skillpm publish` | Publish a skill to the registry |
| `skillpm skillset <subcommand>` | Manage skillsets (bundles of skills) |
| `skillpm config <subcommand>` | View and set Skilldex configuration |

**Global options:**

| Flag | Description |
|---|---|
| `--json` | Machine-readable JSON output |
| `--no-color` | Disable colored output |
| `-v, --version` | Print version |
| `-h, --help` | Show help |

---

## Skill Package Format

Full reference: [docs/skill-format.md](docs/skill-format.md)

A Skilldex package is a folder containing a `SKILL.md` file and optional bundled resources:

```
my-skill/
├── SKILL.md          ← required
├── scripts/          ← executable code (optional)
├── references/       ← docs loaded into context (optional)
└── assets/           ← templates, icons, fonts (optional)
```

**`SKILL.md` structure:**

```markdown
---
name: my-skill
description: A detailed description of what this skill does, when to use it,
  and what capabilities it provides to the agent. Should be 30+ words.
version: 1.0.0
tags: [debugging, analysis]
author: your-name
---

## Instructions

Your skill instructions here...
```

The `name` and `description` fields are required. Everything else is optional.

---

## Scope System

Full reference: [docs/scoping.md](docs/scoping.md)

Skills are installed at one of three levels. **Local-first precedence** — a lower scope always overrides a higher one for the same skill name.

```
global   → ~/.skilldex/global/     available to all projects
shared   → ~/.skilldex/shared/     custom skills across multiple projects
project  → <project>/.skilldex/    skills specific to one project
```

```bash
skillpm install my-skill --scope global    # available everywhere
skillpm install my-skill --scope shared    # available in all projects
skillpm install my-skill --scope project   # default, this project only
```

Each scope maintains a `skilldex.json` manifest tracking installed skills, their source, and the spec version they were validated against.

---

## Format Validation & Scoring

Full reference: [docs/validation.md](docs/validation.md)

The quality score measures **format conformance only** — not functionality or usefulness.

> *"The Skilldex quality score reflects conformance to Anthropic's skill format specification. It does not reflect the skill's functionality or usefulness."*

**Scoring breakdown (100 pts total):**

| Check | Points |
|---|---|
| YAML frontmatter present and parseable | 25 |
| `name` field present and non-empty | 10 |
| `description` field present | 10 |
| `description` meets 30-word minimum | 10 |
| `SKILL.md` under 500 lines | 15 |
| Only allowed subdirectories | 10 |
| All referenced resources exist | 15 |
| Bundled resources in correct subdirectories | 5 |

Missing frontmatter is **fatal** — the skill scores 0 and no further checks run. All other failures produce diagnostics but never block installation.

---

## Agent Suggestion Loop

Full reference: [docs/suggest.md](docs/suggest.md)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
skillpm suggest
```

Before starting a build, Skilldex can propose skills based on your project:

1. Reads project context (README, package.json, `.claude/` directory)
2. Calls Claude to propose relevant skills with reasons
3. You approve, reject, or reassign the scope of each
4. Approved skills are installed

This checkpoint is intentional. Most agent frameworks skip it and auto-execute. Skilldex makes it explicit.

---

## Skillsets

A skillset is a named bundle of related skills distributed together — for example, a `ctf-toolkit` skillset that installs `forensics-agent`, `pwn-agent`, and `web-recon` in one step.

```bash
# Scaffold a new skillset
skillpm skillset init my-toolkit

# Install a skillset from a local path, git URL, or registry
skillpm skillset install ./my-toolkit --scope project
skillpm skillset install git+https://github.com/user/ctf-toolkit --scope project

# List installed skillsets
skillpm skillset list

# Validate a skillset directory
skillpm skillset validate ./my-toolkit

# Update an installed skillset from its source
skillpm skillset update ctf-toolkit --scope project
skillpm skillset update --all --scope project

# Uninstall a skillset and all its skills
skillpm skillset uninstall ctf-toolkit --scope project

# Publish a skillset to the registry
skillpm skillset publish --tags ctf,forensics
```

**`skillset` subcommands:**

| Subcommand | Description |
|---|---|
| `skillset init [name]` | Scaffold a new skillset directory with a `SKILLSET.md` template |
| `skillset install <source>` | Install from local path, git URL, or registry |
| `skillset uninstall <name>` | Remove an installed skillset and its skills |
| `skillset list` | List installed skillsets |
| `skillset validate [path]` | Validate structure and score `SKILLSET.md` |
| `skillset update [name]` | Re-fetch and reinstall from source |
| `skillset publish` | Publish to the Skilldex registry |

---

## Configuration

Skilldex stores persistent configuration in `~/.skilldex/config.json`. Values here are overridden by their corresponding environment variables.

```bash
# Show all current config values
skillpm config get

# Get or set a specific key
skillpm config get registryUrl
skillpm config set anthropicApiKey sk-ant-...
skillpm config set defaultScope project

# Remove a key
skillpm config unset token

# List all valid keys with descriptions
skillpm config list
```

**Config keys:**

| Key | Environment variable | Description |
|---|---|---|
| `registryUrl` | `SKILLDEX_REGISTRY_URL` | Registry API base URL |
| `token` | `SKILLDEX_TOKEN` | Publisher auth token |
| `anthropicApiKey` | `ANTHROPIC_API_KEY` | Anthropic API key for `suggest` |
| `defaultScope` | `SKILLDEX_DEFAULT_SCOPE` | Default install scope (`global`, `shared`, or `project`) |

---

## Claude Code Integration (MCP)

Full reference: [docs/mcp.md](docs/mcp.md)

Skilldex exposes a Model Context Protocol (MCP) server so Claude Code can invoke all operations directly.

**Add to your Claude Code MCP config** (`.mcp.json` in project root or `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "skilldex": {
      "command": "node",
      "args": ["/absolute/path/to/Skilldex/dist/mcp/server.js"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

Once configured, Claude Code can:
- Call `skilldex_install` to install a skill mid-session
- Call `skilldex_list` to see what's available
- Call `skilldex_validate` to check a skill's format score
- Call `skilldex_suggest` to get AI proposals for the current project

**Available MCP tools:**

| Tool | Description |
|---|---|
| `skilldex_install` | Install a skill from path or git URL |
| `skilldex_uninstall` | Remove a skill |
| `skilldex_list` | List installed skills |
| `skilldex_validate` | Validate and score a skill |
| `skilldex_suggest` | Generate skill suggestions |
| `skilldex_search` | Search the registry |

---

## Documentation

| File | Contents |
|---|---|
| [docs/cli.md](docs/cli.md) | Full CLI command reference with all flags and examples |
| [docs/skill-format.md](docs/skill-format.md) | Skill package format, SKILL.md structure, frontmatter fields |
| [docs/scoping.md](docs/scoping.md) | Scope hierarchy, resolution rules, manifest format |
| [docs/validation.md](docs/validation.md) | Scoring system, each check explained, output format |
| [docs/suggest.md](docs/suggest.md) | Agent suggestion loop, context gathering, interactive flow |
| [docs/mcp.md](docs/mcp.md) | MCP server setup, tool schemas, Claude Code config |
| [docs/contributing.md](docs/contributing.md) | Dev setup, architecture, testing guide |

---

## Contributing

See [docs/contributing.md](docs/contributing.md).

```bash
git clone https://github.com/Pandemonium-Research/Skilldex.git
cd Skilldex
npm install
npm run build
npm test
```

---

## License

MIT
