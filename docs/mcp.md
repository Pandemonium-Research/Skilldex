# MCP Server Integration

Skilldex exposes a Model Context Protocol (MCP) server so Claude Code can invoke all package management operations directly — installing skills mid-session, listing what's available, validating skill quality, and generating suggestions.

---

## Setup

### 1. Build Skilldex

```bash
git clone https://github.com/Pandemonium-Research/Skilldex.git
cd Skilldex
npm install && npm run build
```

### 2. Configure Claude Code

Add the server to your MCP config. Claude Code looks for `.mcp.json` in the project root, or you can add it to the global `~/.claude/mcp.json`.

**`.mcp.json` in your project root:**

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

The `ANTHROPIC_API_KEY` is only needed if you use the `skilldex_suggest` tool.

**After `npm install -g skilldex` (future):**

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

### 3. Restart Claude Code

After saving the config, restart Claude Code. The Skilldex tools will appear in the tool list.

---

## Transport

The MCP server uses **`StdioServerTransport`** — it communicates over stdin/stdout, which is the standard for local Claude Code MCP servers. There is no HTTP server, no port, and no authentication needed.

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

Install a skill from a local directory or a `git+https://` URL.

**Input:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `source` | `string` | Yes | — | Local path or `git+https://` URL |
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
> "Install the forensics-agent skill from git+https://github.com/acme/forensics-agent at project scope."

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

Generate AI-powered skill suggestions based on project context.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectPath` | `string` | No | Path to project. Defaults to the server's working directory. |

**Output:**

```json
{
  "proposals": [
    {
      "skillName": "forensics-agent",
      "reason": "Your README mentions log analysis and debugging production incidents",
      "suggestedScope": "project",
      "available": true
    },
    {
      "skillName": "test-writer",
      "reason": "package.json has extensive test scripts",
      "suggestedScope": "project",
      "available": true
    }
  ]
}
```

**Requirements:** `ANTHROPIC_API_KEY` must be set in the server's environment (see setup above).

**Example prompt to Claude Code:**
> "Suggest skills I should install for this project based on the codebase."

---

### `skilldex_search`

Search the Skilldex registry for skills.

> **Status:** Stub — returns an empty result set. Full registry search is not yet implemented.

**Input:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Search query |

**Output:**

```json
{
  "results": [],
  "total": 0,
  "message": "Registry search is not yet available in this version."
}
```

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
