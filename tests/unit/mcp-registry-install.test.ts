// Installing a registry skill through the MCP server.
//
// skilldex_install branched on `git+` and sent everything else to installFromPath, so an agent
// handed a registry name looked for a directory called `mauromedda/terraform` and failed. The
// tool's own description said "local path or git+https:// URL", so the gap was documented rather
// than noticed — and skilldex_skillset_install, twenty lines below, resolved skillset names from
// the registry perfectly well. Skillsets installed from the registry through MCP; skills did not.
//
// The ambiguity case matters more here than in the CLI. An agent cannot be shown a picker, so a
// bare ambiguous name is a dead end unless the qualified alternatives come back as data it can
// retry with.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>
}>

const hoisted = vi.hoisted(() => ({
  tools: new Map<string, ToolHandler>(),
  installFromGitUrl: vi.fn(),
  installFromPath: vi.fn(),
}))

// Capture what the server registers instead of standing a real one up over stdio.
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    tool(name: string, _description: string, _schema: unknown, handler: ToolHandler) {
      hoisted.tools.set(name, handler)
    }
    async connect() {
      /* no transport in a unit test */
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}))

vi.mock('../../src/core/installer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/installer.js')>()),
  installFromPath: hoisted.installFromPath,
}))

vi.mock('../../src/registry/sources/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/registry/sources/github.js')>()),
  installFromGitUrl: hoisted.installFromGitUrl,
}))

let requested: string[] = []
let owners: string[] = []

const INSTALL_RESULT = {
  skillName: 'terraform',
  scope: 'project',
  validation: { score: 93, warnCount: 0, errorCount: 0, diagnostics: [] },
  bridged: [],
}

beforeEach(async () => {
  requested = []
  owners = ['mauromedda', 'dennisonbertram']
  hoisted.tools.clear()
  hoisted.installFromGitUrl.mockReset().mockResolvedValue(INSTALL_RESULT)
  hoisted.installFromPath.mockReset().mockResolvedValue(INSTALL_RESULT)

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url)
      requested.push(u)

      if (/\/skills\/terraform\/install$/.test(u)) {
        return new Response(
          JSON.stringify({
            error: 'Skill name "terraform" is claimed by multiple owners; use /skills/{owner}/terraform/install',
            code: 'AMBIGUOUS_NAME',
            owners,
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          name: 'terraform',
          owner: 'mauromedda',
          qualified_name: 'mauromedda/terraform',
          source_url: 'https://github.com/mauromedda/agent-toolkit/tree/HEAD/skills/terraform',
          score: 93,
          spec_version: '1.0',
          trust_tier: 'community',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
  )

  const { startMcpServer } = await import('../../src/mcp/server.js')
  await startMcpServer()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function install(source: string) {
  const handler = hoisted.tools.get('skilldex_install')
  if (!handler) throw new Error('skilldex_install was never registered')
  const result = await handler({ source, scope: 'project', force: false })
  return JSON.parse(result.content[0].text)
}

describe('skilldex_install — registry names', () => {
  it('resolves a qualified name and installs from its source URL', async () => {
    const payload = await install('mauromedda/terraform')

    expect(requested.some((u) => u.endsWith('/skills/mauromedda/terraform/install'))).toBe(true)
    expect(hoisted.installFromGitUrl).toHaveBeenCalledWith(
      'git+https://github.com/mauromedda/agent-toolkit/tree/HEAD/skills/terraform',
      expect.objectContaining({
        sourceUrl: 'https://github.com/mauromedda/agent-toolkit/tree/HEAD/skills/terraform',
      })
    )
    expect(payload.installed).toBe(true)
  })

  it('does not mistake a registry name for a directory on disk', async () => {
    // The defect: everything that was not a git URL went to installFromPath, which looked for a
    // folder named `mauromedda/terraform` and reported it missing.
    await install('mauromedda/terraform')

    expect(hoisted.installFromPath).not.toHaveBeenCalled()
  })

  it('hands an agent the qualified candidates when a bare name is ambiguous', async () => {
    const payload = await install('terraform')

    expect(payload.installed).toBe(false)
    expect(payload.code).toBe('AMBIGUOUS_NAME')
    expect(payload.candidates).toEqual(['mauromedda/terraform', 'dennisonbertram/terraform'])
    expect(hoisted.installFromGitUrl).not.toHaveBeenCalled()
  })

  it('warns the agent that ten owners may not be all of them', async () => {
    owners = [
      'Shkirmantsev',
      'hashimiche',
      'lamhq',
      'bobmatnyc',
      'robert-chiniquy',
      'georgekhananaev',
      'mqtik',
      'jyasuu',
      'andreyk0',
      'jholhewres',
    ]

    expect((await install('terraform')).owners_truncated).toBe(true)
  })
})

describe('skilldex_install — the other source kinds still work', () => {
  it('clones a git+ URL without consulting the registry', async () => {
    await install('git+https://github.com/someone/skills')

    expect(hoisted.installFromGitUrl).toHaveBeenCalledTimes(1)
    expect(requested).toEqual([])
  })

  it('installs a local path from disk', async () => {
    // Windows-shaped on purpose: this is the form that used to be sent to the registry, because
    // the old source test looked for a leading slash and `://`.
    await install('C:/skills/demo')

    expect(hoisted.installFromPath).toHaveBeenCalledTimes(1)
    expect(requested).toEqual([])
  })

  it('installs a relative path from disk', async () => {
    await install('./skills/demo')

    expect(hoisted.installFromPath).toHaveBeenCalledTimes(1)
    expect(requested).toEqual([])
  })
})
