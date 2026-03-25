# Format Validation & Quality Scoring

The Skilldex validator checks how closely a skill package conforms to Anthropic's published skill format specification and produces a score from 0 to 100.

> **Important disclaimer:** The Skilldex quality score reflects conformance to Anthropic's skill format specification. It does **not** reflect the skill's functionality, usefulness, or whether it will trigger correctly in practice.

---

## Running Validation

```bash
# Validate and print the report
skillpm validate ./my-skill

# JSON output (useful for scripts and CI)
skillpm validate ./my-skill --json

# Validation runs automatically on every install
skillpm install ./my-skill
```

Validation also runs automatically when installing a skill. The result is shown if there are any warnings or errors; a clean install shows only the final score.

---

## Output Format

Feedback is compiler-style: one line per check, with severity label, line number where applicable, and a plain-English message.

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

**Severity labels:**

| Label | Meaning |
|---|---|
| `pass` | Check passed — points awarded |
| `warn` | Potential issue — points may be deducted, but installation is never blocked |
| `error` | Check failed — points deducted |

---

## Scoring System

The score is the sum of points awarded by each check. Maximum: **100 points**.

| Check | Max Points | Check ID |
|---|---|---|
| YAML frontmatter present and parseable | 25 | `yaml-frontmatter` |
| `name` field present and non-empty | 10 | `name-present` |
| `description` field present | 10 | `description-length` |
| `description` meets 30-word minimum | 10 | `description-length` |
| `SKILL.md` under 500 lines | 15 | `line-count` |
| Only allowed subdirectories present | 10 | `allowed-subdirs` |
| All referenced resources exist | 15 | `referenced-resources` |
| Bundled resources in correct subdirectories | 5 | `bundled-resources` |
| **Total** | **100** | |

---

## Check Details

### YAML frontmatter (25 pts) — Fatal

**What it checks:** Whether `SKILL.md` starts with a valid YAML frontmatter block delimited by `---`.

**Failure is fatal.** If frontmatter is missing or unparseable, the skill scores **0** immediately and no other checks run.

**Failure conditions:**
- File does not start with `---`
- Frontmatter has no closing `---`
- YAML between the delimiters is syntactically invalid

**Example failure output:**
```
  error   line 1: Missing YAML frontmatter — file must start with ---
Format conformance score: 0/100
```

---

### name field (10 pts)

**What it checks:** Whether the `name` key is present in the frontmatter and has a non-empty value.

**Failure condition:** `name` is absent, null, or whitespace-only.

**Example failure output:**
```
  error   line 2: Required field "name" is missing or empty
```

---

### description field (20 pts total)

**What it checks:** Whether `description` is present (10 pts) and meets the 30-word minimum (10 pts).

These are two separate point awards:
- 10 pts for being present and non-empty
- 10 additional pts for having 30 or more words

**Why 30 words?** Undertriggering is a known problem with Claude skills. A short description like `"Helps with debugging."` doesn't give Claude enough context to know when to invoke the skill. 30 words is a proxy for enough specificity.

**Word counting:** Splits on whitespace (`\s+`) — punctuation counts as part of its word.

**Example failure output:**
```
  error   line 3: description too short (current: 4 words, recommended: 30+)
```

---

### SKILL.md line count (15 pts)

**What it checks:** Whether `SKILL.md` is under the 500-line limit per Anthropic's spec.

