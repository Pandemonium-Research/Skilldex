# Scope System

Skilldex uses a three-level hierarchical scope for skill installation, modeled after Python virtual environments and CSS cascade.

---

## The Three Scopes

```
global   → ~/.skilldex/global/     available to all projects on this machine
shared   → ~/.skilldex/shared/     shared custom skills across projects
project  → <project>/.skilldex/    skills specific to one project
```

### Resolution rule: local-first

When the same skill name exists at multiple scopes, the **lowest** (most specific) scope wins:

```
project  >  shared  >  global
```

A skill installed at project scope completely overrides the same-named skill at shared or global scope for that project. The agent only sees the project-level version.

### Scope isolation

The agent loads only skills relevant to its current scope context. It does not load everything globally — this keeps the agent's lookup space small and avoids context noise across projects.

---

## Directory Layout

```
~/.skilldex/
├── global/
│   ├── skilldex.json        ← manifest
│   └── skills/
│       └── skill-name/
│           └── SKILL.md
└── shared/
    ├── skilldex.json
    └── skills/

<project-root>/
└── .skilldex/
    ├── skilldex.json
    └── skills/
        └── skill-name/
            └── SKILL.md
```

The global and shared scopes live in `~/.skilldex/` (the user's home directory). The project scope lives inside the project under `.skilldex/`.

---

## Choosing the Right Scope

| Scenario | Use |
|---|---|
| Skill you want for every project (e.g. `code-reviewer`) | `global` |
| Custom skills shared across a team or set of projects | `shared` |
| Skill specific to this project's domain | `project` (default) |
| Overriding a global skill with a project-specific version | `project` |

The `--scope` flag defaults to `project` on all commands.

---

## The Manifest File (`skilldex.json`)

Each scope has a `skilldex.json` manifest that tracks installed skills. It is analogous to `package.json` in npm.

**Schema:**

```json
{
  "skilldexVersion": "1",
  "scope": "project",
  "updatedAt": "2026-03-26T12:00:00.000Z",
  "skills": {
    "forensics-agent": {
      "name": "forensics-agent",
      "version": "1.0.0",
      "source": "community",
      "sourceUrl": "git+https://github.com/user/forensics-agent",
      "installedAt": "2026-03-26T12:00:00.000Z",
      "specVersion": "1.0",
      "score": 91,
      "path": "skills/forensics-agent"
    }
  }
}
```

**Fields:**

| Field | Description |
|---|---|
| `skilldexVersion` | Manifest schema version (currently `"1"`) |
| `scope` | The scope level: `global`, `shared`, or `project` |
| `updatedAt` | ISO timestamp of last modification |
| `skills` | Map of skill name → `InstalledSkill` record |

**`InstalledSkill` record:**

| Field | Description |
|---|---|
| `name` | Skill name (matches directory name) |
| `version` | Version string from frontmatter, or `"1.0.0"` if not present |
| `source` | `"official"`, `"community"`, or `"local"` |
| `sourceUrl` | Git URL for community installs; absent for local installs |
| `installedAt` | ISO timestamp of installation |
| `specVersion` | Spec version the skill was validated against at install time |
| `score` | Format conformance score at install time (0–100) |
| `path` | Relative path within the scope root, e.g. `"skills/forensics-agent"` |

The manifest is written atomically (write to a temp file, then replace) to prevent corruption.

---

## Project Root Detection

When resolving the `project` scope, Skilldex walks up the directory tree from the current working directory to find the project root.

**Stops at** (in order):
1. A directory containing `.git/` — this is the git repo root
2. A directory containing `package.json` — this is a Node.js project root
3. The filesystem root — falls back to the original `cwd`

This means `.skilldex/` ends up at the same level as `.git/`, which is the expected location.

---

## Conflict Handling

When the same skill is installed at multiple scopes:

- **Different scopes, same name** → lower scope wins at runtime (project beats shared beats global). No error is raised.
- **Same scope, same name, no `--force`** → install is rejected with an error.
- **Same scope, same name, with `--force`** → skill directory is replaced, manifest is updated.

Skilldex does not currently warn you when installing a skill that overrides a higher-scope skill (e.g., installing `code-reviewer` at project scope when it's already at global scope). This is intentional — the override is explicit and the user knows which scope they're targeting.

---

## Team Workflows

### Shared skills for a team

Put team-wide skills at `shared` scope:

```bash
skillpm install ./our-coding-standards --scope shared
```

The `~/.skilldex/shared/` directory can be symlinked to a shared network location or synced via a dotfiles repo to make these available to all team members.

### Per-project skills in version control

The `.skilldex/` directory lives inside the project root. Add it to your `.gitignore` or commit it to share the project's skill set with your team:

```bash
# Commit the manifest but not the skill files themselves (if skills come from a registry)
echo ".skilldex/skills/" >> .gitignore
git add .skilldex/skilldex.json
git commit -m "Add project skill manifest"

# Or commit everything for a fully self-contained project
git add .skilldex/
git commit -m "Add project skills"
```

---

## Open Design Questions

The scope system has a few open questions that will be better answered with real usage:

1. **Arbitrary depth** — Is global/shared/project always three levels, or should depth be configurable?
2. **Shared layer governance in teams** — Who can promote a project skill to shared?
3. **Discovery without full load** — How does the agent efficiently know what's available per scope without loading every SKILL.md into context?

These are tracked in [SKILLSET_SPEC.md](../SKILLSET_SPEC.md).
