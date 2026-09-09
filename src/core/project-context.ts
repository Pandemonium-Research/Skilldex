import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * What we can learn about a project without asking a model.
 *
 * The previous gatherer looked at exactly four things: README.md (first 100 lines, and only three
 * spellings of the name), package.json, a flat listing of `.claude/`, and the installed-skill
 * manifest. Every probe was wrapped in a silent catch, and the caller had no emptiness check — so
 * on a repo with none of them the context string was `''` and the model was still asked for
 * suggestions. It answered, of course. That is the "invented skill names" failure: not a model
 * problem, an input problem.
 *
 * A Python repo, a Go repo, or any project whose docs are not named README hit that path. So does
 * this project's own research repo, which has sixty markdown files and no README.
 *
 * Two kinds of signal come out of a repo and they want different treatment:
 *
 *   Facts   — ecosystem, dependencies, languages, tooling. Extractable exactly, no inference, and
 *             they are what seed registry queries.
 *   Intent  — "a research repo for a conference submission on skill package management." No
 *             dependency list yields that sentence; it only exists in prose.
 *
 * This module gathers both and keeps them apart, so a caller can use the facts directly and spend
 * its token budget only on the prose.
 */

// --- Shapes ---

export type DocKind =
  | 'agent-instructions'
  | 'readme'
  | 'architecture'
  | 'contributing'
  | 'docs-index'
  | 'project-doc'

export interface DocExcerpt {
  /** Repo-relative, forward-slashed on every platform so output is stable across OSes. */
  path: string
  kind: DocKind
  text: string
  truncated: boolean
}

export interface DetectedManifest {
  path: string
  ecosystem: string
  name?: string
  description?: string
  scripts?: string[]
  dependencies: string[]
}

export interface ProjectProfile {
  root: string
  manifests: DetectedManifest[]
  languages: Array<{ language: string; files: number }>
  tooling: string[]
  docs: DocExcerpt[]
  installedSkills: string[]
  /**
   * Deterministic query seeds, most specific first.
   *
   * These exist so registry queries can be built without a model in the loop. Retrieval is
   * conjunctive — the registry ANDs every term — so these are single tokens by construction. A
   * multi-word seed would be a query that matches almost nothing.
   */
  keywords: string[]
  /** Nothing was found. The caller must not ask a model to suggest against this. */
  isEmpty: boolean
  scanned: { files: number; walkTruncated: boolean }
}

// --- Limits ---

/** Deep enough to see `src/api/routes/`, shallow enough not to walk a monorepo's whole tree. */
const MAX_DEPTH = 4
const MAX_ENTRIES = 5000

/** Total prose budget. Facts are small and always included; only docs are rationed. */
const DOC_BUDGET = 12000
const PER_DOC_CAP = 4000

/**
 * Loose top-level documents get a smaller slice than named ones.
 *
 * There can be many of them and no way to rank them, so a full-size cap would let the first one
 * alphabetically consume the whole remaining budget. A smaller cap fits several, which is the
 * better trade when none is known to matter more than the others.
 */
const PER_EXTRA_DOC_CAP = 1200
const MAX_EXTRA_DOCS = 6

const MAX_DEPS_PER_MANIFEST = 60
const MAX_KEYWORDS = 40

/**
 * Directories never worth walking.
 *
 * A hardcoded set rather than a .gitignore parse: gitignore semantics (negation, precedence,
 * nested files) are a dependency's worth of work, and getting them subtly wrong would silently
 * drop real source. This list is the intersection everyone agrees on. The cost of the choice is
 * that a project ignoring something unusual has it counted anyway, which skews a histogram at
 * worst.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  'vendor',
  '.gradle',
  '.idea',
  '.cache',
  '.turbo',
  '.terraform',
])

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cs': 'C#',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.cc': 'C++',
  '.scala': 'Scala',
  '.sh': 'Shell',
  '.sql': 'SQL',
  '.ipynb': 'Jupyter Notebook',
  '.jl': 'Julia',
  '.lua': 'Lua',
  '.dart': 'Dart',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
}

// --- Small helpers ---

async function readFileSafe(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Repo-relative and forward-slashed.
 *
 * Normalising the separator is not cosmetic: this repo has a standing bug class around Windows
 * paths and CRLF, and a profile whose contents differ by platform would make every fixture test
 * pass on one machine and fail on the other.
 */
