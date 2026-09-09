// Gathering what a project is, without asking a model.
//
// The gatherer this replaces read four things — README.md in three exact spellings, package.json,
// a flat listing of .claude/, and the install manifest — each behind a silent catch. A repo with
// none of them produced the empty string, and the caller passed it to the model anyway. So the
// cases below lean hard on repos that the old code saw nothing in: Python projects, repos whose
// documentation is CLAUDE.md, and READMEs capitalised differently.
//
// Repos are built in a temp directory rather than committed as fixtures because the interesting
// input here is the *shape* of a tree — ignored directories, depth, file mix — and a checked-in
// fixture of a node_modules folder is not something anyone wants in the repo.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  gatherProjectProfile,
  renderProjectContext,
  describeEmptyProfile,
} from '../../src/core/project-context.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-project-context-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

/**
 * Build a repo from a path -> contents map. Directories are created as needed.
 *
 * Directories are made first and the writes then run together: one case here needs several
 * thousand files to reach the walk's entry cap, and doing that strictly serially dominates the
 * runtime of the whole file.
 */
async function makeRepo(files: Record<string, string>): Promise<string> {
  const entries = Object.entries(files).map(([rel, contents]) => ({
    abs: path.join(tmpDir, rel),
    contents,
  }))

  for (const dir of new Set(entries.map((e) => path.dirname(e.abs)))) {
    await mkdir(dir, { recursive: true })
  }

  await Promise.all(entries.map((e) => writeFile(e.abs, e.contents, 'utf8')))
  return tmpDir
}

describe('empty projects', () => {
  it('reports isEmpty on a directory with nothing in it', async () => {
    const profile = await gatherProjectProfile(tmpDir)
    expect(profile.isEmpty).toBe(true)
    expect(profile.manifests).toEqual([])
    expect(profile.docs).toEqual([])
    expect(profile.languages).toEqual([])
  })

  it('stays empty when the only thing present is a list of past installs', async () => {
    // Installed skills say what is already there, not what the project is. Treating them as
    // signal would let suggest ground itself on its own output.
    await makeRepo({
      '.skilldex/skilldex.json': JSON.stringify({ skills: { 'pdf-tools': {} } }),
    })
    const profile = await gatherProjectProfile(tmpDir)
    expect(profile.installedSkills).toEqual(['pdf-tools'])
    expect(profile.isEmpty).toBe(true)
  })

  it('names the probes it ran when nothing was found', async () => {
    const profile = await gatherProjectProfile(tmpDir)
    const message = describeEmptyProfile(profile)
    expect(message).toContain('pyproject.toml')
    expect(message).toContain('CLAUDE.md')
    expect(message).toContain('README')
  })
})

describe('repos the old gatherer saw nothing in', () => {
  it('reads a Python project with no package.json and no README', async () => {
    await makeRepo({
      'requirements.txt': '# analysis stack\nrequests>=2.31\npandas==2.1.0\npytest\n-r other.txt\n',
      'src/analyse.py': 'print("hi")\n',
      'src/util.py': '',
    })

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.isEmpty).toBe(false)
    expect(profile.manifests).toHaveLength(1)
    expect(profile.manifests[0].ecosystem).toBe('python')
    expect(profile.manifests[0].dependencies).toEqual(['requests', 'pandas', 'pytest'])
    expect(profile.languages).toEqual([{ language: 'Python', files: 2 }])
  })

  it('reads CLAUDE.md when it is the only documentation', async () => {
    // The exact shape of this project's own research repo: sixty markdown files, no README,
    // no package.json. The old gatherer returned '' and the model invented from nothing.
    await makeRepo({
      'CLAUDE.md': '# Research repo\n\nExperiment scripts for a conference submission.\n',
      'experiments/run.py': '',
    })

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.isEmpty).toBe(false)
    expect(profile.docs).toHaveLength(1)
    expect(profile.docs[0].kind).toBe('agent-instructions')
    expect(profile.docs[0].path).toBe('CLAUDE.md')
    expect(profile.docs[0].text).toContain('conference submission')
  })

  it('finds AGENTS.md and copilot instructions too', async () => {
    await makeRepo({
      'AGENTS.md': 'agent notes\n',
      '.github/copilot-instructions.md': 'copilot notes\n',
    })

    const profile = await gatherProjectProfile(tmpDir)
    const paths = profile.docs.map((d) => d.path)

    expect(paths).toContain('AGENTS.md')
    expect(paths).toContain('.github/copilot-instructions.md')
    expect(profile.docs.every((d) => d.kind === 'agent-instructions')).toBe(true)
  })

  it.each(['README.MD', 'Readme.md', 'readme.txt', 'README'])(
    'finds a README spelled %s',
    async (name) => {
      // The old code tested exactly three names. Any other capitalisation was total context loss.
      await makeRepo({ [name]: 'A project that renders invoices.\n' })

      const profile = await gatherProjectProfile(tmpDir)

      expect(profile.docs).toHaveLength(1)
      expect(profile.docs[0].kind).toBe('readme')
      expect(profile.docs[0].text).toContain('invoices')
    }
  )
})

