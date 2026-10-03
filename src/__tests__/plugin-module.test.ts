import { describe, expect, test } from 'bun:test'
import rootModule from '../../index.js'
import pluginModule from '../index.js'
import { buildModelRegistry } from '../plugin/model-registry.js'
import { toV2Models } from '../plugin/v2.js'

describe('package plugin module', () => {
  test('exports an OpenCode v2 definition and the v1 server function', () => {
    expect(pluginModule.id).toBe('kiro')
    expect(typeof pluginModule.setup).toBe('function')
    expect(typeof pluginModule.server).toBe('function')
  })

  test('re-exports that definition from the package root OpenCode loads', () => {
    expect(rootModule.id).toBe('kiro')
    expect(rootModule.setup).toBe(pluginModule.setup)
    expect(rootModule.server).toBe(pluginModule.server)
  })
})

describe('v2 model catalog', () => {
  test('keeps thinking metadata and effort variants', () => {
    const registry = buildModelRegistry()
    const models = toV2Models(registry)
    const thinking = models.find((model) => model.id === 'claude-sonnet-4-5-thinking')
    const gpt = models.find((model) => model.id === 'gpt-5.6-sol')

    expect(thinking?.compatibility).toEqual({ reasoningField: 'reasoning_content' })
    expect(thinking?.variants.map((variant) => variant.id)).toEqual([
      'low',
      'medium',
      'high',
      'max'
    ])
    expect(thinking?.variants[0]?.body.thinkingConfig?.thinkingBudget).toBeGreaterThan(0)
    expect(gpt?.compatibility).toBeUndefined()
    expect(gpt?.variants.map((variant) => variant.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
  })
})