| Lines | Result |
|---|---|
| ≤ 400 | Pass (15 pts) |
| 401–499 | Warning (15 pts, but warns you're close) |
| 500+ | Error (0 pts) |

**Example warning output:**
```
  warn    SKILL.md is 487 lines — approaching 500 line limit
```

**Example error output:**
```
  error   SKILL.md is 523 lines — exceeds 500 line limit
```

---

### Allowed subdirectories (10 pts)

**What it checks:** Whether the skill folder contains only `scripts/`, `references/`, and `assets/` as subdirectories.

Any other subdirectory (e.g., `bin/`, `src/`, `test/`) produces a warning.

**Scoring:** Partial credit — 3 points deducted per unknown directory, minimum 0. One unknown directory = 7/10 pts.

**Example warning output:**
```
  warn    Unknown subdirectory "bin" — only scripts/, references/, assets/ are allowed
  warn    Unknown subdirectory "src" — only scripts/, references/, assets/ are allowed
```

---

### Referenced resources exist (15 pts)

**What it checks:** Whether files referenced in `SKILL.md` via markdown links or relative paths actually exist in the skill folder.

**What is detected as a reference:**
- Markdown links: `[text](path/to/file)`
- Markdown images: `![alt](path/to/image)`
- Bare relative paths starting with `scripts/`, `references/`, or `assets/`: `scripts/setup.sh`

**External URLs are ignored** — `https://` and `http://` links are not checked.

If all references resolve, full 15 pts are awarded. Any broken reference deducts the full 15 pts (the check fails as a whole).

**Example error output:**
```
  error   line 12: references assets/template.docx but assets/template.docx not found
  error   line 18: references scripts/setup.sh but scripts/setup.sh not found
```

---

### Bundled resources structure (5 pts)

**What it checks:** Whether files in `scripts/` and `references/` are in the right directories (by file extension).

| Rule | Bad example |
|---|---|
| No `.md`, `.txt`, `.pdf` in `scripts/` | `scripts/README.md` (should be in `references/`) |
| No `.sh`, `.py`, `.js`, `.ts`, `.rb` in `references/` | `references/setup.sh` (should be in `scripts/`) |

**Example warning output:**
```
  warn    File "scripts/README.md (docs should go in references/)" appears to be misplaced
```

---

## Blocking vs. Non-Blocking

**Warnings are never blockers.** Installation always proceeds if the user chooses to continue, regardless of score or warnings.

The score is informational. It tells you the quality of the skill's format conformance so you can make an informed decision before installing. A score of 40 is valid — it just means the skill doesn't follow the format closely.

This matches how package managers work: `npm install` doesn't prevent you from installing a package with deprecation warnings.

---

## Score Interpretation

| Score | Meaning |
|---|---|
| 90–100 | Excellent — follows the format closely |
| 70–89 | Good — minor issues |
| 50–69 | Fair — some checks failed, review before installing |
| < 50 | Poor — significant format problems |
| 0 | Fatal — missing or invalid frontmatter |

---

## JSON Output

```bash
skillpm validate ./my-skill --json
```

```json
{
  "skill": "forensics-agent",
  "score": 70,
  "diagnostics": [
    {
      "severity": "pass",
      "message": "YAML frontmatter valid",
      "check": "yaml-frontmatter"
    },
    {
      "severity": "pass",
      "message": "name field present",
      "check": "name-present"
    },
    {
      "severity": "error",
      "line": 12,
      "message": "references assets/template.docx but assets/template.docx not found",
      "check": "referenced-resources"
    }
  ],
  "specVersion": "1.0",
  "passCount": 5,
  "warnCount": 1,
  "errorCount": 1
}
```

**`ValidationDiagnostic` fields:**

| Field | Type | Description |
|---|---|---|
| `severity` | `"pass" \| "warning" \| "error"` | Check result |
| `line` | `number \| undefined` | Line number in `SKILL.md` (1-indexed), if applicable |
| `message` | `string` | Human-readable description |
| `check` | `string` | Machine-readable check ID (see table above) |

---

## Spec Versioning

The current spec version is **`1.0`**. This is printed at the bottom of every validation report and included in the JSON output as `specVersion`.

When Anthropic updates the skill format spec, Skilldex will cut a new scorer version. Installed skills track which spec version they were validated against (`specVersion` in `skilldex.json`). Skilldex will warn when a skill was validated against an older spec version than the current one.

---

## Programmatic Usage

The validator can be used directly from TypeScript:

```typescript
import { validateSkill } from 'skilldex/core/validator'

const result = await validateSkill('./forensics-agent')
console.log(result.score)         // 91
console.log(result.errorCount)    // 0
console.log(result.diagnostics)   // ValidationDiagnostic[]
```

The `renderValidationReport()` function from `src/cli/ui/output.ts` produces the human-readable report string from a `ValidationResult`.
