import { afterEach, describe, expect, mock, test } from 'bun:test'
import { createModelCatalog } from '../plugin/model-discovery.js'
import { resetDiscoveredModels } from '../plugin/models.js'
import type { KiroAuthDetails, ManagedAccount } from '../plugin/types.js'

function makeAccount(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    id: 'acc-1',
    email: 'test@example.com',
    authMethod: 'idc',
    region: 'us-east-1',
    refreshToken: 'r',
    accessToken: 'a',
    expiresAt: Date.now() + 3600000,
    rateLimitResetTime: 0,
    isHealthy: true,
    failCount: 0,
    lastUsed: 0,
    usedCount: 0,
    limitCount: 0,
    ...overrides
  }
}

function makeAuth(): KiroAuthDetails {
  return {
    refresh: 'refresh-token',
    access: 'access-token',
    expires: Date.now() + 3600000,
    authMethod: 'idc',
    region: 'us-east-1'
  }
}

function makeManager(account: ManagedAccount | null) {
  return {
    getCurrentOrNext: () => account,
    toAuthDetails: () => makeAuth()
  } as any
}

function mockListModels(payload: unknown, status = 200) {
  return mock(async () => new Response(JSON.stringify(payload), { status }))
}

afterEach(() => {
  resetDiscoveredModels()
})

describe('model catalog', () => {
  test('returns the static registry when discovery is disabled', async () => {
    const fetchMock = mock(async () => new Response('unused'))
    const original = globalThis.fetch
    globalThis.fetch = fetchMock as any
    try {
      const catalog = createModelCatalog({ enabled: false })
      const registry = await catalog.getRegistry(makeManager(makeAccount()))
      expect(registry['claude-sonnet-4-5']).toBeDefined()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })

  test('advertises discovered IDs and skips GPT tiers', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockListModels({
      models: [
        { modelId: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5' },
        { modelId: 'gpt-5.6', displayName: 'GPT 5.6' },
        { modelId: 'deepseek-3.2' }
      ]
    }) as any

    try {
      const catalog = createModelCatalog({ enabled: true })
      const registry = await catalog.getRegistry(makeManager(makeAccount()))
      expect(Object.keys(registry).sort()).toEqual(
        ['claude-sonnet-4-5', 'claude-sonnet-4-5-thinking', 'deepseek-3.2'].sort()
      )
      expect(registry['claude-sonnet-4-5-thinking']).toMatchObject({
        reasoning: true,
        interleaved: { field: 'reasoning_content' }
      })
    } finally {
      globalThis.fetch = original
    }
  })

  test('falls back to the static catalog when the API fails', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockListModels({ message: 'nope' }, 500) as any
    try {
      const catalog = createModelCatalog({ enabled: true })
      const registry = await catalog.getRegistry(makeManager(makeAccount()))
      expect(registry['claude-opus-5']).toBeDefined()
      expect(registry['qwen3-coder-next']).toBeDefined()
    } finally {
      globalThis.fetch = original
    }
  })

  test('falls back when ListAvailableModels returns an empty list', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mockListModels({ models: [] }) as any
    try {
      const catalog = createModelCatalog({ enabled: true })
      const registry = await catalog.getRegistry(makeManager(makeAccount()))
      expect(registry['auto']).toBeDefined()
    } finally {
      globalThis.fetch = original
    }
  })

  test('skips the network when no account is available', async () => {
    const fetchMock = mock(async () => new Response('unused'))
    const original = globalThis.fetch
    globalThis.fetch = fetchMock as any
    try {
      const catalog = createModelCatalog({ enabled: true })
      const registry = await catalog.getRegistry(makeManager(null))
      expect(registry['claude-sonnet-4']).toBeDefined()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })

  test('reuses a successful catalog without refetching', async () => {
    let calls = 0
    const original = globalThis.fetch
    globalThis.fetch = mock(async () => {
      calls++
      return new Response(JSON.stringify({ models: [{ modelId: 'glm-5' }] }), { status: 200 })
    }) as any

    try {
      const catalog = createModelCatalog({ enabled: true })
      const manager = makeManager(makeAccount())
      const first = await catalog.getRegistry(manager)
      const second = await catalog.getRegistry(manager)
      expect(calls).toBe(1)
      expect(first).toEqual(second)
      expect(Object.keys(second)).toEqual(['glm-5'])
    } finally {
      globalThis.fetch = original
    }
  })
})
