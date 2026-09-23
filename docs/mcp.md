# MCP Server Integration

Skilldex exposes a Model Context Protocol (MCP) server so any MCP-capable coding agent can invoke all package management operations directly — installing skills mid-session, listing what's available, validating skill quality, and generating suggestions.

The server is **agent-agnostic**. It communicates over stdio and speaks plain MCP, so Claude Code, Codex, Cursor, Windsurf, Zed, and any other MCP client all work the same way. All tools except `skilldex_suggest` are pure package-management operations (filesystem + registry) and call no LLM — their behavior is identical regardless of which agent invokes them. Only `skilldex_suggest` reaches an LLM, and only it needs an API key.

---

## Setup

### 1. Install Skilldex

```bash
npm install -g skilldex-cli
```

Or from source:

```bash
git clone https://github.com/Pandemonium-Research/Skilldex.git
cd Skilldex
npm install && npm run build
npm link
```

### 2. Register the server with your agent

The server is launched with `skillpm mcp` (a stdio server). Point your agent's MCP config at that command.

**Claude Code** — `.mcp.json` in the project root, or the global `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "skilldex": {
      "command": "skillpm",
      "args": ["mcp"]
    }
  }
}
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.skilldex]
command = "skillpm"
args = ["mcp"]
```

The `ANTHROPIC_API_KEY` environment variable is only needed if you use the `skilldex_suggest` tool. Add it via the config's `env` block:

