import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { validateSkill } from '../core/validator.js'
import { installFromPath, uninstallSkill } from '../core/installer.js'
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

  // skilldex_search (stub)
  server.tool(
    'skilldex_search',
    'Search the Skilldex registry for skills (coming soon)',
    {
      query: z.string().describe('Search query'),
    },
    async ({ query }) => {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: [],
              total: 0,
              message: 'Registry search is not yet available in this version.',
            }),
          },
        ],
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
