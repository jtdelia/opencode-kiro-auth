import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { KIRO_CONSTANTS } from '../constants.js'
import { AuthHandler } from '../core/auth/auth-handler.js'
import { RequestHandler } from '../core/request/request-handler.js'
import { AccountCache } from '../infrastructure/database/account-cache.js'
import { AccountRepository } from '../infrastructure/database/account-repository.js'
import { AccountManager } from './accounts.js'
import { bootstrapAuthIfNeeded } from './auth-bootstrap.js'
import { loadConfig } from './config/index.js'
import * as logger from './logger.js'
import { createModelCatalog } from './model-discovery.js'
import { buildModelRegistry } from './model-registry.js'
import {
  isKiroWebSearchEnabled,
  KIRO_PROVIDER_ID,
  WEB_SEARCH_DESCRIPTION
} from '../plugin.js'
import { formatWebSearchResults, kiroWebSearch } from './web-search.js'

const PROVIDER_PACKAGE = 'aisdk:@ai-sdk/openai-compatible'

type RegistryModel = {
  name?: string
  limit?: { context?: number; output?: number }
  modalities?: { input?: string[]; output?: string[] }
  reasoning?: boolean
  interleaved?: { field?: string }
  variants?: Record<string, { thinkingConfig?: { thinkingBudget?: number } }>
}

type V1AuthMethod = {
  label: string
  type: string
  prompts?: Array<{ key: string; message?: string; placeholder?: string }>
  authorize: (inputs?: Record<string, string>) => Promise<{
    url: string
    instructions: string
    callback: () => Promise<{ type?: string; key?: string; refresh?: string; expires?: number }>
  }>
}

export function toV2Models(registry: Record<string, unknown>, providerID = KIRO_PROVIDER_ID) {
  return Object.entries(registry).map(([id, raw]) => {
    const model = (raw ?? {}) as RegistryModel
    const variants = Object.entries(model.variants ?? {}).map(([variantID, variant]) => ({
      id: variantID,
      body: variant,
      settings: variant
    }))
    const reasoningField = model.interleaved?.field
    const thinking = model.reasoning === true || !!reasoningField

    return {
      id,
      modelID: id,
      providerID,
      name: model.name || id,
      capabilities: {
        tools: true,
        input: model.modalities?.input ?? ['text'],
        output: model.modalities?.output ?? ['text']
      },
      variants,
      time: { released: 0 },
      cost: [],
      status: 'active' as const,
      enabled: true,
      limit: {
        context: model.limit?.context ?? 200000,
        output: model.limit?.output ?? 64000
      },
      ...(thinking ? { compatibility: { reasoningField: reasoningField || 'reasoning_content' } } : {})
    }
  })
}

function pluginDirectory(ctx: { location?: { directory?: string } }): string {
  return ctx.location?.directory || process.cwd()
}

function methodID(index: number): string {
  if (index === 0) return 'builder-id'
  if (index === 1) return 'profile-arn'
  return `method-${index}`
}

async function registerAuth(ctx: any, authHandler: AuthHandler): Promise<void> {
  const methods = (authHandler.getMethods() ?? []) as V1AuthMethod[]
  await ctx.integration.transform((editor: any) => {
    editor.update(KIRO_PROVIDER_ID, (integration: { name: string }) => {
      integration.name = 'Kiro'
    })

    methods.forEach((method, index) => {
      if (method.type !== 'oauth') return
      const id = methodID(index)
      editor.method.update({
        integrationID: KIRO_PROVIDER_ID,
        method: {
          id,
          type: 'oauth',
          label: method.label,
          form: (method.prompts ?? []).map((prompt) => ({
            type: 'string',
            key: prompt.key,
            title: prompt.message,
            placeholder: prompt.placeholder,
            required: false
          }))
        },
        authorize: async (answer: Record<string, string>) => {
          const auth = await method.authorize(answer)
          const completion = auth.callback().then((result) => {
            if (result?.type === 'failed' || !result?.key) {
              throw new Error('Kiro authorization failed')
            }
            return {
              type: 'oauth' as const,
              methodID: id,
              refresh: result.refresh || result.key,
              access: result.key,
              expires: Math.trunc(result.expires || Date.now() + 60 * 60 * 1000)
            }
          })
          return {
            mode: 'auto' as const,
            url: auth.url,
            instructions: auth.instructions,
            callback: completion
          }
        }
      })
    })
  })
}