```json
{
  "mcpServers": {
    "skilldex": {
      "command": "skillpm",
      "args": ["mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

```toml
# Codex equivalent
[mcp_servers.skilldex]
command = "skillpm"
args = ["mcp"]
env = { ANTHROPIC_API_KEY = "sk-ant-..." }
```

To point `skilldex_suggest` at a custom Anthropic-compatible endpoint instead, set `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and optionally `SKILLPM_SUGGEST_MODEL` in the same `env` block. See [suggest.md](suggest.md#custom-endpoints).

### 3. Restart your agent

After saving the config, restart the agent (or reload its MCP servers). The Skilldex tools will appear in the tool list.

---

## Transport

The MCP server uses **`StdioServerTransport`** — it communicates over stdin/stdout, the standard for local MCP servers. There is no HTTP server, no port, and no authentication needed.

---

## Available Tools

### `skilldex_validate`

Validate a skill folder and return its format conformance score.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | Yes | Absolute or relative path to the skill folder |

**Output:**

```json
{
  "skill": "forensics-agent",
  "score": 91,
  "diagnostics": [
    { "severity": "pass", "message": "YAML frontmatter valid", "check": "yaml-frontmatter" },
    { "severity": "pass", "message": "name field present", "check": "name-present" }
  ],
  "specVersion": "1.0",
  "passCount": 7,
  "warnCount": 0,
  "errorCount": 0
}
```

**Example prompt to Claude Code:**
> "Validate the skill at ./forensics-agent and tell me if it's ready to install."

---

### `skilldex_install`

Install a skill from the registry, a local directory, or a `git+https://` URL.

**Input:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `source` | `string` | Yes | — | Registry name (`owner/name`), local path, or `git+https://` URL |
| `scope` | `"global" \| "shared" \| "project"` | No | `"project"` | Installation scope |
| `force` | `boolean` | No | `false` | Overwrite if already installed |

**Output:**

```json
{
  "installed": true,
  "skillName": "forensics-agent",
  "scope": "project",
  "score": 91,
  "diagnostics": []
}
```

**Example prompt to Claude Code:**
> "Install anthropics/pdf at project scope."

A bare registry name that several owners publish is not guessed at: the tool returns the qualified candidates so the agent can retry with one.

---

### `skilldex_uninstall`

Remove an installed skill from a scope.

**Input:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `skillName` | `string` | Yes | — | Name of the skill to remove |
| `scope` | `"global" \| "shared" \| "project"` | No | `"project"` | Scope to remove from |

**Output:**

```json
{
  "removed": true,
  "skillName": "forensics-agent",
  "scope": "project"
}
```

---

### `skilldex_list`

List installed skills across scopes.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scope` | `"global" \| "shared" \| "project"` | No | Filter to a specific scope. Omit to show all. |

**Output:**

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
        "sourceUrl": "git+https://github.com/acme/forensics-agent",
        "installedAt": "2026-03-26T00:00:00.000Z",
        "specVersion": "1.0",
        "score": 91,
        "path": "skills/forensics-agent"
      }
    ]
  }
]
```

**Example prompt to Claude Code:**
> "What skills do I have installed for this project?"

---

### `skilldex_suggest`

Suggest registry skills for a project: search the registry from the project's context, then have Claude choose from the results.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectPath` | `string` | No | Path to project. Defaults to the server's working directory. |

**Output:** the same JSON as `skillpm suggest --json` — `proposals` identified by `qualifiedName` (`owner/name`, installable as-is with `skilldex_install`), `gaps` the registry has no skill for, the `queries` that were run, and a `search` summary. See [suggest.md](suggest.md#json-output).

**Requirements:** `ANTHROPIC_API_KEY` must be set in the server's environment (see setup above). Alternatively, point it at a custom Anthropic-compatible endpoint with `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` — see [suggest.md](suggest.md#custom-endpoints).

**Example prompt to Claude Code:**
> "Suggest skills I should install for this project based on the codebase."

---

### `skilldex_search`

Search the Skilldex registry for skills. Results are ranked by relevance.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Search query |
| `tier` | `"verified"` \| `"community"` | No | Filter by trust tier |
| `limit` | `number` (1–50) | No | Number of results to return (default 10) |

**Output:**

```json
{
  "skills": [
    { "name": "pdf-tools", "owner": "acme", "qualified_name": "acme/pdf-tools", "description": "…", "trust_tier": "community", "score": 90 }
  ],
  "total": 1000,
  "total_relation": "gte",
  "query": "pdf"
}
```

`total_relation` says how to read `total`. `"eq"` is an exact count. `"gte"` means the registry stopped
counting at its cap — 1,000 — and there are at least that many, so treat `total` as a floor, never as
the number of matches. Install a result by its `qualified_name`: bare names are shared by several
owners, and the registry refuses an ambiguous one.

---

## Working Directory

The MCP server resolves the `project` scope relative to its working directory when it starts. When launched by Claude Code, this is typically the project root.

If you're using the server for a different project than where it started, pass an explicit `projectPath` to `skilldex_suggest`, or use absolute paths with `skilldex_install`.

---

## Example Claude Code Session

```
User: What skills do I have installed?

Claude: [calls skilldex_list]
You have 1 skill installed at project scope:
- forensics-agent (score: 91/100, community)

User: Install the test-writer skill from my ~/skills directory.

Claude: [calls skilldex_install with source=~/skills/test-writer, scope=project]
Installed "test-writer" at project scope. Score: 84/100.

User: Suggest some more skills for this project.

Claude: [calls skilldex_suggest]
Based on your project context, I'd suggest:
1. code-reviewer — your package.json shows a TypeScript project with a review workflow
2. docs-generator — your README mentions documentation as a goal

Would you like me to install either of these?
```

---

## Troubleshooting

**"Could not connect to MCP server"**
- Verify the path in `args` is absolute and correct
- Run `node /path/to/Skilldex/dist/mcp/server.js` directly and check for errors
- Make sure `npm run build` was run after any changes

**"ANTHROPIC_API_KEY is required"**
- The `skilldex_suggest` tool requires the API key in the server's environment
- Add it to the `env` section of your `.mcp.json`

**Tools not appearing in Claude Code**
- Restart Claude Code after modifying `.mcp.json`
- Check that the JSON is valid (no trailing commas, etc.)
- Check Claude Code's MCP server logs