function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}

/** Line endings normalised for the same reason — a CRLF doc must excerpt identically. */
function normaliseText(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/** `requests>=2.31,<3` and `"@scope/pkg"` both reduce to something searchable. */
function bareDependencyName(raw: string): string {
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .split(/[<>=!~;[\s(]/)[0]
    .trim()
}

// --- Repo walk ---

interface WalkResult {
  files: string[]
  dirs: string[]
  truncated: boolean
}

/**
 * One bounded pass over the tree, feeding both the language histogram and tooling detection.
 *
 * Breadth-first, and that is load-bearing rather than stylistic. A depth-first walk spends its
 * whole entry budget inside whichever large subtree it happens to meet first. Measured on this
 * project's own research repo, one retired experiment's `raw/` directory holds 36,000 API dumps
 * four levels down; depth-first hit the cap inside it having seen five source files in the entire
 * rest of the tree, and reported a language histogram to match. Breadth-first spends the budget
 * on the shallow levels — where manifests, documentation and source actually live — and truncates
 * the deep ends instead, which is the half worth losing.
 *
 * Symlinked directories are not followed. A repo that links a parent into itself would otherwise
 * walk until the depth cap saved it, counting the same files several times on the way.
 */
async function walkRepo(root: string): Promise<WalkResult> {
  const files: string[] = []
  const dirs: string[] = []
  let truncated = false
  let frontier: string[] = [root]

  for (let depth = 0; depth <= MAX_DEPTH && frontier.length > 0 && !truncated; depth++) {
    const next: string[] = []

    for (const dir of frontier) {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (files.length >= MAX_ENTRIES) {
          truncated = true
          break
        }

        if (entry.isSymbolicLink()) continue

        const abs = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue
          dirs.push(relPath(root, abs))
          next.push(abs)
        } else if (entry.isFile()) {
          files.push(relPath(root, abs))
        }
      }

      if (truncated) break
    }

    frontier = next
  }

  return { files, dirs, truncated }
}

// --- Manifests ---

/**
 * Dependency names out of a TOML file, without a TOML parser.
 *
 * Deliberately shallow. We want names to seed searches, never versions or resolution, so a real
 * parser would buy accuracy nobody spends. Two shapes cover the field: a PEP 621 / Cargo
 * `dependencies = [...]` array, and a `[tool.poetry.dependencies]`-style table of `name = spec`.
 */
function tomlDependencyNames(text: string, tableNames: string[]): string[] {
  const names: string[] = []

  for (const match of text.matchAll(/dependencies\s*=\s*\[([^\]]*)\]/gs)) {
    for (const quoted of match[1].matchAll(/["']([^"']+)["']/g)) {
      names.push(bareDependencyName(quoted[1]))
    }
  }

  const lines = normaliseText(text).split('\n')
  let inTable = false
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (header) {
      inTable = tableNames.some((t) => header[1] === t || header[1].endsWith(`.${t}`))
      continue
    }
    if (!inTable) continue
    const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/)
    if (kv) names.push(bareDependencyName(kv[1]))
  }

  return names
}

