# Skill Package Format

Skilldex works with the `.skill` package format as defined by Anthropic. It does not invent or own this format — it distributes and validates against it.

---

## Package Structure

A skill package is a **directory** (not a file) named after the skill, containing:

```
skill-name/
├── SKILL.md          ← required — instructions + metadata
├── scripts/          ← optional — executable code
├── references/       ← optional — docs loaded into context
└── assets/           ← optional — templates, icons, fonts
```

### Rules

- The directory name becomes the skill name in Skilldex
- `SKILL.md` must be present at the root of the directory
- Only `scripts/`, `references/`, and `assets/` are recognized subdirectories — others produce a warning
- Subdirectory nesting beyond one level is allowed but not validated

---

## SKILL.md

`SKILL.md` is the only required file. It must start with a valid YAML frontmatter block, followed by markdown instructions.

### Structure

```markdown
---
name: my-skill
description: A detailed description of what this skill does, when to invoke it,
  and what capabilities it provides. Should be at least 30 words.
version: 1.0.0
tags: [category, use-case]
author: your-name
specVersion: "1.0"
---

## Instructions

Your skill instructions here. This is the markdown body that tells Claude
what to do when this skill is invoked.
```

### Frontmatter Fields

| Field | Required | Type | Description |
|---|---|---|---|
| `name` | **Yes** | string | Skill name. Should match the directory name. |
| `description` | **Yes** | string | What the skill does and when to use it. Must be 30+ words. |
| `version` | No | string | Semantic version string, e.g. `1.0.0` |
| `tags` | No | string[] | Category tags for discovery |
| `author` | No | string | Skill author name or GitHub handle |
| `specVersion` | No | string | Skill format spec version this was written for, e.g. `"1.0"` |

**`name` and `description` are the only required fields.** All others are optional but recommended.

### Why description quality matters

Undertriggering is a known problem with Claude skills — if the description is too vague, Claude doesn't know when to invoke the skill. The 30-word minimum is a proxy for having enough specificity to trigger correctly. Write the description as if answering: *"When should I use this skill, and what will it do?"*

**Too short (fails):**
```yaml
description: Helps with debugging.
```

**Sufficient (passes):**
```yaml
description: Analyzes log files, stack traces, and crash reports to identify the root
  cause of failures. Use this skill when investigating bugs, production incidents,
  or unexpected application behavior.
```

### Line limit

`SKILL.md` must be **under 500 lines** (per Anthropic's spec). The validator warns at 400 lines and errors at 500+.

---

## Frontmatter Syntax

The frontmatter block must:
- Start at line 1 of the file with exactly `---`
- End with a line containing exactly `---`
- Contain valid YAML between those delimiters

The validator uses the `yaml` package's `parseDocument()` for parsing, which provides exact line/column positions for error reporting.

**Valid:**
```
---
name: my-skill
description: A long enough description that covers what this skill does.
---
```

**Invalid — missing opening delimiter:**
```
name: my-skill
description: ...
```

**Invalid — unclosed frontmatter:**
```
---
name: my-skill
description: ...
(no closing ---)
```

**Invalid — YAML parse error:**
```
---
name: [unclosed bracket
---
```

Missing frontmatter is a **fatal** validation error — the skill scores 0 and no other checks run.

---

## Bundled Resources

### `scripts/`

Executable code the skill may use or reference:

```
scripts/
├── setup.sh          ← shell scripts
├── analyze.py        ← Python scripts
└── helpers.js        ← JavaScript utilities
```

Do **not** put documentation files (`.md`, `.txt`, `.pdf`) in `scripts/` — they belong in `references/`.

### `references/`

Documentation or data files that the skill loads into context as needed:

```
references/
├── api-spec.md       ← spec docs
├── examples.txt      ← example data
└── schema.json       ← JSON schemas
```

Do **not** put executable scripts (`.sh`, `.py`, `.js`, `.ts`, `.rb`) in `references/` — they belong in `scripts/`.

### `assets/`

Static resources like templates, icons, or fonts:

```
assets/
├── report-template.docx
├── icon.png
└── brand-font.ttf
```

---

## Resource References in SKILL.md

When `SKILL.md` contains references to files inside the skill package (via markdown links or plain paths), the validator checks that those files actually exist.

**These will be validated:**
```markdown
See [the template](assets/report-template.docx) for the output format.
Run scripts/setup.sh before starting.
```

**These will not be validated** (external URLs are ignored):
```markdown
See [the spec](https://example.com/spec) for details.
```

If a referenced file is missing, the validator emits a line-level error pointing to the reference. This is worth 15 points in the scoring system.

---

## Example: Minimal Valid Skill

```
forensics-agent/
└── SKILL.md
```

```markdown
---
name: forensics-agent
description: Analyzes log files, stack traces, and crash reports to identify root
  causes of application failures. Invoke when debugging production incidents,
  unexpected crashes, or tracing errors through distributed system logs.
---

## Instructions

When the user asks you to debug an error or investigate a failure:

1. Ask for the relevant log files, stack traces, or error messages
2. Identify the error type and location
3. Trace the execution path that led to the failure
4. Propose the most likely root causes
5. Suggest fixes or next investigation steps
```

This would score approximately **80/100** — all required checks pass, but it has no `version`, `tags`, or `specVersion` (those aren't checked, but the `scripts/`, `references/`, and `assets/` directories don't exist either, so the bundled-resources check gives full credit by default).

---

## Example: Full-Featured Skill

```
forensics-agent/
├── SKILL.md
├── scripts/
│   └── parse-stacktrace.py
├── references/
│   └── common-error-patterns.md
└── assets/
    └── incident-report-template.md
```

```markdown
---
name: forensics-agent
description: Analyzes log files, stack traces, and crash reports to identify root
  causes of application failures. Invoke when debugging production incidents,
  unexpected crashes, or tracing errors through distributed system logs.
version: 1.2.0
tags: [debugging, logs, forensics, incident-response]
author: acme-engineering
specVersion: "1.0"
---

## Instructions

When debugging a failure or incident:

1. Ask the user for logs, stack traces, or error output
2. Run `scripts/parse-stacktrace.py` on any Python tracebacks
3. Cross-reference with `references/common-error-patterns.md` for known patterns
4. Use `assets/incident-report-template.md` to structure your findings
5. Identify root cause and propose remediation

...
```

---

## Spec Versioning

Skilldex tracks the Anthropic skill format spec version. Currently: **`v1.0`**.

- Every `skilldex.json` manifest records which spec version each skill was validated against
- When Anthropic updates the spec, Skilldex will cut a new scorer version
- Skilldex warns when a package was validated against an older spec version

The `specVersion` frontmatter field is optional. When absent, the current spec version is assumed.
