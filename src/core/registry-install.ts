import type { InstallInfo } from '../registry/sources/registry.js'

/**
 * Turning a registry name into something installable, for every surface that needs to.
 *
 * The CLI grew a registry branch and the MCP server did not: `skilldex_install` handled only a
 * local path or a `git+` URL, so an agent handed `mauromedda/terraform` sent it to
 * `installFromPath`, which looked for a directory of that name and failed. The skillset tool
 * beside it had a registry branch, which is how the gap stayed invisible — skillsets installed
 * from the registry through MCP and skills did not.
 *
 * The resolution lives here rather than in either caller because both need the same two outcomes
 * and neither can borrow the other's way of reporting the second one. A terminal can ask which
 * owner was meant; an agent cannot be asked, only told. So this returns the ambiguity as data and
 * lets each surface present it — the CLI as a picker, MCP as a list the agent can retry with.
 */
export type RegistryResolution =
  | { kind: 'resolved'; info: InstallInfo }
  | {
      kind: 'ambiguous'
      name: string
      owners: string[]
      /** `owner/name` for each claimant — directly installable, unlike the bare name. */
      candidates: string[]
      /**
       * The owners list may be incomplete.
       *
       * The registry selects `LIMIT 11` and returns the first ten, so exactly ten claimants and a
       * hundred produce the same list. Callers must not present it as the complete set.
       */
      ownersTruncated: boolean
    }

/**
 * Look up a registry skill, reporting an ambiguous bare name rather than throwing on it.
 *
 * Anything else — not found, network failure — still throws, because those are not choices the
 * caller can offer a user.
 */
export async function resolveRegistrySkill(name: string): Promise<RegistryResolution> {
  const { getSkillInstallInfo, isAmbiguousNameError, MAX_REPORTED_OWNERS } = await import(
    '../registry/sources/registry.js'
  )

  try {
    return { kind: 'resolved', info: await getSkillInstallInfo(name) }
  } catch (e) {
    if (!isAmbiguousNameError(e)) throw e

    return {
      kind: 'ambiguous',
      name,
      owners: e.owners,
      candidates: e.owners.map((owner) => `${owner}/${name}`),
      ownersTruncated: e.owners.length >= MAX_REPORTED_OWNERS,
    }
  }
}
