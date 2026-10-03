import { kiroPlugin } from './plugin/v2.js'
import { KiroOAuthPlugin } from './plugin.js'

export type { KiroConfig } from './plugin/config/index.js'
export type { KiroAuthMethod, KiroRegion, ManagedAccount } from './plugin/types.js'
export { KiroOAuthPlugin } from './plugin.js'

// OpenCode 1 calls `server`. OpenCode 2 reads `id` and `setup` and ignores `server`.
export default {
  ...kiroPlugin,
  server: KiroOAuthPlugin
}