async function detectManifests(root: string, files: string[]): Promise<DetectedManifest[]> {
  const found: DetectedManifest[] = []
  const top = new Set(files.filter((f) => !f.includes('/')))
  const add = (m: DetectedManifest) => {
    m.dependencies = [...new Set(m.dependencies.filter(Boolean))].slice(0, MAX_DEPS_PER_MANIFEST)
    found.push(m)
  }

  // npm
  if (top.has('package.json')) {
    const raw = await readFileSafe(path.join(root, 'package.json'))
    if (raw) {
      try {
        const pkg = JSON.parse(raw) as {
          name?: string
          description?: string
          scripts?: Record<string, string>
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
        add({
          path: 'package.json',
          ecosystem: 'npm',
          name: pkg.name,
          description: pkg.description,
          scripts: Object.keys(pkg.scripts ?? {}),
          dependencies: [
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.devDependencies ?? {}),
          ],
        })
      } catch {
        // Malformed package.json — the rest of the profile is still worth having.
      }
    }
  }

  // Python
  if (top.has('pyproject.toml')) {
    const raw = await readFileSafe(path.join(root, 'pyproject.toml'))
    if (raw) {
      const name = raw.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1]
      const description = raw.match(/^\s*description\s*=\s*["']([^"']+)["']/m)?.[1]
      add({
        path: 'pyproject.toml',
        ecosystem: 'python',
        name,
        description,
        dependencies: tomlDependencyNames(raw, ['dependencies', 'dev-dependencies']),
      })
    }
  }

  for (const req of ['requirements.txt', 'requirements-dev.txt']) {
    if (!top.has(req)) continue
    const raw = await readFileSafe(path.join(root, req))
    if (!raw) continue
    const deps = normaliseText(raw)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
      .map(bareDependencyName)
    add({ path: req, ecosystem: 'python', dependencies: deps })
  }

  // Rust
  if (top.has('Cargo.toml')) {
    const raw = await readFileSafe(path.join(root, 'Cargo.toml'))
    if (raw) {
      add({
        path: 'Cargo.toml',
        ecosystem: 'cargo',
        name: raw.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1],
        description: raw.match(/^\s*description\s*=\s*["']([^"']+)["']/m)?.[1],
        dependencies: tomlDependencyNames(raw, [
          'dependencies',
          'dev-dependencies',
          'build-dependencies',
        ]),
      })
    }
  }

  // Go
  if (top.has('go.mod')) {
    const raw = await readFileSafe(path.join(root, 'go.mod'))
    if (raw) {
      const lines = normaliseText(raw).split('\n')
      const deps: string[] = []
      let inRequire = false
      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith('require (')) {
          inRequire = true
          continue
        }
        if (inRequire && t === ')') {
          inRequire = false
          continue
        }
        const single = t.match(/^require\s+(\S+)/)
        if (single) deps.push(single[1])
        else if (inRequire && t && !t.startsWith('//')) deps.push(t.split(/\s+/)[0])
      }
      add({
        path: 'go.mod',
        ecosystem: 'go',
        name: raw.match(/^module\s+(\S+)/m)?.[1],
        dependencies: deps,
      })
    }
  }

  // Ruby
  if (top.has('Gemfile')) {
    const raw = await readFileSafe(path.join(root, 'Gemfile'))
    if (raw) {
      const deps = [...raw.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1])
      add({ path: 'Gemfile', ecosystem: 'rubygems', dependencies: deps })
    }
  }

  // PHP
  if (top.has('composer.json')) {
    const raw = await readFileSafe(path.join(root, 'composer.json'))
    if (raw) {
      try {
        const composer = JSON.parse(raw) as {
          name?: string
          description?: string
          require?: Record<string, string>
          'require-dev'?: Record<string, string>
        }
        add({
          path: 'composer.json',
          ecosystem: 'composer',
          name: composer.name,
          description: composer.description,
          dependencies: [
            ...Object.keys(composer.require ?? {}),
            ...Object.keys(composer['require-dev'] ?? {}),
          ],
        })
      } catch {
        // As with package.json — skip the manifest, keep the profile.
      }
    }
  }

  // JVM
  if (top.has('pom.xml')) {
    const raw = await readFileSafe(path.join(root, 'pom.xml'))
    if (raw) {
      const deps = [...raw.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1].trim())
      add({ path: 'pom.xml', ecosystem: 'maven', dependencies: deps })
    }
  }

  for (const gradle of ['build.gradle', 'build.gradle.kts']) {
    if (!top.has(gradle)) continue
    const raw = await readFileSafe(path.join(root, gradle))
    if (!raw) continue
    const deps = [
      ...raw.matchAll(/(?:implementation|api|testImplementation)\s*[( ]\s*["']([^"']+)["']/g),
    ].map((m) => {
      const parts = m[1].split(':')
      return parts.length >= 2 ? parts[1] : parts[0]
    })
    add({ path: gradle, ecosystem: 'gradle', dependencies: deps })
  }

  // .NET
  for (const csproj of files.filter((f) => f.endsWith('.csproj') && !f.includes('/'))) {
    const raw = await readFileSafe(path.join(root, csproj))
    if (!raw) continue
    const deps = [...raw.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1])
    add({ path: csproj, ecosystem: 'nuget', dependencies: deps })
  }

  // Elixir
  if (top.has('mix.exs')) {
    const raw = await readFileSafe(path.join(root, 'mix.exs'))
    if (raw) {
      const deps = [...raw.matchAll(/\{\s*:([a-z_0-9]+)\s*,/g)].map((m) => m[1])
      add({ path: 'mix.exs', ecosystem: 'hex', dependencies: deps })
    }
  }

  return found
}

