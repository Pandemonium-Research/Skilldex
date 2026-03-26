// Registry facade — routes installs to the appropriate source
export { installFromGitUrl, parseGitUrl } from './sources/github.js'
export {
  searchRegistry,
  getSkillInstallInfo,
  getSkill,
  publishSkill,
  updateSkill,
  deleteSkill,
} from './sources/registry.js'
export type {
  RegistrySkill,
  SearchOptions,
  SearchResponse,
  InstallInfo,
  PublishBody,
  PublishResponse,
} from './sources/registry.js'