describe('manifest parsing', () => {
  it('reads name, description, scripts and both dependency blocks from package.json', async () => {
    await makeRepo({
      'package.json': JSON.stringify({
        name: 'invoice-api',
        description: 'Billing service',
        scripts: { test: 'vitest', build: 'tsc' },
        dependencies: { express: '^4', zod: '^3' },
        devDependencies: { vitest: '^3' },
      }),
    })

    const profile = await gatherProjectProfile(tmpDir)
    const manifest = profile.manifests[0]

    expect(manifest.ecosystem).toBe('npm')
    expect(manifest.name).toBe('invoice-api')
    expect(manifest.description).toBe('Billing service')
    expect(manifest.scripts).toEqual(['test', 'build'])
    expect(manifest.dependencies).toEqual(['express', 'zod', 'vitest'])
  })

  it('survives a malformed package.json and still profiles the rest', async () => {
    await makeRepo({
      'package.json': '{ this is not json',
      'CLAUDE.md': 'still readable\n',
      'src/index.ts': '',
    })

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.manifests).toEqual([])
    expect(profile.docs).toHaveLength(1)
    expect(profile.languages).toEqual([{ language: 'TypeScript', files: 1 }])
    expect(profile.isEmpty).toBe(false)
  })

  it('reads PEP 621 and poetry dependency shapes out of pyproject.toml', async () => {
    await makeRepo({
      'pyproject.toml': [
        '[project]',
        'name = "corpus-tools"',
        'description = "Corpus preparation"',
        'dependencies = ["httpx>=0.27", "rich"]',
        '',
        '[tool.poetry.dependencies]',
        'polars = "^1.0"',
        'duckdb = "*"',
      ].join('\n'),
    })

    const manifest = (await gatherProjectProfile(tmpDir)).manifests[0]

    expect(manifest.name).toBe('corpus-tools')
    expect(manifest.description).toBe('Corpus preparation')
    expect(manifest.dependencies).toEqual(['httpx', 'rich', 'polars', 'duckdb'])
  })

  it('reads go.mod require blocks', async () => {
    await makeRepo({
      'go.mod': [
        'module github.com/acme/billing',
        'go 1.22',
        'require (',
        '\tgithub.com/gin-gonic/gin v1.9.1',
        '\tgithub.com/stretchr/testify v1.8.4',
        ')',
      ].join('\n'),
    })

    const manifest = (await gatherProjectProfile(tmpDir)).manifests[0]

    expect(manifest.ecosystem).toBe('go')
    expect(manifest.name).toBe('github.com/acme/billing')
    expect(manifest.dependencies).toEqual([
      'github.com/gin-gonic/gin',
      'github.com/stretchr/testify',
    ])
  })

  it('reads Cargo, Gemfile, composer and pom manifests', async () => {
    await makeRepo({
      'Cargo.toml': '[package]\nname = "parser"\n\n[dependencies]\nserde = "1"\ntokio = "1"\n',
      Gemfile: 'source "https://rubygems.org"\ngem "rails", "~> 7"\ngem "puma"\n',
      'composer.json': JSON.stringify({ require: { 'laravel/framework': '^10' } }),
      'pom.xml': '<project><dependencies><dependency><artifactId>junit</artifactId></dependency></dependencies></project>',
    })

    const byPath = Object.fromEntries(
      (await gatherProjectProfile(tmpDir)).manifests.map((m) => [m.path, m])
    )

    expect(byPath['Cargo.toml'].dependencies).toEqual(['serde', 'tokio'])
    expect(byPath['Gemfile'].dependencies).toEqual(['rails', 'puma'])
    expect(byPath['composer.json'].dependencies).toEqual(['laravel/framework'])
    expect(byPath['pom.xml'].dependencies).toEqual(['junit'])
  })
})