export const kiroPlugin = {
  id: KIRO_PROVIDER_ID,
  async setup(ctx: any) {
    const directory = pluginDirectory(ctx)
    const config = loadConfig(directory)
    bootstrapAuthIfNeeded(KIRO_PROVIDER_ID)

    const cache = new AccountCache(60000)
    const repository = new AccountRepository(cache)
    const authHandler = new AuthHandler(config, repository)
    const accountManager = await AccountManager.loadFromDisk(config.account_selection_strategy)
    authHandler.setAccountManager(accountManager)
    const requestHandler = new RequestHandler(accountManager, config, repository)
    const modelCatalog = createModelCatalog({ enabled: config.auto_discover_models !== false })
    const baseURL = KIRO_CONSTANTS.BASE_URL.replace('/generateAssistantResponse', '').replace(
      '{{region}}',
      config.default_region || 'us-east-1'
    )

    try {
      await authHandler.initialize()
    } catch (error) {
      logger.warn('Kiro auth init failed during OpenCode v2 setup', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    let userDefinedModels = false
    await ctx.provider.transform((editor: any) => {
      const existing = editor.get(KIRO_PROVIDER_ID)
      userDefinedModels = !!existing && existing.models?.size > 0
      const info = {
        id: KIRO_PROVIDER_ID,
        name: 'Kiro',
        activation: 'enabled',
        package: PROVIDER_PACKAGE,
        integrationID: KIRO_PROVIDER_ID,
        settings: {
          ...(existing?.provider?.settings ?? {}),
          baseURL,
          apiKey: 'kiro'
        }
      }

      if (!existing) {
        editor.add({ info, models: toV2Models(buildModelRegistry()) })
        return
      }

      editor.update(KIRO_PROVIDER_ID, (provider: any) => {
        provider.name = provider.name || 'Kiro'
        provider.activation = 'enabled'
        provider.package = PROVIDER_PACKAGE
        provider.integrationID = provider.integrationID || KIRO_PROVIDER_ID
        provider.settings = info.settings
      })
      if (!userDefinedModels) {
        editor.models.set(KIRO_PROVIDER_ID, toV2Models(buildModelRegistry()))
      }
    })

    await registerAuth(ctx, authHandler)

    await ctx.aisdk.hook(
      'sdk',
      (evt: any) => {
        if (evt.model?.providerID !== KIRO_PROVIDER_ID) return
        const fetch = ((input: any, init?: any) =>
          requestHandler.handle(input, init, () => {})) as any
        const apiKey = evt.options?.apiKey || 'kiro'
        evt.options = {
          ...evt.options,
          name: KIRO_PROVIDER_ID,
          baseURL,
          apiKey,
          fetch
        }
        evt.sdk = createOpenAICompatible({
          name: KIRO_PROVIDER_ID,
          baseURL,
          apiKey,
          fetch
        })
      },
      { providerID: KIRO_PROVIDER_ID }
    )

    if (isKiroWebSearchEnabled(config, accountManager)) {
      await ctx.tool.transform((editor: any) => {
        editor.add({
          name: 'kiro_web_search',
          description: WEB_SEARCH_DESCRIPTION,
          input: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query. Must be 200 characters or fewer.'
              }
            },
            required: ['query']
          },
          async execute(input: { query?: string }) {
            try {
              const results = await kiroWebSearch(accountManager, input.query ?? '')
              return { content: formatWebSearchResults(results) }
            } catch (error) {
              return {
                content: `Web search failed: ${error instanceof Error ? error.message : String(error)}`
              }
            }
          }
        })
      })
    }

    if (!userDefinedModels && config.auto_discover_models) {
      try {
        const registry = await modelCatalog.refresh(accountManager)
        await ctx.provider.transform((editor: any) => {
          editor.models.set(KIRO_PROVIDER_ID, toV2Models(registry))
        })
        if (typeof ctx.provider.reload === 'function') await ctx.provider.reload()
      } catch (error) {
        logger.warn('Kiro model discovery failed; using the built-in catalog', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }
}
