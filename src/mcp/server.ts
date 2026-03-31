import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { validateSkill } from '../core/validator.js'
import { installFromPath, uninstallSkill } from '../core/installer.js'
import { installSkillsetFromPath, uninstallSkillset } from '../core/skillset-installer.js'
import { validateSkillset } from '../core/skillset-validator.js'
import { resolveScope, resolveAllScopes } from '../core/resolver.js'
import { readManifest } from '../core/manifest.js'
import { installFromGitUrl } from '../registry/sources/github.js'

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'skilldex',
    version: '0.1.0',
  })

  // skilldex_validate
  server.tool(
    'skilldex_validate',
    'Validate a skill folder and return its format conformance score',
    {
      path: z.string().describe('Absolute or relative path to the skill folder'),
    },
    async ({ path: skillPath }) => {
      const result = await validateSkill(skillPath)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }
  )

  // skilldex_install
  server.tool(
    'skilldex_install',
    'Install a skill from a local path or git+https:// URL',
    {
      source: z.string().describe('Local path or git+https:// URL'),
      scope: z.enum(['global', 'shared', 'project']).default('project'),
      force: z.boolean().default(false),
    },
    async ({ source, scope, force }) => {
      let result
      if (source.startsWith('git+')) {
        const scopeConfig = await resolveScope(scope)
        result = await installFromGitUrl(source, scopeConfig, { scope, force, sourceUrl: source })
      } else {
        result = await installFromPath(source, { scope, force })
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              installed: true,
              skillName: result.skillName,
              scope: result.scope,
              score: result.validation.score,
              diagnostics: result.validation.diagnostics,
            }),
          },
        ],
      }
    }
  )

  // skilldex_uninstall
  server.tool(
    'skilldex_uninstall',
    'Uninstall a skill from a scope',
    {
      skillName: z.string().describe('Name of the skill to uninstall'),
      scope: z.enum(['global', 'shared', 'project']).default('project'),
    },
    async ({ skillName, scope }) => {
      await uninstallSkill(skillName, scope)
      return {
        content: [{ type: 'text', text: JSON.stringify({ removed: true, skillName, scope }) }],
      }
    }
  )

  // skilldex_list
  server.tool(
    'skilldex_list',
    'List all installed skills across scopes',
    {
      scope: z.enum(['global', 'shared', 'project']).optional(),
    },
    async ({ scope }) => {
      const scopeConfigs = scope ? [await resolveScope(scope)] : await resolveAllScopes()
      const results = []
      for (const sc of scopeConfigs) {
        const manifest = await readManifest(sc)
        results.push({ level: sc.level, skills: Object.values(manifest.skills) })
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(results) }],
      }
    }
  )

  // skilldex_suggest
  server.tool(
    'skilldex_suggest',
    'Generate AI-powered skill suggestions for a project',
    {
      projectPath: z.string().optional().describe('Path to project (defaults to cwd)'),
    },
    async ({ projectPath }) => {
      const { gatherProjectContext, generateProposals } = await import('../core/suggest-agent.js')
      const { findProjectRoot } = await import('../core/resolver.js')
      const root = await findProjectRoot(projectPath ?? process.cwd())
      const context = await gatherProjectContext(root)
      const proposals = await generateProposals(context)
      return {
        content: [{ type: 'text', text: JSON.stringify({ proposals }) }],
      }
    }
  )

  // skilldex_search
  server.tool(
    'skilldex_search',
    'Search the Skilldex registry for skills by name, description, or tags',
    {
      query: z.string().describe('Search query'),
      tier: z.enum(['verified', 'community']).optional().describe('Filter by trust tier'),
      limit: z.number().int().min(1).max(50).default(10).describe('Number of results to return'),
    },
    async ({ query, tier, limit }) => {
      const { searchRegistry } = await import('../registry/sources/registry.js')
      const result = await searchRegistry({ q: query, tier, limit })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              skills: result.skills,
              total: result.total,
              query,
            }),
          },
        ],
      }
    }
  )

  // skilldex_skillset_install
  server.tool(
    'skilldex_skillset_install',
    'Install a skillset (and its embedded/remote skills) from a local path, git+https:// URL, or registry name',
    {
      source: z.string().describe('Local path, git+https:// URL, or registry skillset name'),
      scope: z.enum(['global', 'shared', 'project']).default('project'),
      force: z.boolean().default(false),
    },
    async ({ source, scope, force }) => {
      const isGitUrl = source.startsWith('git+')
      const isRegistryName = !isGitUrl && !source.startsWith('/') && !source.startsWith('.') && !source.includes('://')

      let result
      if (isRegistryName) {
        const { mkdtemp, rm } = await import('node:fs/promises')
        const path = await import('node:path')
        const os = await import('node:os')
        const { simpleGit } = await import('simple-git')
        const { parseGitUrl } = await import('../registry/sources/github.js')
        const { getSkillsetInstallInfo } = await import('../registry/sources/registry.js')
        const info = await getSkillsetInstallInfo(source)
        const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-mcp-skillset-'))
        try {
          const parsed = parseGitUrl(`git+${info.source_url}`)
          const git = simpleGit()
          const cloneOpts = parsed.branch ? ['--branch', parsed.branch, '--depth', '1'] : ['--depth', '1']
          await git.clone(parsed.repoUrl, tmpDir, cloneOpts)
          const searchRoot = parsed.subPath ? path.join(tmpDir, parsed.subPath) : tmpDir
          result = await installSkillsetFromPath(searchRoot, { scope, force, sourceUrl: info.source_url })
        } finally {
          await rm(tmpDir, { recursive: true, force: true })
        }
      } else if (isGitUrl) {
        const { mkdtemp, rm } = await import('node:fs/promises')
        const path = await import('node:path')
        const os = await import('node:os')
        const { simpleGit } = await import('simple-git')
        const { parseGitUrl } = await import('../registry/sources/github.js')
        const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skilldex-mcp-skillset-'))
        try {
          const parsed = parseGitUrl(source)
          const git = simpleGit()
          const cloneOpts = parsed.branch ? ['--branch', parsed.branch, '--depth', '1'] : ['--depth', '1']
          await git.clone(parsed.repoUrl, tmpDir, cloneOpts)
          const searchRoot = parsed.subPath ? path.join(tmpDir, parsed.subPath) : tmpDir
          result = await installSkillsetFromPath(searchRoot, { scope, force, sourceUrl: source })
        } finally {
          await rm(tmpDir, { recursive: true, force: true })
        }
      } else {
        result = await installSkillsetFromPath(source, { scope, force })
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            installed: true,
            skillsetName: result.skillsetName,
            scope: result.scope,
            score: result.validation.score,
            embeddedSkills: result.embeddedResults.map(r => r.skillName),
            remoteSkills: result.remoteResults.map(r => r.skillName),
          }),
        }],
      }
    }
  )

  // skilldex_skillset_uninstall
  server.tool(
    'skilldex_skillset_uninstall',
    'Uninstall a skillset and its skills from a scope',
    {
      skillsetName: z.string().describe('Name of the skillset to uninstall'),
      scope: z.enum(['global', 'shared', 'project']).default('project'),
    },
    async ({ skillsetName, scope }) => {
      await uninstallSkillset(skillsetName, scope)
      return {
        content: [{ type: 'text', text: JSON.stringify({ removed: true, skillsetName, scope }) }],
      }
    }
  )

  // skilldex_skillset_list
  server.tool(
    'skilldex_skillset_list',
    'List all installed skillsets across scopes',
    {
      scope: z.enum(['global', 'shared', 'project']).optional(),
    },
    async ({ scope }) => {
      const scopeConfigs = scope ? [await resolveScope(scope)] : await resolveAllScopes()
      const results = []
      for (const sc of scopeConfigs) {
        const manifest = await readManifest(sc)
        results.push({ level: sc.level, skillsets: Object.values(manifest.skillsets) })
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(results) }],
      }
    }
  )

  // skilldex_skillset_validate
  server.tool(
    'skilldex_skillset_validate',
    'Validate a skillset folder and return its format conformance score',
    {
      path: z.string().describe('Absolute or relative path to the skillset folder'),
    },
    async ({ path: skillsetPath }) => {
      const result = await validateSkillset(skillsetPath)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