describe('walking the tree', () => {
  it('does not count files inside ignored directories', async () => {
    await makeRepo({
      'src/index.ts': '',
      'node_modules/left-pad/index.js': '',
      'node_modules/left-pad/package.json': '{}',
      'dist/index.js': '',
      '__pycache__/thing.py': '',
    })

    const profile = await gatherProjectProfile(tmpDir)

    // One TypeScript file, and none of the JavaScript or Python under ignored directories.
    expect(profile.languages).toEqual([{ language: 'TypeScript', files: 1 }])
  })

  it('stops descending past the depth cap', async () => {
    await makeRepo({
      'a/b/c/d/shallow.py': '',
      'a/b/c/d/e/f/deep.py': '',
    })

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.languages).toEqual([{ language: 'Python', files: 1 }])
  })

  it('spends its entry budget breadth-first, not inside the first large subtree', async () => {
    // The failure this prevents, measured on this project's research repo: one retired
    // experiment's raw/ directory holds 36,000 API dumps, and a depth-first walk exhausted the
    // cap inside it having seen five source files anywhere else. Here `aaa_bulk/` sorts first and
    // is deep, so a depth-first walk reaches it before the shallow source and never comes back.
    const files: Record<string, string> = { 'src/main.py': '', 'lib/helper.py': '' }
    for (let i = 0; i < 6000; i++) files[`aaa_bulk/data/chunk/x${i}.json`] = '{}'
    await makeRepo(files)

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.scanned.walkTruncated).toBe(true)
    // Both shallow source files survive the truncation, because they are found before the depth
    // at which the bulk directory lives.
    expect(profile.languages).toEqual([{ language: 'Python', files: 2 }])
  })

  it('reports repo-relative paths with forward slashes on every platform', async () => {
    // A profile whose contents differ by platform would make these tests pass on one machine and
    // fail on the other — the standing Windows-path hazard in this repo.
    await makeRepo({ '.github/copilot-instructions.md': 'notes\n' })

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.docs[0].path).toBe('.github/copilot-instructions.md')
    expect(profile.docs[0].path).not.toContain('\\')
  })
})

describe('tooling detection', () => {
  it('recognises CI, containers, infrastructure and notebooks', async () => {
    await makeRepo({
      '.github/workflows/ci.yml': 'on: push\n',
      Dockerfile: 'FROM node:20\n',
      'infra/main.tf': 'resource "aws_s3_bucket" "b" {}\n',
      'analysis/explore.ipynb': '{}',
      'tsconfig.json': '{}',
      'vitest.config.ts': '',
    })

    const { tooling } = await gatherProjectProfile(tmpDir)

    expect(tooling).toContain('GitHub Actions')
    expect(tooling).toContain('Docker')
    expect(tooling).toContain('Terraform')
    expect(tooling).toContain('Jupyter notebooks')
    expect(tooling).toContain('TypeScript')
    expect(tooling).toContain('Vitest')
  })

  it('recognises pytest from conftest.py in a subdirectory', async () => {
    await makeRepo({ 'tests/conftest.py': '' })
    const { tooling } = await gatherProjectProfile(tmpDir)
    expect(tooling).toContain('pytest')
  })
})