// --- Tooling ---

function detectTooling(files: string[], dirs: string[]): string[] {
  const fileSet = new Set(files)
  const dirSet = new Set(dirs)
  const hasFile = (name: string) => fileSet.has(name)
  const anyPath = (test: (p: string) => boolean) => files.some(test) || dirs.some(test)
  const found: string[] = []
  const mark = (label: string, present: boolean) => {
    if (present) found.push(label)
  }

  mark('GitHub Actions', anyPath((p) => p.startsWith('.github/workflows')))
  mark('GitLab CI', hasFile('.gitlab-ci.yml'))
  mark('CircleCI', anyPath((p) => p.startsWith('.circleci')))
  mark(
    'Docker',
    hasFile('Dockerfile') ||
      hasFile('docker-compose.yml') ||
      hasFile('docker-compose.yaml') ||
      hasFile('compose.yaml')
  )
  mark('Kubernetes', dirSet.has('k8s') || dirSet.has('kubernetes') || hasFile('Chart.yaml'))
  mark('Terraform', anyPath((p) => p.endsWith('.tf')))
  mark('Make', hasFile('Makefile'))
  mark('pre-commit', hasFile('.pre-commit-config.yaml'))
  mark('TypeScript', hasFile('tsconfig.json'))
  mark('ESLint', anyPath((p) => /^eslint\.config\.|^\.eslintrc/.test(p)))
  mark('Prettier', anyPath((p) => /^\.prettierrc/.test(p)))
  mark('Vitest', anyPath((p) => /^vitest\.config\./.test(p)))
  mark('Jest', anyPath((p) => /^jest\.config\./.test(p)))
  mark('Playwright', anyPath((p) => /^playwright\.config\./.test(p)))
  mark('Cypress', anyPath((p) => /^cypress\.config\./.test(p)))
  mark('pytest', hasFile('pytest.ini') || hasFile('conftest.py') || anyPath((p) => p.endsWith('/conftest.py')))
  mark('Ruff', hasFile('ruff.toml') || hasFile('.ruff.toml'))
  mark('Vercel', hasFile('vercel.json'))
  mark('Netlify', hasFile('netlify.toml'))
  mark('Fly.io', hasFile('fly.toml'))
  mark('Serverless Framework', hasFile('serverless.yml'))
  mark('Jupyter notebooks', anyPath((p) => p.endsWith('.ipynb')))

  return found
}

// --- Documentation ---

interface DocCandidate {
  file: string
  kind: DocKind
}

/**
 * Files whose whole purpose is telling an agent what this project is.
 *
 * Nothing in the CLI read these before, which is the single largest omission in the old gatherer:
 * they are prose a maintainer wrote for exactly the audience Skilldex serves, and they are often
 * the only place a project's domain is stated in words.
 */
const AGENT_INSTRUCTION_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
]

function findDocCandidates(files: string[]): DocCandidate[] {
  const byLower = new Map(files.map((f) => [f.toLowerCase(), f]))
  const candidates: DocCandidate[] = []
  const take = (name: string, kind: DocKind) => {
    const actual = byLower.get(name.toLowerCase())
    if (actual) candidates.push({ file: actual, kind })
  }

  for (const name of AGENT_INSTRUCTION_FILES) take(name, 'agent-instructions')

  // Any capitalisation, any markdown-ish extension. The old code listed three exact spellings and
  // missed README.MD and Readme.md, which is a silent total context loss on those repos.
  const readme = files.find((f) => !f.includes('/') && /^readme(\.(md|markdown|txt|rst))?$/i.test(f))
  if (readme) candidates.push({ file: readme, kind: 'readme' })

  take('ARCHITECTURE.md', 'architecture')
  take('CONTRIBUTING.md', 'contributing')
  take('docs/README.md', 'docs-index')
  take('docs/index.md', 'docs-index')

  // A project can keep its documentation as a set of top-level markdown files with no README among
  // them. This project's own research repo is exactly that: twenty-four such files, no README, and
  // everything that says what the project is living in them. Without this the profile sees the
  // agent instructions and nothing else.
  //
  // Name order is arbitrary, but it is deterministic, and the budget decides how many survive —
  // preferable to guessing at importance from a filename.
  const taken = new Set(candidates.map((c) => c.file))
  const looseDocs = files
    .filter((f) => !f.includes('/') && /\.(md|markdown)$/i.test(f) && !taken.has(f))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_EXTRA_DOCS)

  for (const file of looseDocs) candidates.push({ file, kind: 'project-doc' })

  return candidates
}

