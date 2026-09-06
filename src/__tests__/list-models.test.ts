import { describe, expect, mock, test } from 'bun:test'
import { fetchAvailableModels, parseAvailableModels } from '../plugin/list-models.js'
import type { KiroAuthDetails } from '../plugin/types.js'

function makeAuth(overrides: Partial<KiroAuthDetails> = {}): KiroAuthDetails {
  return {
    refresh: 'refresh-token',
    access: 'access-token',
    expires: Date.now() + 3600000,
    authMethod: 'idc',
    region: 'eu-central-1',
    profileArn: 'arn:aws:codewhisperer:eu-central-1:000000:profile/ABC',
    ...overrides
  }
}

describe('parseAvailableModels', () => {
  test('reads modelId, displayName, and token limits', () => {
    expect(
      parseAvailableModels({
        models: [
          {
            modelId: 'claude-sonnet-4.5',
            displayName: 'Claude Sonnet 4.5',
            tokenLimits: { maxInputTokens: 200000, maxOutputTokens: 8192 }
          }
        ]
      })
    ).toEqual([
      {
        modelId: 'claude-sonnet-4.5',
        displayName: 'Claude Sonnet 4.5',
        maxInputTokens: 200000,
        maxOutputTokens: 8192
      }
    ])
  })

  test('skips entries without a modelId and non-objects', () => {
    expect(
      parseAvailableModels({
        models: [null, { displayName: 'Nope' }, { modelId: '  glm-5  ' }, 'x']
      })
    ).toEqual([{ modelId: 'glm-5', displayName: undefined }])
  })

  test('returns empty for missing or invalid payloads', () => {
    expect(parseAvailableModels(null)).toEqual([])
    expect(parseAvailableModels({})).toEqual([])
    expect(parseAvailableModels({ models: {} })).toEqual([])
  })
})

describe('fetchAvailableModels', () => {
  test('GETs ListAvailableModels with origin and profileArn', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const original = globalThis.fetch
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init || {} })
      return new Response(
        JSON.stringify({
          models: [{ modelId: 'claude-opus-4.8', displayName: 'Claude Opus 4.8' }]
        }),
        { status: 200 }
      )
    }) as any

    try {
      const models = await fetchAvailableModels(makeAuth())
      expect(models).toEqual([{ modelId: 'claude-opus-4.8', displayName: 'Claude Opus 4.8' }])
      expect(calls).toHaveLength(1)
      const url = new URL(calls[0]!.url)
      expect(url.origin).toBe('https://q.eu-central-1.amazonaws.com')
      expect(url.pathname).toBe('/ListAvailableModels')
      expect(url.searchParams.get('origin')).toBe('AI_EDITOR')
      expect(url.searchParams.get('profileArn')).toBe(
        'arn:aws:codewhisperer:eu-central-1:000000:profile/ABC'
      )
      expect((calls[0]!.init.headers as any).Authorization).toBe('Bearer access-token')
    } finally {
      globalThis.fetch = original
    }
  })

  test('omits profileArn when the account has none', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mock(async (url: string) => {
      const parsed = new URL(String(url))
      expect(parsed.searchParams.has('profileArn')).toBe(false)
      return new Response(JSON.stringify({ models: [{ modelId: 'auto' }] }), { status: 200 })
    }) as any

    try {
      await fetchAvailableModels(makeAuth({ profileArn: undefined }))
    } finally {
      globalThis.fetch = original
    }
  })

  test('throws on non-OK responses', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mock(async () => new Response('nope', { status: 403 })) as any
    try {
      await expect(fetchAvailableModels(makeAuth())).rejects.toThrow('ListAvailableModels failed')
    } finally {
      globalThis.fetch = original
    }
  })
})
