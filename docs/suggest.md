# Agent Suggestion Loop

The `suggest` command implements an explicit checkpoint before a build begins: Claude proposes skills it thinks the project needs, and you decide what to install and at what scope.

This is intentional. Most agent frameworks skip this and auto-execute. Skilldex makes the decision explicit.

---

## Requirements

The suggestion loop calls the Anthropic API. You need an API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
skillpm suggest
```

You can also store the key in `~/.skilldex/config.json` (not yet implemented — use the environment variable for now).

---

## How It Works

```
1. Skilldex reads your project context
2. Claude proposes a list of skills
3. You approve, reject, or reassign the scope of each
4. Approved skills are installed
```

### Step 1 — Context gathering

Skilldex reads the following files from your project root (all optional — missing files are silently skipped):

| File | What's used |
|---|---|
| `README.md` | First 100 lines |
| `README.txt` | First 100 lines (fallback) |
| `package.json` | `name`, `description`, `scripts`, dependency names |
| `.claude/` | Directory listing (file names only) |
| `.skilldex/skilldex.json` | Names of already-installed skills (to avoid re-suggesting) |

The context is assembled into a summary and sent to Claude.

### Step 2 — Proposal generation

Claude is given the context and asked to return a structured list of skill proposals:

```json
{
  "proposals": [
    {
      "skillName": "forensics-agent",
      "reason": "Needed for log analysis tasks described in your README",
      "suggestedScope": "project"
    }
  ]
}
```

The model used is `claude-sonnet-4-6`. The system prompt instructs the model to:
- Suggest 3–7 skills maximum
- Default `suggestedScope` to `project` unless there's a clear reason for `global` or `shared`
- Not re-suggest already-installed skills
- Only suggest skills that would realistically exist as Claude Code skills

### Step 3 — Interactive approval

Each proposed skill is presented with its reason and suggested scope:

```
Proposed skills for this project:
  1. forensics-agent             [project]
     Needed for log analysis tasks described in your README
  2. test-writer                 [project]
     package.json has test scripts suggesting testing is important
  3. code-reviewer               [shared]
     Common for TypeScript projects

forensics-agent: Install?
  ❯ Yes (project scope)
    Yes (shared scope)
    Yes (global scope)
    Skip
```

For each skill you can:
- Install at project scope (default)
- Install at shared scope
- Install at global scope
- Skip

### Step 4 — Installation

After you've reviewed all proposals, approved skills are installed in the order they were approved.

> **Note:** In the current MVP, the suggestion loop proposes skills by name but cannot auto-install them from the registry (registry search is not yet implemented). After approving, Skilldex tells you the `skillpm install git+<url>` command to run. Full auto-install will be available when the registry is live.

---

## Command Reference

```bash
skillpm suggest [--project-path <path>] [--yes] [--json]
```

| Flag | Default | Description |
|---|---|---|
| `-p, --project-path <path>` | cwd | Project path to analyze |
| `-y, --yes` | `false` | Skip interactive prompts, auto-approve all suggestions |
| `--json` | `false` | Output proposals as JSON, no interaction |

**Examples:**

```bash
# Standard interactive flow
skillpm suggest

# Non-interactive, get proposals for a different project
skillpm suggest --project-path /path/to/project --json

# Auto-approve everything (use carefully)
skillpm suggest --yes
```

---

## JSON Output

```bash
skillpm suggest --json
```

```json
{
  "proposals": [
    {
      "skillName": "forensics-agent",
      "reason": "Needed for log analysis tasks described in your README",
      "suggestedScope": "project",
      "available": true
    },
    {
      "skillName": "test-writer",
      "reason": "package.json has test scripts suggesting testing is important",
      "suggestedScope": "project",
      "available": true
    }
  ]
}
```

**`SuggestionProposal` fields:**

| Field | Type | Description |
|---|---|---|
| `skillName` | `string` | Kebab-case skill name |
| `reason` | `string` | One-sentence explanation of why this skill was proposed |
| `suggestedScope` | `ScopeLevel` | Claude's suggestion for which scope to install at |
| `available` | `boolean` | Whether the skill is findable in the registry (always `true` in current MVP) |

---

## MCP Usage

The `skilldex_suggest` MCP tool exposes the same capability to Claude Code:

```json
{
  "name": "skilldex_suggest",
  "arguments": {
    "projectPath": "/path/to/project"
  }
}
```

Returns the same `{ proposals }` JSON structure. See [docs/mcp.md](mcp.md) for the full tool schema.

---

## Design Philosophy

The suggestion loop exists because of a specific problem: most agent frameworks let the agent auto-install tools or load context without user awareness. This creates invisible state — the user doesn't know what's being loaded into context or why.

Skilldex's suggestion loop is an explicit checkpoint. The agent proposes what it thinks it needs. The user reads the reasons and decides. The scope assignment is intentional, not automatic.

This keeps the user in control of what's installed and at what scope, which matters especially for shared and global scopes that affect other projects.
