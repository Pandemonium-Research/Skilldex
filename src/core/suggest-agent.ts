import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { ScopeLevel } from '../types/scope.js'

export interface SuggestionProposal {
  skillName: string
  reason: string
  suggestedScope: ScopeLevel
  available: boolean
}

export async function gatherProjectContext(projectRoot: string): Promise<string> {
  const parts: string[] = []

  // README
  for (const name of ['README.md', 'README.txt', 'readme.md']) {
    try {
      const content = await readFile(path.join(projectRoot, name), 'utf8')
      const excerpt = content.split('\n').slice(0, 100).join('\n')
      parts.push(`## README (first 100 lines)\n${excerpt}`)
      break
    } catch {
      // file not found
    }
  }

  // package.json
  try {
    const pkgRaw = await readFile(path.join(projectRoot, 'package.json'), 'utf8')
    const pkg = JSON.parse(pkgRaw)
    const summary = {
      name: pkg.name,
      description: pkg.description,
      scripts: pkg.scripts,
      dependencies: Object.keys(pkg.dependencies ?? {}),
      devDependencies: Object.keys(pkg.devDependencies ?? {}),
    }
    parts.push(`## package.json summary\n${JSON.stringify(summary, null, 2)}`)
  } catch {
    // not a Node project
  }

  // .claude directory listing
  try {
    const claudeDir = path.join(projectRoot, '.claude')
    const entries = await readdir(claudeDir)
    parts.push(`## .claude/ directory\n${entries.join('\n')}`)
  } catch {
    // no .claude dir
  }

  // Existing skills manifest
  try {
    const manifestPath = path.join(projectRoot, '.skilldex', 'skilldex.json')
    const manifestRaw = await readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestRaw)
    const installedNames = Object.keys(manifest.skills ?? {})
    if (installedNames.length > 0) {
      parts.push(`## Already installed skills\n${installedNames.join(', ')}`)
    }
  } catch {
    // no manifest yet
  }

  return parts.join('\n\n')
}

export async function generateProposals(context: string): Promise<SuggestionProposal[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required for the suggest command'
    )
  }

  const client = new Anthropic({ apiKey })

  const systemPrompt = `You are a Claude skill recommender for the Skilldex package manager.
Skills are Claude Code skill packages (SKILL.md files) that give Claude specialized capabilities.
Given a project context, suggest relevant skills the user might want to install.

Respond ONLY with valid JSON matching this schema:
{
  "proposals": [
    {
      "skillName": "kebab-case-skill-name",
      "reason": "one sentence explaining why this skill fits this project",
      "suggestedScope": "project" | "shared" | "global"
    }
  ]
}

Rules:
- Suggest 3-7 skills maximum
- suggestedScope should be "project" unless there is a clear reason for global/shared
- Do not suggest skills that are already installed (listed in context)
- Only suggest skills that would realistically exist as Claude Code skills
- Keep reasons concise (one sentence)`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Here is the project context:\n\n${context}\n\nPlease suggest relevant Claude Code skills for this project.`,
      },
    ],
    system: systemPrompt,
  })

  const textContent = message.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from AI')
  }

  // Extract JSON from response (handle potential markdown code blocks)
  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Could not parse AI response as JSON')
  }

  const parsed = JSON.parse(jsonMatch[0]) as { proposals: SuggestionProposal[] }
  return parsed.proposals.map((p) => ({ ...p, available: true }))
}
