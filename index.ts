export { KiroOAuthPlugin, createKiroPlugin } from './src/plugin'
export { authorizeKiroIDC } from './src/kiro/oauth-idc'
export type { KiroAuthDetails, KiroAuthMethod, KiroRegion, ManagedAccount } from './src/plugin/types'
export type { KiroConfig } from './src/plugin/config'

// Directory loads resolve this file. OpenCode 2 requires its default export.
export { default } from './src/index.js'