describe('document excerpting', () => {
  it('keeps a short document whole', async () => {
    await makeRepo({ 'README.md': '# Small\n\nNot much here.\n' })
    const doc = (await gatherProjectProfile(tmpDir)).docs[0]

    expect(doc.truncated).toBe(false)
    expect(doc.text).toBe('# Small\n\nNot much here.')
  })

  it('truncates a long document but keeps the headings that follow', async () => {
    // Head-truncation alone loses the fact that a long README covers deployment further down.
    const long = [
      '# Service\n',
      'x'.repeat(5000),
      '\n## Deployment\n\nsome text\n',
      '\n## Troubleshooting\n\nmore text\n',
    ].join('')
    await makeRepo({ 'README.md': long })

    const doc = (await gatherProjectProfile(tmpDir)).docs[0]

    expect(doc.truncated).toBe(true)
    expect(doc.text).toContain('[truncated — remaining sections]')
    expect(doc.text).toContain('## Deployment')
    expect(doc.text).toContain('## Troubleshooting')
  })

  it('normalises CRLF so a Windows-authored document excerpts identically', async () => {
    await makeRepo({ 'README.md': '# Title\r\n\r\nA line.\r\n' })
    const doc = (await gatherProjectProfile(tmpDir)).docs[0]

    expect(doc.text).toBe('# Title\n\nA line.')
    expect(doc.text).not.toContain('\r')
  })

  it('picks up top-level markdown when the project has no README', async () => {
    // The research-repo shape: many top-level documents carrying everything that says what the
    // project is, and not a README among them.
    await makeRepo({
      'CLAUDE.md': 'agent rules\n',
      'EXPERIMENTS.md': 'The plan of record for the study.\n',
      'FINDINGS.md': 'What the audit turned up.\n',
      'BACKLOG.md': 'Outstanding work.\n',
    })

    const profile = await gatherProjectProfile(tmpDir)
    const byPath = Object.fromEntries(profile.docs.map((d) => [d.path, d]))

    expect(byPath['CLAUDE.md'].kind).toBe('agent-instructions')
    expect(byPath['EXPERIMENTS.md'].kind).toBe('project-doc')
    expect(byPath['FINDINGS.md'].kind).toBe('project-doc')
    expect(byPath['BACKLOG.md'].kind).toBe('project-doc')
    expect(profile.docs[0].path).toBe('CLAUDE.md')
  })

  it('does not list a named document twice as a loose one', async () => {
    await makeRepo({ 'README.md': 'readme text\n', 'CONTRIBUTING.md': 'how to help\n' })

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.docs.map((d) => d.path)).toEqual(['README.md', 'CONTRIBUTING.md'])
    expect(profile.docs.map((d) => d.kind)).toEqual(['readme', 'contributing'])
  })

  it('caps how many loose documents it takes', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 20; i++) files[`DOC_${String(i).padStart(2, '0')}.md`] = `doc ${i}\n`
    await makeRepo(files)

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.docs).toHaveLength(6)
    expect(profile.docs[0].path).toBe('DOC_00.md')
  })

  it('gives loose documents a smaller slice so several fit', async () => {
    // One document must not consume the whole remaining budget just for sorting first.
    await makeRepo({
      'AAA.md': 'a'.repeat(9000),
      'BBB.md': 'b'.repeat(9000),
      'CCC.md': 'c'.repeat(9000),
    })

    const profile = await gatherProjectProfile(tmpDir)

    expect(profile.docs.map((d) => d.path)).toEqual(['AAA.md', 'BBB.md', 'CCC.md'])
    expect(profile.docs.every((d) => d.truncated)).toBe(true)
    expect(profile.docs.every((d) => d.text.length < 2000)).toBe(true)
  })

  it('skips a document that is present but empty', async () => {
    await makeRepo({ 'README.md': '   \n', 'src/main.py': '' })
    const profile = await gatherProjectProfile(tmpDir)
    expect(profile.docs).toEqual([])
  })
})

