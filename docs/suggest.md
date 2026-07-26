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

You can also store the key in `~/.skilldex/config.json`:

```bash
skillpm config set anthropicApiKey sk-ant-...
```

The environment variable always wins over the config file. `suggest` is the only command that needs a key — everything else works offline.

---

## Custom Endpoints

`suggest` uses the Anthropic SDK, so it can run against any endpoint that speaks the **Anthropic Messages API format** — for example a [LiteLLM](https://github.com/BerriAI/litellm) proxy. Through such a proxy you can front non-Claude models (including OpenAI models) while keeping the same request/response shape Skilldex expects.

> **Note:** this is Anthropic Messages API compatibility, *not* OpenAI Chat Completions compatibility. Pointing `ANTHROPIC_BASE_URL` directly at a raw OpenAI-style endpoint (e.g. `api.openai.com/v1`) will not work — the endpoint must accept and return Anthropic-format messages. A translating proxy in between is what makes non-Claude models usable.

Three environment variables control this (all optional; the defaults preserve first-party Anthropic behavior):

| Environment variable | Description |
|---|---|
| `ANTHROPIC_BASE_URL` | Base URL of the Anthropic-compatible endpoint. |
| `ANTHROPIC_AUTH_TOKEN` | Bearer-token auth for the endpoint. Used instead of `ANTHROPIC_API_KEY`; either one satisfies the credential requirement. |
| `SKILLPM_SUGGEST_MODEL` | Model name to request. Defaults to `claude-sonnet-4-6`. |

```bash
# Example: route suggest through a LiteLLM proxy
export ANTHROPIC_BASE_URL=https://litellm.internal.example.com
export ANTHROPIC_AUTH_TOKEN=sk-proxy-...
export SKILLPM_SUGGEST_MODEL=my-proxy-model-alias
skillpm suggest
```

These also apply to the `skilldex_suggest` MCP tool — set them in the server's `env` block. See [mcp.md](mcp.md).

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

The model used is `claude-sonnet-4-6` by default, overridable with `SKILLPM_SUGGEST_MODEL` (see [Custom Endpoints](#custom-endpoints)). The system prompt instructs the model to:
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
