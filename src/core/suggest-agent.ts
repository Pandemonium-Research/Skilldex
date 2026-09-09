import Anthropic from '@anthropic-ai/sdk'
import type { ScopeLevel } from '../types/scope.js'
import {
  gatherProjectProfile,
  renderProjectContext,
  type ProjectProfile,
} from './project-context.js'

export interface SuggestionProposal {
  skillName: string
  reason: string
  suggestedScope: ScopeLevel
  available: boolean
}

export interface ProjectContext {
  profile: ProjectProfile
  /** The profile rendered for a prompt. Never send this to a model when `profile.isEmpty`. */
  text: string
}

/**
 * What we know about the project, and how it reads as prompt text.
 *
 * The profile comes back alongside the text rather than being discarded, for two reasons: the
 * caller has to decide whether there is enough here to ask a model anything at all, and the facts
 * in it — dependency names, tooling — are what registry queries get built from, which re-parsing
 * our own rendered prose could only lose.
 */
export async function gatherProjectContext(projectRoot: string): Promise<ProjectContext> {
  const profile = await gatherProjectProfile(projectRoot)
  return { profile, text: renderProjectContext(profile) }
}

export async function generateProposals(context: string): Promise<SuggestionProposal[]> {
  // The bug this closes: the old gatherer returned '' for any project it did not recognise, the
  // caller passed it straight through, and the model was asked to suggest skills for a project it
  // had been told nothing about. It complied every time. Callers check `profile.isEmpty` and
  // report properly; this is the backstop that keeps a future caller from reintroducing it.
  if (!context.trim()) {
    throw new Error(
      'Refusing to generate suggestions with no project context — any result would be invented.'
    )
  }

  const { getConfigValue } = await import('./config.js')
  const apiKey = await getConfigValue('anthropicApiKey')
  // Bearer-token auth for custom/proxy endpoints (e.g. a LiteLLM proxy).
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN
  if (!apiKey && !authToken) {
    throw new Error(
      'ANTHROPIC_API_KEY is required for the suggest command. Set it via environment variable or run: skillpm config set anthropicApiKey <key>. For a custom endpoint, set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN.'
    )
  }

  // Optional overrides so suggest can run against an Anthropic-compatible proxy
  // (defaults preserve first-party Anthropic behaviour).
  const baseURL = process.env.ANTHROPIC_BASE_URL
  const model = process.env.SKILLPM_SUGGEST_MODEL ?? 'claude-sonnet-4-6'

  const client = new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(authToken ? { authToken } : {}),
    ...(baseURL ? { baseURL } : {}),
  })

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
    model,
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