/**
 * Cut a document to fit, keeping its shape.
 *
 * Head-truncation alone throws away the fact that a long README has sections on deployment and
 * testing further down. Appending the remaining headings costs a few dozen tokens and preserves
 * what the rest of the document was about, which is most of what we need it for.
 */
function excerptDoc(text: string, cap: number): { text: string; truncated: boolean } {
  const normalised = normaliseText(text).trim()
  if (normalised.length <= cap) return { text: normalised, truncated: false }

  const head = normalised.slice(0, cap)
  const rest = normalised.slice(cap)
  const headings = rest
    .split('\n')
    .filter((l) => /^#{1,4}\s+\S/.test(l))
    .slice(0, 40)

  const outline =
    headings.length > 0
      ? `\n\n[truncated — remaining sections]\n${headings.join('\n')}`
      : '\n\n[truncated]'

  return { text: head + outline, truncated: true }
}

async function gatherDocs(root: string, files: string[]): Promise<DocExcerpt[]> {
  const docs: DocExcerpt[] = []
  let budget = DOC_BUDGET

  for (const candidate of findDocCandidates(files)) {
    if (budget <= 0) break
    const raw = await readFileSafe(path.join(root, candidate.file))
    if (!raw || !raw.trim()) continue

    const cap = candidate.kind === 'project-doc' ? PER_EXTRA_DOC_CAP : PER_DOC_CAP
    const { text, truncated } = excerptDoc(raw, Math.min(cap, budget))
    budget -= text.length
    docs.push({ path: candidate.file, kind: candidate.kind, text, truncated })
  }

  return docs
}

// --- Installed skills ---

async function readInstalledSkills(root: string): Promise<string[]> {
  const raw = await readFileSafe(path.join(root, '.skilldex', 'skilldex.json'))
  if (!raw) return []
  try {
    const manifest = JSON.parse(raw) as { skills?: Record<string, unknown> }
    return Object.keys(manifest.skills ?? {})
  } catch {
    return []
  }
}

// --- Keywords ---

/**
 * Seeds for registry queries, most specific first.
 *
 * Single tokens only, and that is a hard constraint rather than a preference: the registry ANDs
 * every term in a query, so a two-word seed asks for documents containing both and a sentence
 * asks for the intersection of five common words. Dependency names are the best seeds available —
 * specific, unambiguous, and already the vocabulary skill authors write in.
 */
/**
 * The searchable half of a dependency name.
 *
 * Ecosystems put the meaningful part in different places, and one rule for all of them destroys
 * information. A Go module path ends with the name — `github.com/gin-gonic/gin` is about `gin`.
 * An npm scope names the vendor and the tail is usually a generic word, so the scope is the part
 * a skill would be about: under a last-segment rule `@anthropic-ai/sdk` and
 * `@modelcontextprotocol/sdk` both become `sdk`, two unrelated dependencies collapsing into one
 * token that would match nothing useful. Measured on this CLI's own package.json, the scope is
 * the better token for four of its five scoped dependencies.
 *
 * `@types/x` is the exception, and a well-defined one: DefinitelyTyped's scope says only that a
 * package has type stubs, while the tail is the library actually in use.
 */
function searchableToken(raw: string): string {
  const name = raw.trim()

  if (name.startsWith('@')) {
    const [scope, tail] = name.slice(1).split('/')
    return (scope === 'types' && tail ? tail : scope).toLowerCase()
  }

  return name.split('/').pop()!.toLowerCase()
}

function buildKeywords(
  manifests: DetectedManifest[],
  languages: Array<{ language: string; files: number }>,
  tooling: string[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const push = (raw: string) => {
    const token = searchableToken(raw)
    if (!token || token.length < 2) return
    // Multi-word or punctuated tokens cannot survive a conjunctive query as a single term.
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(token)) return
    if (seen.has(token)) return
    seen.add(token)
    out.push(token)
  }

  for (const manifest of manifests) manifest.dependencies.forEach(push)
  for (const tool of tooling) push(tool)
  for (const lang of languages) push(lang.language)

  return out.slice(0, MAX_KEYWORDS)
}

// --- Entry point ---

export async function gatherProjectProfile(root: string): Promise<ProjectProfile> {
  const { files, dirs, truncated } = await walkRepo(root)

  const histogram = new Map<string, number>()
  for (const file of files) {
    const language = LANGUAGE_BY_EXT[path.extname(file).toLowerCase()]
    if (language) histogram.set(language, (histogram.get(language) ?? 0) + 1)
  }
  const languages = [...histogram.entries()]
    .map(([language, count]) => ({ language, files: count }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language))

  const manifests = await detectManifests(root, files)
  const tooling = detectTooling(files, dirs)
  const docs = await gatherDocs(root, files)
  const installedSkills = await readInstalledSkills(root)
  const keywords = buildKeywords(manifests, languages, tooling)

  return {
    root,
    manifests,
    languages,
    tooling,
    docs,
    installedSkills,
    keywords,
    // Installed skills alone are not project signal — they say what is already there, not what the
    // project is. A profile with nothing but a manifest of past installs cannot ground a suggestion.
    isEmpty: manifests.length === 0 && docs.length === 0 && languages.length === 0,
    scanned: { files: files.length, walkTruncated: truncated },
  }
}

const DOC_HEADINGS: Record<DocKind, string> = {
  'agent-instructions': 'Agent instructions',
  readme: 'README',
  architecture: 'Architecture notes',
  contributing: 'Contributing guide',
  'docs-index': 'Documentation index',
  'project-doc': 'Project document',
}

/**
 * The profile as prose for a model prompt.
 *
 * Kept separate from gathering so the facts can be consumed directly. Query construction needs
 * `keywords`, not a paragraph describing them, and re-parsing our own rendered text to get back
 * what we already had in hand would be the kind of round trip that quietly drops data.
 */
export function renderProjectContext(profile: ProjectProfile): string {
  const parts: string[] = []

  const summary: string[] = [`Root: ${path.basename(profile.root)}`]
  if (profile.languages.length > 0) {
    summary.push(
      `Languages: ${profile.languages
        .slice(0, 6)
        .map((l) => `${l.language} (${l.files} file${l.files === 1 ? '' : 's'})`)
        .join(', ')}`
    )
  }
  if (profile.tooling.length > 0) summary.push(`Tooling: ${profile.tooling.join(', ')}`)
  parts.push(`## Project\n${summary.join('\n')}`)

  for (const manifest of profile.manifests) {
    const lines: string[] = [`Ecosystem: ${manifest.ecosystem}`]
    if (manifest.name) lines.push(`Name: ${manifest.name}`)
    if (manifest.description) lines.push(`Description: ${manifest.description}`)
    if (manifest.scripts?.length) lines.push(`Scripts: ${manifest.scripts.join(', ')}`)
    if (manifest.dependencies.length > 0) {
      lines.push(`Dependencies: ${manifest.dependencies.join(', ')}`)
    }
    parts.push(`## ${manifest.path}\n${lines.join('\n')}`)
  }

  for (const doc of profile.docs) {
    parts.push(`## ${DOC_HEADINGS[doc.kind]} — ${doc.path}\n${doc.text}`)
  }

  if (profile.installedSkills.length > 0) {
    parts.push(`## Already installed skills\n${profile.installedSkills.join(', ')}`)
  }

  return parts.join('\n\n')
}

/**
 * What was looked for, for the case where nothing was found.
 *
 * The old code's failure mode was answering anyway. Telling the user which probes came back empty
 * turns a confidently wrong list of invented skills into an actionable message.
 */
export function describeEmptyProfile(profile: ProjectProfile): string {
  return [
    `No project signal found in ${profile.root}.`,
    `Scanned ${profile.scanned.files} file${profile.scanned.files === 1 ? '' : 's'} for:`,
    '  - dependency manifests (package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, Gemfile, composer.json, pom.xml, build.gradle, *.csproj, mix.exs)',
    '  - documentation (README, CLAUDE.md, AGENTS.md, ARCHITECTURE.md, CONTRIBUTING.md, docs/)',
    '  - recognised source files',
  ].join('\n')
}
