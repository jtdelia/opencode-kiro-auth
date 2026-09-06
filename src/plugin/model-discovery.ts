import type { AccountManager } from './accounts.js'
import { fetchAvailableModels, type DiscoveredKiroModel } from './list-models.js'
import * as logger from './logger.js'
import { buildModelRegistry } from './model-registry.js'

export const MODEL_DISCOVERY_TTL_MS = 12 * 60 * 60 * 1000
export const MODEL_DISCOVERY_FAILURE_COOLDOWN_MS = 60 * 1000

export interface ModelCatalog {
  getRegistry(accountManager: AccountManager): Promise<Record<string, unknown>>
  refresh(accountManager: AccountManager): Promise<Record<string, unknown>>
}

function pickAccount(accountManager: AccountManager) {
  return accountManager.getCurrentOrNext()
}

export function createModelCatalog(options: { enabled: boolean }): ModelCatalog {
  let cache: { models: DiscoveredKiroModel[]; at: number } | null = null
  let failedAt = 0
  let inflight: Promise<Record<string, unknown>> | null = null

  const staticRegistry = () => buildModelRegistry()

  async function load(accountManager: AccountManager): Promise<Record<string, unknown>> {
    if (!options.enabled) return staticRegistry()
    if (cache && Date.now() - cache.at < MODEL_DISCOVERY_TTL_MS) {
      return buildModelRegistry(cache.models)
    }
    if (failedAt && Date.now() - failedAt < MODEL_DISCOVERY_FAILURE_COOLDOWN_MS) {
      return staticRegistry()
    }

    const account = pickAccount(accountManager)
    if (!account?.accessToken) {
      logger.log('Model discovery: no healthy account with an access token, using static registry')
      return staticRegistry()
    }

    try {
      const models = await fetchAvailableModels(accountManager.toAuthDetails(account))
      if (models.length === 0) {
        failedAt = Date.now()
        logger.warn('Model discovery: empty ListAvailableModels response, using static registry')
        return staticRegistry()
      }
      cache = { models, at: Date.now() }
      failedAt = 0
      logger.log('Model discovery: advertised models from Kiro', {
        count: models.length,
        ids: models.map((m) => m.modelId)
      })
      return buildModelRegistry(models)
    } catch (e) {
      failedAt = Date.now()
      logger.warn('Model discovery failed; using static registry', {
        error: e instanceof Error ? e.message : String(e)
      })
      return staticRegistry()
    }
  }

  async function run(accountManager: AccountManager): Promise<Record<string, unknown>> {
    if (inflight) return inflight
    inflight = load(accountManager).finally(() => {
      inflight = null
    })
    return inflight
  }

  return {
    getRegistry: run,
    refresh: run
  }
}
