// Directory loads resolve this file. OpenCode 2 requires its default export.
export { default } from './src/index.js'
export { authorizeKiroIDC } from './src/kiro/oauth-idc'
export { createKiroPlugin, KiroOAuthPlugin } from './src/plugin'
export type { KiroConfig } from './src/plugin/config'
export type {
  KiroAuthDetails,
  KiroAuthMethod,
  KiroRegion,
  ManagedAccount
} from './src/plugin/types'
