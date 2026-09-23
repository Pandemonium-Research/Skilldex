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
1. Skilldex reads your project and builds a profile
2. It searches the registry with terms drawn from that profile
3. Claude chooses the best fits from the search results — and names needs the registry cannot meet
4. You approve, skip, or reassign the scope of each proposal
5. Approved skills are installed by owner/name; unmet needs can be drafted as new skills
```

The model never invents a skill name. It can only choose from what the registry search returned, so every proposal is a real skill that installs as-is.

### Step 1 — Project profile

Skilldex reads the project without a model: its ecosystem, dependencies, languages and tooling (from `package.json`, `pyproject.toml`, `Cargo.toml` and similar), its docs (the README and other markdown), a listing of `.claude/`, and the skills already installed. Facts such as dependencies seed the registry search directly; prose is what tells the model what the project is for.

If the profile is empty — nothing Skilldex can read — `suggest` says so and stops, instead of asking a model to guess.

### Step 2 — Registry search

Search terms from the profile are run against the registry. Searches that fail are reported, not swallowed: a thin result because some queries timed out would otherwise look like a project with few relevant skills. Skills already installed are left out.

### Step 3 — Selection

Claude is given the profile and the candidates and returns two lists:

- **proposals** — up to 7 of the candidates, each with a reason and a suggested scope. Each is identified by its `owner/name`, copied from the candidate list.
- **gaps** — up to 3 needs no candidate meets, each with a kebab-case name, a purpose and a reason.

The model is `claude-sonnet-4-6` by default, overridable with `SKILLPM_SUGGEST_MODEL` (see [Custom Endpoints](#custom-endpoints)).

### Step 4 — Interactive approval

```
Proposed skills for this project:
  1. anthropics/pdf                         [project]  100/100
     The README describes generating PDF reports from test results

anthropics/pdf: Install?
  ❯ Yes (project scope)
    Yes (shared scope)
    Yes (global scope)
    Skip
```

The suggested scope is the default choice.

### Step 5 — Installation and drafts

Approved skills are installed exactly as `skillpm install <owner>/<name>` would install them.

Gaps are then listed under **Not in the registry — these would have to be written**. For each, Skilldex offers to draft the skill into your project; a draft that validates can be installed straight away, and one that does not is left for you to fix.

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
      "qualifiedName": "anthropics/pdf",
      "name": "pdf",
      "owner": "anthropics",
      "reason": "The README describes generating PDF reports from test results",
      "suggestedScope": "project",
      "trustTier": "verified",
      "score": 100,
      "sourceUrl": "https://github.com/anthropics/skills/tree/main/skills/pdf"
    }
  ],
  "gaps": [
    {
      "name": "junit-report-parser",
      "purpose": "Parse JUnit XML test reports into a failure summary",
      "reason": "The CI config uploads JUnit reports, and no registry skill reads them"
    }
  ],
  "queries": ["pdf", "junit", "vitest"],
  "search": {
    "candidates": 42,
    "alreadyInstalled": [],
    "elapsedMs": 1830,
    "queries": []
  }
}
```

With an empty project profile the output is `{ "proposals": [], "reason": "no-project-context", "projectRoot": "…" }`.

**`SuggestionProposal` fields:**

| Field | Type | Description |
|---|---|---|
| `qualifiedName` | `string` | `owner/name` — installable as-is with `skillpm install` |
| `name`, `owner` | `string` | The two halves of the qualified name (`owner` may be `null`) |
| `reason` | `string` | One-sentence explanation of why this skill was proposed |
| `suggestedScope` | `ScopeLevel` | Claude's suggestion for which scope to install at |
| `trustTier` | `string` | `verified` or `community` |
| `score` | `number \| null` | The skill's format conformance score in the registry |
| `sourceUrl` | `string` | Where the skill is fetched from |

A gap has no `qualifiedName`: it names something to write, not something to install.

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

Returns the same JSON as `skillpm suggest --json`. See [docs/mcp.md](mcp.md) for the full tool schema.

---

## Design Philosophy

The suggestion loop exists because of a specific problem: most agent frameworks let the agent auto-install tools or load context without user awareness. This creates invisible state — the user doesn't know what's being loaded into context or why.

Skilldex's suggestion loop is an explicit checkpoint. The agent proposes what it thinks it needs. The user reads the reasons and decides. The scope assignment is intentional, not automatic.

This keeps the user in control of what's installed and at what scope, which matters especially for shared and global scopes that affect other projects.