describe('keywords', () => {
  it('emits single searchable tokens, scope- and path-stripped', async () => {
    // Retrieval is conjunctive, so every seed must be one term. '@types/node' and a Go module
    // path both have to reduce to something a registry query can match.
    await makeRepo({
      'package.json': JSON.stringify({
        dependencies: { '@types/node': '^20', express: '^4' },
      }),
      'go.mod': 'module x\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n',
    })

    const { keywords } = await gatherProjectProfile(tmpDir)

    expect(keywords).toContain('node')
    expect(keywords).toContain('express')
    expect(keywords).toContain('gin')
    expect(keywords.every((k) => !k.includes('/'))).toBe(true)
    expect(keywords.every((k) => !k.includes(' '))).toBe(true)
    expect(keywords.every((k) => k === k.toLowerCase())).toBe(true)
  })

  it('keeps the vendor scope for scoped npm packages, not the generic tail', async () => {
    // Under a last-segment rule these two collapse to 'sdk' — one token, matching nothing, in
    // place of two distinct and searchable vendor names.
    await makeRepo({
      'package.json': JSON.stringify({
        dependencies: {
          '@anthropic-ai/sdk': '^0.51',
          '@modelcontextprotocol/sdk': '^1.10',
          '@inquirer/prompts': '^7',
        },
      }),
    })

    const { keywords } = await gatherProjectProfile(tmpDir)

    expect(keywords).toContain('anthropic-ai')
    expect(keywords).toContain('modelcontextprotocol')
    expect(keywords).toContain('inquirer')
    expect(keywords).not.toContain('sdk')
  })

  it('keeps the tail for @types packages, where the scope says nothing', async () => {
    await makeRepo({
      'package.json': JSON.stringify({ devDependencies: { '@types/node': '^20' } }),
    })

    const { keywords } = await gatherProjectProfile(tmpDir)

    expect(keywords).toContain('node')
    expect(keywords).not.toContain('types')
  })

  it('includes tooling and language names, without duplicates', async () => {
    await makeRepo({
      'package.json': JSON.stringify({ dependencies: { typescript: '^5' } }),
      'tsconfig.json': '{}',
      'src/a.ts': '',
    })

    const { keywords } = await gatherProjectProfile(tmpDir)

    // 'typescript' arrives from the dependency, the TypeScript tooling marker, and the language
    // histogram. It must appear once.
    expect(keywords.filter((k) => k === 'typescript')).toHaveLength(1)
  })

  it('drops tokens that cannot survive a conjunctive query', async () => {
    await makeRepo({
      'package.json': JSON.stringify({ dependencies: { 'C++ Builder': '1', ok: '1' } }),
    })

    const { keywords } = await gatherProjectProfile(tmpDir)

    expect(keywords).toContain('ok')
    expect(keywords.some((k) => k.includes('+') || k.includes(' '))).toBe(false)
  })
})

describe('renderProjectContext', () => {
  it('renders facts and prose into labelled sections', async () => {
    await makeRepo({
      'package.json': JSON.stringify({
        name: 'invoice-api',
        description: 'Billing service',
        dependencies: { express: '^4' },
      }),
      'CLAUDE.md': 'Follow the billing conventions.\n',
      'Dockerfile': 'FROM node:20\n',
      'src/index.ts': '',
      '.skilldex/skilldex.json': JSON.stringify({ skills: { 'pdf-tools': {} } }),
    })

    const rendered = renderProjectContext(await gatherProjectProfile(tmpDir))

    expect(rendered).toContain('## Project')
    expect(rendered).toContain('Languages: TypeScript (1 file)')
    expect(rendered).toContain('Tooling: Docker')
    expect(rendered).toContain('## package.json')
    expect(rendered).toContain('Name: invoice-api')
    expect(rendered).toContain('Dependencies: express')
    expect(rendered).toContain('## Agent instructions — CLAUDE.md')
    expect(rendered).toContain('Follow the billing conventions.')
    expect(rendered).toContain('## Already installed skills\npdf-tools')
  })

  it('renders nothing but the heading for an empty project', async () => {
    const rendered = renderProjectContext(await gatherProjectProfile(tmpDir))
    expect(rendered.trim()).toBe(`## Project\nRoot: ${path.basename(tmpDir)}`)
  })
})
